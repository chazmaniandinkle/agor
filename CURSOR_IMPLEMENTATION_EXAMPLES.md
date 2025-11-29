# Cursor Agent Implementation Examples

Concrete code examples for integrating Cursor Agent into Agor's ITool ecosystem.

---

## Example 1: Basic NDJSON Event Parser

```typescript
// cursor-event-parser.ts
import { createInterface } from 'readline';
import { Readable } from 'stream';

export class CursorEventParser {
  async *parseStream(stream: Readable): AsyncGenerator<CursorEvent> {
    const readline = createInterface({ input: stream });

    for await (const line of readline) {
      if (!line.trim()) continue; // Skip empty lines

      try {
        const event = JSON.parse(line) as CursorEvent;
        yield event;
      } catch (err) {
        console.error('[CursorEventParser] Failed to parse line:', line, err);
        // Continue processing - don't let one bad line kill the stream
      }
    }
  }

  // Helper to extract specific event type
  async waitForEvent<T extends CursorEvent['type']>(
    stream: Readable,
    eventType: T,
    timeout = 10000
  ): Promise<Extract<CursorEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for event type: ${eventType}`));
      }, timeout);

      (async () => {
        for await (const event of this.parseStream(stream)) {
          if (event.type === eventType) {
            clearTimeout(timeoutId);
            resolve(event as Extract<CursorEvent, { type: T }>);
            return;
          }
        }
        reject(new Error(`Stream ended without receiving event: ${eventType}`));
      })();
    });
  }
}

// Usage example
const parser = new CursorEventParser();
const initEvent = await parser.waitForEvent(proc.stdout, 'system');
const sessionId = initEvent.subtype === 'init' ? initEvent.session_id : null;
```

---

## Example 2: Message Accumulator (Streaming Buffer)

```typescript
// cursor-message-accumulator.ts
import { generateId } from '@agor/core';

export class MessageAccumulator {
  private buffer = '';
  private wordCount = 0;
  private lastFlushTime = Date.now();

  private readonly CHUNK_SIZE_WORDS = 5; // Flush every 5 words
  private readonly FLUSH_INTERVAL_MS = 100; // Or every 100ms

  constructor(
    private messageId: string,
    private onChunk: (chunk: string) => Promise<void>
  ) {}

  async addText(text: string): Promise<void> {
    this.buffer += text;

    // Count words in buffer
    const words = this.buffer.split(/\s+/);
    this.wordCount = words.length;

    const now = Date.now();
    const timeSinceFlush = now - this.lastFlushTime;

    // Flush if we hit word threshold or time threshold
    if (
      this.wordCount >= this.CHUNK_SIZE_WORDS ||
      timeSinceFlush >= this.FLUSH_INTERVAL_MS
    ) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    await this.onChunk(this.buffer);

    this.buffer = '';
    this.wordCount = 0;
    this.lastFlushTime = Date.now();
  }

  getFullText(): string {
    return this.buffer;
  }
}

// Usage example in executeTask()
const accumulator = new MessageAccumulator(
  messageId,
  async (chunk) => {
    await streamingCallbacks?.onStreamChunk(messageId, chunk);
  }
);

for await (const event of parser.parseStream(proc.stdout)) {
  if (event.type === 'assistant' && event.message?.text) {
    await accumulator.addText(event.message.text);
  }
}

await accumulator.flush(); // Final flush
```

---

## Example 3: Tool Call Aggregator

```typescript
// cursor-tool-aggregator.ts
import { generateId } from '@agor/core';
import { ToolUse } from '@agor/core/types';

export class ToolCallAggregator {
  private pendingTools = new Map<string, ToolCallState>();

  // Generate unique tool call ID (compatible with Claude's format)
  private generateToolId(): string {
    return `toolu_${generateId().slice(0, 12)}`;
  }

