/**
 * Cursor Tool Implementation
 *
 * Implements the ITool interface for Cursor Agent CLI integration.
 * Cursor is Cursor AI's agent CLI for agentic coding.
 *
 * Current capabilities:
 * - ✅ Create new sessions
 * - ✅ Send prompts and receive responses
 * - ✅ Real-time streaming support via NDJSON
 * - ✅ Stop running tasks
 * - ⏳ Session import (future: when Cursor provides export API)
 */

import { spawn, type ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import { generateId } from '../../lib/ids';
import type { Message, SessionID, TaskID } from '../../types';
import { MessageRole } from '../../types';
import type {
  CreateSessionConfig,
  SessionHandle,
  SessionMetadata,
  StreamingCallbacks,
  TaskResult,
  ToolCapabilities,
} from '../base';
import type { ITool } from '../base/tool.interface';
import { CursorCommandBuilder } from './cursor-command-builder';
import { CursorEventParser } from './cursor-event-parser';
import { MessageAccumulator } from './cursor-message-accumulator';
import { CursorPermissionMapper } from './cursor-permission-mapper';
import { CursorSessionManager } from './cursor-session-manager';
import { ToolCallAggregator } from './cursor-tool-aggregator';
import type { CursorConfig } from './types';

/**
 * Service interface for creating messages via FeathersJS
 */
export interface MessagesService {
  create(data: Partial<Message>): Promise<Message>;
}

/**
 * Service interface for updating tasks via FeathersJS
 */
export interface TasksService {
  patch(id: string, data: Partial<{ status: string }>): Promise<unknown>;
}

export class CursorTool implements ITool {
  readonly toolType = 'cursor' as const;
  readonly name = 'Cursor';

  private config: CursorConfig;
  private messagesService?: MessagesService;
  private sessionManager: CursorSessionManager;
  private processes = new Map<string, ChildProcess>(); // Agor session ID → process

  constructor(config: CursorConfig, messagesService?: MessagesService) {
    this.config = config;
    this.messagesService = messagesService;
    this.sessionManager = new CursorSessionManager();
  }

  /**
   * Get tool capabilities
   */
  getCapabilities(): ToolCapabilities {
    return {
      supportsSessionImport: false, // Not yet - need session export API
      supportsSessionCreate: true, // ✅ Via cursor-agent CLI
      supportsLiveExecution: true, // ✅ Via cursor-agent CLI
      supportsSessionFork: false, // Not supported by Cursor
      supportsChildSpawn: false, // Not supported by Cursor
      supportsGitState: false, // Cursor doesn't track git natively
      supportsStreaming: true, // ✅ Via --stream-partial-output
    };
  }

  /**
   * Check if cursor-agent is installed and accessible
   */
  async checkInstalled(): Promise<boolean> {
    try {
      execSync('which cursor-agent', { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new Cursor session
   */
  async createSession?(config: CreateSessionConfig): Promise<SessionHandle> {
    const workingDir = config.workingDirectory || process.cwd();

    // Build command
    const args = new CursorCommandBuilder()
      .withPrintMode()
      .withOutputFormat('stream-json')
      .withModel(config.model as string | undefined || this.config.model || 'claude-sonnet-4')
      .withPrompt(config.initialPrompt || 'Hello')
      .build();

    console.log('[CursorTool] Creating session with command:', `cursor-agent ${args.join(' ')}`);

    // Spawn process
    const proc = spawn('cursor-agent', args, {
      cwd: workingDir,
      env: {
        ...process.env,
        CURSOR_API_KEY: this.config.apiKey || process.env.CURSOR_API_KEY,
      },
    });

    // Parse NDJSON stream to extract session_id
    const parser = new CursorEventParser();
    let cursorSessionId: string | null = null;

    try {
      const initEvent = await parser.waitForEvent(proc.stdout!, 'system', 15000);
      if (initEvent.subtype === 'init') {
        cursorSessionId = initEvent.session_id;
      }
    } catch (error) {
      throw new Error(
        `Failed to extract session_id from cursor-agent: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!cursorSessionId) {
      throw new Error('Failed to extract session_id from cursor-agent output');
    }

    // Generate Agor session ID
    const agorSessionId = generateId();

    // Store session context
    this.sessionManager.createContext(agorSessionId, {
      cursorSessionId,
      workingDir,
      model: config.model as string | undefined,
      gitRef: config.gitRef as string | undefined,
    });

    // Wait for process to complete initial prompt
    await new Promise((resolve) => proc.on('exit', resolve));

    console.log('[CursorTool] Session created:', { agorSessionId, cursorSessionId });

    return {
      sessionId: agorSessionId,
      toolType: 'cursor',
    };
  }

  /**
   * Execute task (send prompt) in Cursor session
   */
  async executeTask?(
    sessionId: string,
    prompt: string,
    taskId?: string,
    streamingCallbacks?: StreamingCallbacks
  ): Promise<TaskResult> {
    const context = this.sessionManager.getContext(sessionId);
    if (!context) {
      throw new Error(`Session ${sessionId} not found. Call createSession() first.`);
    }

    console.log('[CursorTool] executeTask called:', {
      sessionId,
      cursorSessionId: context.cursorSessionId,
      taskId,
      promptLength: prompt.length,
      model: context.model,
    });

    // Build command with --resume flag
    const commandBuilder = new CursorCommandBuilder()
      .withPrintMode()
      .withOutputFormat('stream-json')
      .withResume(context.cursorSessionId)
      .withStreamPartialOutput();

    // Map Agor permission mode to Cursor's -f flag
    const permissionMode = this.config.permissionMode || 'ask';
    const permissionFlags = CursorPermissionMapper.mapToFlags(permissionMode);
    if (permissionFlags.includes('-f')) {
      commandBuilder.withForce();
    }

    if (context.model) {
      commandBuilder.withModel(context.model);
    }

    commandBuilder.withPrompt(prompt);

    const args = commandBuilder.build();
    console.log('[CursorTool] Executing with command:', commandBuilder.buildCommandString());

    // Spawn process
    const proc = spawn('cursor-agent', args, {
      cwd: context.workingDir,
      env: {
        ...process.env,
        CURSOR_API_KEY: this.config.apiKey || process.env.CURSOR_API_KEY,
      },
    });

    // Track process for stopTask()
    this.processes.set(sessionId, proc);

    // Initialize parsers/aggregators
    const parser = new CursorEventParser();
    const toolAggregator = new ToolCallAggregator();

    let currentMessageId: string | null = null;
    let messageAccumulator: MessageAccumulator | null = null;
    let userMessageCreated = false;
    let fullText = '';

    const messages: Message[] = [];
    let tokenUsage = { input: 0, output: 0 };

    try {
      for await (const event of parser.parseStream(proc.stdout!)) {
        switch (event.type) {
          case 'system':
            // Log initialization details
            console.log('[CursorTool] Session initialized:', {
              sessionId: event.session_id,
              model: event.model,
              cwd: event.cwd,
            });
            break;

          case 'user':
            // Create user message once
            if (!userMessageCreated && this.messagesService) {
              const userMessage = await this.messagesService.create({
                message_id: generateId(),
                session_id: sessionId as SessionID,
                task_id: taskId as TaskID | undefined,
                type: 'user' as const,
                role: MessageRole.USER,
                index: 0,
                timestamp: new Date().toISOString(),
                content_preview: prompt.substring(0, 200),
                content: [{ type: 'text', text: prompt }],
              });
              messages.push(userMessage);
              userMessageCreated = true;
            }
            break;

          case 'assistant':
            // Initialize streaming if callbacks provided
            if (streamingCallbacks && !currentMessageId) {
              currentMessageId = generateId();
              messageAccumulator = new MessageAccumulator(
                currentMessageId,
                async (chunk) => {
                  await streamingCallbacks.onStreamChunk(currentMessageId!, chunk);
                }
              );

              await streamingCallbacks.onStreamStart(currentMessageId, {
                session_id: sessionId as SessionID,
                task_id: taskId as TaskID | undefined,
                role: MessageRole.ASSISTANT,
                timestamp: new Date().toISOString(),
              });
            }

            // Accumulate text
            if (event.message?.text) {
              fullText += event.message.text;
              if (messageAccumulator) {
                await messageAccumulator.addText(event.message.text);
              }
            }
            break;

          case 'tool_call':
            if (event.subtype === 'started') {
              await toolAggregator.onToolStarted(event);
            } else if (event.subtype === 'completed' && this.messagesService) {
              await toolAggregator.onToolCompleted(
                event,
                sessionId,
                taskId,
                this.messagesService
              );
            }
            break;

          case 'result':
            // Finalize assistant message
            if (messageAccumulator) {
              await messageAccumulator.flush();
            }

            if (currentMessageId && streamingCallbacks) {
              await streamingCallbacks.onStreamEnd(currentMessageId);
            }

            // Create final assistant message in DB
            if (currentMessageId && this.messagesService) {
              const assistantMessage = await this.messagesService.create({
                message_id: currentMessageId,
                session_id: sessionId as SessionID,
                task_id: taskId as TaskID | undefined,
                type: 'assistant' as const,
                role: MessageRole.ASSISTANT,
                index: messages.length,
                timestamp: new Date().toISOString(),
                content_preview: fullText.substring(0, 200),
                content: [{ type: 'text', text: fullText }],
                metadata: {
                  model: context.model || 'unknown',
                  tokens: event.usage || { input: 0, output: 0 },
                  cursor: { session_id: context.cursorSessionId },
                },
              });

              messages.push(assistantMessage);
            }

            // Capture token usage
            if (event.usage) {
              tokenUsage = event.usage;
            }

            // Check for errors
            if (event.subtype === 'error') {
              throw new Error('Cursor execution failed');
            }
            break;
        }
      }
    } catch (err) {
      console.error('[CursorTool] Execution error:', err);

      // Clean up streaming state
      if (currentMessageId && streamingCallbacks) {
        await streamingCallbacks.onStreamError(
          currentMessageId,
          err instanceof Error ? err : new Error(String(err))
        );
      }

      throw err;
    } finally {
      // Clean up process reference
      this.processes.delete(sessionId);
    }

    // Update session stats
    this.sessionManager.incrementMessageCount(sessionId);

    console.log('[CursorTool] Task completed:', {
      taskId,
      messageCount: messages.length,
      tokenUsage,
    });

    return {
      taskId: taskId || generateId(),
      status: 'completed',
      messages,
      completedAt: new Date(),
    };
  }

  /**
   * Stop currently executing task in session
   */
  async stopTask?(
    sessionId: string,
    taskId?: string
  ): Promise<{
    success: boolean;
    partialResult?: Partial<TaskResult>;
    reason?: string;
  }> {
    const proc = this.processes.get(sessionId);

    if (!proc) {
      return {
        success: false,
        reason: 'No active process for session',
      };
    }

    console.log('[CursorTool] Stopping task:', { sessionId, taskId });

    // Send SIGTERM for graceful shutdown
    proc.kill('SIGTERM');

    // Wait for process to exit (with timeout)
    const exitCode = await new Promise<number>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL'); // Force kill if not responding
        resolve(-1);
      }, 5000);

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        resolve(code || 0);
      });
    });

    this.processes.delete(sessionId);

    console.log('[CursorTool] Task stopped:', { sessionId, exitCode });

    return {
      success: true,
      partialResult: {
        taskId: taskId || 'unknown',
        status: 'cancelled',
      },
    };
  }

  /**
   * Get session metadata
   */
  async getSessionMetadata?(sessionId: string): Promise<SessionMetadata> {
    const context = this.sessionManager.getContext(sessionId);

    if (!context) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return {
      sessionId,
      toolType: 'cursor' as const,
      status: 'active',
      createdAt: context.createdAt,
      lastUpdatedAt: context.lastUsedAt,
      workingDirectory: context.workingDir,
      messageCount: context.messageCount,
    };
  }

  /**
   * List all available sessions
   */
  async listSessions?(): Promise<SessionMetadata[]> {
    const sessionIds = this.sessionManager.getAllSessionIds();

    const sessions: SessionMetadata[] = [];
    for (const sessionId of sessionIds) {
      const metadata = await this.getSessionMetadata!(sessionId);
      sessions.push(metadata);
    }

    return sessions;
  }
}