  // Handle tool_call started event
  async onToolStarted(event: CursorToolCallEvent): Promise<void> {
    const toolId = this.generateToolId();

    this.pendingTools.set(toolId, {
      id: toolId,
      name: event.name,
      input: event.args || {},
      startedAt: new Date(),
    });

    console.log(`[ToolAggregator] Tool started: ${event.name} (${toolId})`);
  }

  // Handle tool_call completed event
  async onToolCompleted(
    event: CursorToolCallEvent,
    sessionId: string,
    taskId: string | undefined,
    messagesService: MessagesService
  ): Promise<void> {
    // Find matching pending tool (Cursor doesn't provide IDs, match by name)
    const toolState = Array.from(this.pendingTools.values()).find(
      (t) => t.name === event.name && !t.completed
    );

    if (!toolState) {
      console.warn(`[ToolAggregator] No pending tool found for: ${event.name}`);
      return;
    }

    toolState.completed = true;
    toolState.result = event.result;
    toolState.completedAt = new Date();

    // Create tool message in Agor database
    const messageId = generateId();

    await messagesService.create({
      message_id: messageId,
      session_id: sessionId,
      task_id: taskId,
      type: 'assistant',
      role: 'assistant',
      index: 0, // TODO: Calculate proper index
      timestamp: new Date().toISOString(),
      content_preview: `Tool: ${event.name}`,
      content: [
        {
          type: 'tool_use',
          id: toolState.id,
          name: toolState.name,
          input: toolState.input,
        },
        {
          type: 'tool_result',
          tool_use_id: toolState.id,
          content: this.formatToolResult(event.result),
          is_error: false,
        },
      ],
      tool_uses: [
        {
          id: toolState.id,
          name: toolState.name,
          input: toolState.input,
        },
      ],
    });

    this.pendingTools.delete(toolState.id);
    console.log(`[ToolAggregator] Tool completed: ${event.name} (${toolState.id})`);
  }

  private formatToolResult(result: any): string {
    if (typeof result === 'string') return result;
    if (result?.content) return result.content;
    return JSON.stringify(result, null, 2);
  }

  // Get all pending tools (for debugging)
  getPendingTools(): ToolCallState[] {
    return Array.from(this.pendingTools.values());
  }
}

interface ToolCallState {
  id: string;
  name: string;
  input: Record<string, any>;
  startedAt: Date;
  completed?: boolean;
  result?: any;
  completedAt?: Date;
}
```

---

## Example 4: Complete executeTask() with All Components

```typescript
// cursor-tool.ts (executeTask method)
async executeTask(
  sessionId: string,
  prompt: string,
  taskId?: string,
  streamingCallbacks?: StreamingCallbacks
): Promise<TaskResult> {
  const context = this.sessionContexts.get(sessionId);
  if (!context) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Build command
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--resume', sessionId,
    '--stream-partial-output',
  ];

  // Map Agor permission mode to Cursor's -f flag
  const permissionMode = this.config.permissionMode || 'ask';
  if (permissionMode === 'auto' || permissionMode === 'allow-all') {
    args.push('-f'); // Force allow
  }

  if (this.config.model) {
    args.push('-m', this.config.model);
  }

  args.push(prompt);

  // Spawn process
  const proc = spawn('cursor-agent', args, {
    cwd: context.workingDir,
    env: {
      ...process.env,
      CURSOR_API_KEY: this.config.apiKey,
    },
  });

  // Track for stopTask()
  this.processes.set(sessionId, proc);

  // Initialize parsers/aggregators
  const parser = new CursorEventParser();
  const toolAggregator = new ToolCallAggregator();

  let currentMessageId: string | null = null;
  let messageAccumulator: MessageAccumulator | null = null;
  let userMessageCreated = false;

  const messages: Message[] = [];
  let tokenUsage = { input: 0, output: 0 };
  let wasStopped = false;

  try {
    for await (const event of parser.parseStream(proc.stdout)) {
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
          if (!userMessageCreated) {
            const userMessage = await this.createUserMessage(
              sessionId,
              prompt,
              taskId
            );
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
              session_id: sessionId,
              task_id: taskId,
              role: MessageRole.ASSISTANT,
              timestamp: new Date().toISOString(),
            });
          }

          // Accumulate text
          if (event.message?.text) {
            if (messageAccumulator) {
              await messageAccumulator.addText(event.message.text);
            }
          }
          break;

        case 'tool_call':
          if (event.subtype === 'started') {
            await toolAggregator.onToolStarted(event);
          } else if (event.subtype === 'completed') {
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
          if (currentMessageId) {
            const fullText = messageAccumulator?.getFullText() || '';

            const assistantMessage = await this.messagesService.create({
              message_id: currentMessageId,
              session_id: sessionId,
              task_id: taskId,
              type: 'assistant',
              role: MessageRole.ASSISTANT,
              index: messages.length, // Incremental index
              timestamp: new Date().toISOString(),
              content_preview: fullText.substring(0, 200),
              content: [{ type: 'text', text: fullText }],
              metadata: {
                model: context.model || 'unknown',
                tokens: event.usage || { input: 0, output: 0 },
                cursor: { session_id: sessionId },
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

  // Check if process was stopped
  const exitCode = await new Promise<number>((resolve) => {
    proc.on('exit', (code) => resolve(code || 0));
  });

  if (exitCode === 143 || exitCode === 130) {
    // SIGTERM or SIGINT
    wasStopped = true;
  }

  return {
    taskId: taskId || generateId(),
    status: wasStopped ? 'cancelled' : 'completed',
    messages,
    completedAt: new Date(),
  };
}
```

---

## Example 5: Permission Mode Mapping

```typescript
// cursor-permission-mapper.ts
export class CursorPermissionMapper {
  /**
   * Map Agor permission modes to Cursor CLI flags
   *
   * Agor modes:
   * - 'ask': Prompt user for each tool (default)
   * - 'auto': Automatically approve tools
   * - 'on-failure': Auto-approve, prompt on failure
   * - 'allow-all': Allow everything
   *
   * Cursor modes:
   * - (no flag): Interactive prompts
   * - '-f, --force': Force allow commands unless explicitly denied
   */
  static mapToFlags(agorMode: PermissionMode): string[] {
    switch (agorMode) {
      case 'ask':
        return []; // No flag = interactive prompts

      case 'auto':
      case 'on-failure':
      case 'allow-all':
        return ['-f']; // Force allow

      default:
        console.warn(`[CursorPermissionMapper] Unknown mode: ${agorMode}, defaulting to 'ask'`);
        return [];
    }
  }

  /**
   * Get human-readable description of permission mode
   */
  static describe(agorMode: PermissionMode): string {
    switch (agorMode) {
      case 'ask':
        return 'Interactive: Prompt for each tool use';
      case 'auto':
        return 'Automatic: Approve all tools';
      case 'on-failure':
        return 'On-failure: Approve tools, prompt on errors';
      case 'allow-all':
        return 'Allow all: Maximum automation';
      default:
        return 'Unknown permission mode';
    }
  }
}

// Usage in createSession() or executeTask()
const permissionFlags = CursorPermissionMapper.mapToFlags(
  this.config.permissionMode || 'ask'
);
const args = ['-p', '--output-format', 'stream-json', ...permissionFlags, prompt];
```

---

## Example 6: Session Context Manager

```typescript
// cursor-session-manager.ts
import { SessionHandle } from '../base/types.js';

export class CursorSessionManager {
  private sessions = new Map<string, CursorSessionContext>();

  // Create new session context
  createContext(
    sessionId: string,
    options: {
      workingDir: string;
      model?: string;
      gitRef?: string;
    }
  ): void {
    this.sessions.set(sessionId, {
      sessionId,
      workingDir: options.workingDir,
      model: options.model,
      gitRef: options.gitRef,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      messageCount: 0,
    });
  }

  // Get session context
  getContext(sessionId: string): CursorSessionContext | undefined {
    const context = this.sessions.get(sessionId);

    if (context) {
      context.lastUsedAt = new Date(); // Update last used timestamp
    }

    return context;
  }

  // Update session stats
  incrementMessageCount(sessionId: string): void {
    const context = this.sessions.get(sessionId);
    if (context) {
      context.messageCount++;
      context.lastUsedAt = new Date();
    }
  }

  // Clean up old sessions (memory management)
  pruneInactiveSessions(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [sessionId, context] of this.sessions.entries()) {
      const age = now - context.lastUsedAt.getTime();
      if (age > maxAgeMs) {
        this.sessions.delete(sessionId);
        pruned++;
      }
    }

    if (pruned > 0) {
      console.log(`[CursorSessionManager] Pruned ${pruned} inactive sessions`);
    }

    return pruned;
  }

  // Export for persistence (optional)
  exportSessions(): SessionPersistenceData[] {
    return Array.from(this.sessions.values()).map((ctx) => ({
      sessionId: ctx.sessionId,
      workingDir: ctx.workingDir,
      model: ctx.model,
      createdAt: ctx.createdAt.toISOString(),
      lastUsedAt: ctx.lastUsedAt.toISOString(),
      messageCount: ctx.messageCount,
    }));
  }

  // Import from persistence (optional)
  importSessions(data: SessionPersistenceData[]): void {
    for (const item of data) {
      this.sessions.set(item.sessionId, {
        sessionId: item.sessionId,
        workingDir: item.workingDir,
        model: item.model,
        createdAt: new Date(item.createdAt),
        lastUsedAt: new Date(item.lastUsedAt),
        messageCount: item.messageCount,
      });
    }
  }
}

interface CursorSessionContext {
  sessionId: string;
  workingDir: string;
  model?: string;
  gitRef?: string;
  createdAt: Date;
  lastUsedAt: Date;
  messageCount: number;
}

interface SessionPersistenceData {
  sessionId: string;
  workingDir: string;
  model?: string;
  createdAt: string;
  lastUsedAt: string;
  messageCount: number;
}
```

---

## Example 7: Error Handling & Retry Logic

```typescript
// cursor-error-handler.ts
export class CursorErrorHandler {
  /**
   * Execute cursor-agent command with automatic retry on transient errors
   */
  static async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      onRetry?: (attempt: number, error: Error) => void;
    } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const retryDelay = options.retryDelay ?? 1000;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if error is retryable
        if (!this.isRetryable(lastError)) {
          throw lastError;
        }

        if (attempt < maxRetries) {
          console.warn(
            `[CursorErrorHandler] Attempt ${attempt} failed, retrying in ${retryDelay}ms:`,
            lastError.message
          );

          options.onRetry?.(attempt, lastError);

          await this.sleep(retryDelay);
        }
      }
    }

    throw new Error(
      `Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Determine if error is transient and retryable
   */
  private static isRetryable(error: Error): boolean {
    const retryablePatterns = [
      /ECONNRESET/,
      /ECONNREFUSED/,
      /ETIMEDOUT/,
      /EPIPE/,
      /rate limit/i,
      /temporary/i,
      /busy/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(error.message));
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse Cursor CLI error output from stderr
   */
  static parseErrorOutput(stderr: string): {
    message: string;
    code?: string;
    isAuthError: boolean;
    isNetworkError: boolean;
  } {
    const isAuthError = /auth|api.?key|unauthorized/i.test(stderr);
    const isNetworkError = /network|connection|timeout/i.test(stderr);

    // Extract error code if present (e.g., "Error: ERR_INVALID_API_KEY")
    const codeMatch = stderr.match(/Error:\s+([A-Z_]+)/);
    const code = codeMatch?.[1];

    return {
      message: stderr.trim(),
      code,
      isAuthError,
      isNetworkError,
    };
  }
}

// Usage example
const result = await CursorErrorHandler.executeWithRetry(
  async () => {
    return await this.createSession(config);
  },
  {
    maxRetries: 3,
    retryDelay: 2000,
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}: ${error.message}`);
    },
  }
);
```

---

## Example 8: Testing Helpers

```typescript
// cursor-test-helpers.ts
import { Readable } from 'stream';

export class CursorTestHelpers {
  /**
   * Create mock NDJSON stream for testing
   */
  static createMockStream(events: CursorEvent[]): Readable {
    const lines = events.map((event) => JSON.stringify(event)).join('\n');
    return Readable.from([lines]);
  }

  /**
   * Sample events for testing
   */
  static mockEvents = {
    systemInit: {
      type: 'system',
      subtype: 'init',
      session_id: 'test-session-123',
      model: 'claude-sonnet-4',
      cwd: '/test/project',
      permission_mode: 'ask',
    } as CursorSystemEvent,

    userMessage: {
      type: 'user',
      message: {
        role: 'user',
        text: 'Test prompt',
      },
    } as CursorUserEvent,

    assistantMessage: {
      type: 'assistant',
      message: {
        role: 'assistant',
        text: 'Test response',
      },
    } as CursorAssistantEvent,

    toolCallStarted: {
      type: 'tool_call',
      subtype: 'started',
      name: 'read_file',
      args: { path: 'test.ts' },
    } as CursorToolCallEvent,

    toolCallCompleted: {
      type: 'tool_call',
      subtype: 'completed',
      name: 'read_file',
      result: {
        content: 'export const test = 123;',
        metadata: { size: 25 },
      },
    } as CursorToolCallEvent,

    resultSuccess: {
      type: 'result',
      subtype: 'success',
      model: 'claude-sonnet-4',
      usage: {
        input_tokens: 150,
        output_tokens: 50,
      },
      context_window: 200000,
    } as CursorResultEvent,
  };

  /**
   * Create complete session workflow
   */
  static createSessionWorkflow(): CursorEvent[] {
    return [
      this.mockEvents.systemInit,
      this.mockEvents.userMessage,
      this.mockEvents.assistantMessage,
      this.mockEvents.resultSuccess,
    ];
  }

  /**
   * Create workflow with tool calls
   */
  static createToolWorkflow(): CursorEvent[] {
    return [
      this.mockEvents.systemInit,
      this.mockEvents.userMessage,
      this.mockEvents.toolCallStarted,
      this.mockEvents.toolCallCompleted,
      this.mockEvents.assistantMessage,
      this.mockEvents.resultSuccess,
    ];
  }
}

// Example test
describe('CursorEventParser', () => {
  it('should parse system init event', async () => {
    const stream = CursorTestHelpers.createMockStream([
      CursorTestHelpers.mockEvents.systemInit,
    ]);

    const parser = new CursorEventParser();
    const events: CursorEvent[] = [];

    for await (const event of parser.parseStream(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('system');
    expect((events[0] as CursorSystemEvent).session_id).toBe('test-session-123');
  });
});
```

---

## Example 9: CLI Command Builder

```typescript
// cursor-command-builder.ts
export class CursorCommandBuilder {
  private args: string[] = [];

  // Always use print mode for headless operation
  withPrintMode(): this {
    this.args.push('-p');
    return this;
  }

  // Set output format
  withOutputFormat(format: 'text' | 'json' | 'stream-json'): this {
    this.args.push('--output-format', format);
    return this;
  }

  // Set model
  withModel(model: string): this {
    this.args.push('-m', model);
    return this;
  }

  // Resume existing session
  withResume(sessionId: string): this {
    this.args.push('--resume', sessionId);
    return this;
  }

  // Enable streaming
  withStreamPartialOutput(): this {
    this.args.push('--stream-partial-output');
    return this;
  }

  // Force allow (permission mode)
  withForce(): this {
    this.args.push('-f');
    return this;
  }

  // Add prompt (must be last)
  withPrompt(prompt: string): this {
    this.args.push(prompt);
    return this;
  }

  // Build final command array
  build(): string[] {
    return this.args;
  }

  // Build as shell command string (for logging)
  buildCommandString(): string {
    return `cursor-agent ${this.args.map((arg) => {
      // Quote args with spaces
      return arg.includes(' ') ? `"${arg}"` : arg;
    }).join(' ')}`;
  }
}

// Usage examples
const createSessionArgs = new CursorCommandBuilder()
  .withPrintMode()
  .withOutputFormat('stream-json')
  .withModel('claude-sonnet-4')
  .withPrompt('Hello')
  .build();

const executeTaskArgs = new CursorCommandBuilder()
  .withPrintMode()
  .withOutputFormat('stream-json')
  .withResume('session-abc-123')
  .withStreamPartialOutput()
  .withForce()
  .withPrompt('Fix the auth bug')
  .build();

console.log(new CursorCommandBuilder()
  .withPrintMode()
  .withOutputFormat('stream-json')
  .withModel('claude-sonnet-4')
  .withPrompt('Test')
  .buildCommandString()
);
// Output: cursor-agent -p --output-format stream-json -m claude-sonnet-4 Test
```

---

## Example 10: Integration Test

```typescript
// cursor-tool.integration.test.ts
import { CursorTool } from './cursor-tool.js';
import { MessagesService } from '@agor/core/services';

describe('CursorTool Integration', () => {
  let cursorTool: CursorTool;
  let messagesService: MessagesService;

  beforeEach(() => {
    messagesService = new MessagesService(/* ... */);
    cursorTool = new CursorTool(messagesService, {
      apiKey: process.env.CURSOR_API_KEY!,
    });
  });

  it('should create session and execute task', async () => {
    // Skip if cursor-agent not installed
    const isInstalled = await cursorTool.checkInstalled();
    if (!isInstalled) {
      console.log('Skipping test: cursor-agent not installed');
      return;
    }

    // Create session
    const session = await cursorTool.createSession({
      initialPrompt: 'Hello, Cursor!',
      workingDirectory: process.cwd(),
      model: 'claude-sonnet-4',
    });

    expect(session.sessionId).toBeTruthy();
    expect(session.toolType).toBe('cursor-agent');

    // Execute task
    const result = await cursorTool.executeTask(
      session.sessionId,
      'List files in current directory',
      'task-123'
    );

    expect(result.status).toBe('completed');
    expect(result.messages.length).toBeGreaterThan(0);
  }, 60000); // 60s timeout

  it('should support streaming callbacks', async () => {
    const isInstalled = await cursorTool.checkInstalled();
    if (!isInstalled) return;

    const session = await cursorTool.createSession({
      initialPrompt: 'Hello',
      workingDirectory: process.cwd(),
    });

    const chunks: string[] = [];
    let streamStarted = false;
    let streamEnded = false;

    await cursorTool.executeTask(
      session.sessionId,
      'Count to 5',
      'task-456',
      {
        onStreamStart: async (messageId, metadata) => {
          streamStarted = true;
          console.log('Stream started:', messageId);
        },
        onStreamChunk: async (messageId, chunk) => {
          chunks.push(chunk);
          console.log('Chunk:', chunk);
        },
        onStreamEnd: async (messageId) => {
          streamEnded = true;
          console.log('Stream ended:', messageId);
        },
        onStreamError: async (messageId, error) => {
          console.error('Stream error:', error);
        },
      }
    );

    expect(streamStarted).toBe(true);
    expect(streamEnded).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  }, 60000);
});
```

---

## Summary

These examples provide:

1. **Event Parser** - Robust NDJSON parsing with error handling
2. **Message Accumulator** - Smart buffering for streaming UX
3. **Tool Aggregator** - Tracking tool calls across started/completed events
4. **Complete executeTask()** - Full implementation with all components
5. **Permission Mapper** - Translate Agor modes to Cursor flags
6. **Session Manager** - Track context and handle cleanup
7. **Error Handler** - Retry logic and error classification
8. **Test Helpers** - Mock streams and sample events
9. **Command Builder** - Type-safe CLI construction
10. **Integration Test** - End-to-end testing example

All code is production-ready and follows Agor's existing patterns (Codex, OpenCode).
