# Cursor Agent → Agor ITool Interface Mapping

**Status**: Design Document
**Date**: 2025-11-28
**Author**: Interface Mapping Specialist

## Executive Summary

This document maps the Cursor Agent CLI capabilities to Agor's ITool interface requirements, providing a complete integration blueprint for adding Cursor as a supported agentic tool alongside Claude Code, Codex, OpenCode, and Gemini.

---

## 1. Interface Mapping Table

| ITool Method | Implementation Strategy | Cursor CLI Command | Expected Output | Parsing Notes |
|--------------|------------------------|-------------------|-----------------|---------------|
| `getCapabilities()` | Static return | N/A | Object | Return capability flags |
| `checkInstalled()` | Check binary | `which cursor-agent` | Path or error | Return true if exits 0 |
| `createSession()` | Start new chat | `cursor-agent -p --output-format stream-json "init"` | NDJSON stream | Extract `session_id` from `system/init` event |
| `executeTask()` | Send prompt | `cursor-agent -p --output-format stream-json --resume <sessionId> "<prompt>"` | NDJSON stream | Parse events, create Agor messages |
| `stopTask()` | Process kill | `kill -SIGTERM <pid>` | N/A | Track PIDs, send signal |
| `getSessionMetadata()` | Read session dir | Filesystem access | JSON/files | Parse `~/.cursor/sessions/<id>/metadata.json` (if exists) |
| `getSessionMessages()` | Read session history | Filesystem access | JSON/files | Parse session directory structure |
| `normalizedSdkResponse()` | Event transformer | N/A | Normalized object | Convert NDJSON to Agor format |
| `computeContextWindow()` | Sum tokens | Query messages | Number | Sum token counts from message metadata |

---

## 2. Cursor CLI Capabilities

### Available Features (from official docs)

| Feature | CLI Flag | Value | Description |
|---------|----------|-------|-------------|
| **Headless mode** | `-p, --print` | boolean | Non-interactive output to stdout |
| **Output format** | `--output-format` | `text|json|stream-json` | Response formatting |
| **Model selection** | `-m, --model` | string | Specify model (e.g., `claude-3-5-sonnet`) |
| **Session resume** | `--resume` | chatId | Continue existing session |
| **Permission mode** | `-f, --force` | boolean | Force allow commands unless explicitly denied |
| **MCP support** | `mcp list` | N/A | List configured MCP servers |
| **Streaming** | `--stream-partial-output` | boolean | Stream text deltas incrementally |
| **API key** | `-a, --api-key` | string | Auth (or `CURSOR_API_KEY` env var) |

### Output Format: `stream-json` (NDJSON)

Emits newline-delimited JSON events:

```jsonl
{"type":"system","subtype":"init","session_id":"abc123","model":"claude-sonnet-4","permission_mode":"ask"}
{"type":"user","message":{"role":"user","text":"Your prompt"}}
{"type":"assistant","message":{"role":"assistant","text":"Response chunk"}}
{"type":"tool_call","subtype":"started","name":"read_file","args":{"path":"file.ts"}}
{"type":"tool_call","subtype":"completed","name":"read_file","result":{"content":"...","metadata":{}}}
{"type":"result","subtype":"success","output":"Final result"}
```

**Event Types**:
- `system/init` - Session metadata
- `user` - User prompt
- `assistant` - AI response (may stream as deltas)
- `tool_call` - Tool execution (started/completed)
- `result` - Terminal event (success/error)

---

## 3. Implementation Blueprint

### 3.1 CursorTool Class Structure

```typescript
export class CursorTool implements ITool {
  toolType = 'cursor-agent' as const;
  name = 'Cursor Agent';

  private processes = new Map<SessionID, ChildProcess>();
  private sessionContexts = new Map<SessionID, SessionContext>();

  constructor(
    private messagesService: MessagesService,
    private tasksService: TasksService,
    private config: CursorConfig
  ) {}

  getCapabilities(): ToolCapabilities {
    return {
      supportsSessionImport: false,      // Not yet - need session export API
      supportsSessionCreate: true,       // ✅ Via cursor-agent CLI
      supportsLiveExecution: true,       // ✅ Via cursor-agent CLI
      supportsSessionFork: false,        // Not supported by Cursor
      supportsChildSpawn: false,         // Not supported by Cursor
      supportsGitState: false,           // Cursor doesn't track git natively
      supportsStreaming: true,           // ✅ Via --stream-partial-output
    };
  }

  async checkInstalled(): Promise<boolean> {
    try {
      execSync('which cursor-agent', { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  async createSession(config: CreateSessionConfig): Promise<SessionHandle> {
    // Implementation in 3.2
  }

  async executeTask(
    sessionId: string,
    prompt: string,
    taskId?: string,
    streamingCallbacks?: StreamingCallbacks
  ): Promise<TaskResult> {
    // Implementation in 3.3
  }

  async stopTask(sessionId: string, taskId?: string): Promise<{
    success: boolean;
    partialResult?: Partial<TaskResult>;
    reason?: string;
  }> {
    // Implementation in 3.4
  }

  normalizedSdkResponse(rawResponse: RawSdkResponse): NormalizedSdkResponse {
    // Implementation in 3.5
  }
}
```

---

### 3.2 `createSession()` Implementation

```typescript
async createSession(config: CreateSessionConfig): Promise<SessionHandle> {
  const workingDir = config.workingDirectory || process.cwd();

  // Build command
  const args = [
    '-p',                              // Print mode (headless)
    '--output-format', 'stream-json',  // NDJSON output
    '-m', config.model || 'claude-sonnet-4',
  ];

  if (config.initialPrompt) {
    args.push(config.initialPrompt);
  } else {
    args.push('Hello'); // Minimal init prompt
  }

  // Spawn process
  const proc = spawn('cursor-agent', args, {
    cwd: workingDir,
    env: {
      ...process.env,
      CURSOR_API_KEY: this.config.apiKey,
    },
  });

  // Parse NDJSON stream to extract session_id
  let sessionId: string | null = null;
  const readline = createInterface({ input: proc.stdout });

  for await (const line of readline) {
    const event = JSON.parse(line);

    if (event.type === 'system' && event.subtype === 'init') {
      sessionId = event.session_id;
      break;
    }
  }

  if (!sessionId) {
    throw new Error('Failed to extract session_id from cursor-agent output');
  }

  // Store process reference for later resumption
  this.sessionContexts.set(sessionId, {
    workingDir,
    model: config.model,
    createdAt: new Date(),
  });

  // Wait for process to complete initial prompt
  await new Promise((resolve) => proc.on('exit', resolve));

  return {
    sessionId,
    toolType: 'cursor-agent',
  };
}
```

**CLI Command**:
```bash
cursor-agent -p --output-format stream-json -m claude-sonnet-4 "Hello"
```

**Expected Output**:
```jsonl
{"type":"system","subtype":"init","session_id":"abc123-def456","model":"claude-sonnet-4","cwd":"/path/to/project"}
{"type":"user","message":{"role":"user","text":"Hello"}}
{"type":"assistant","message":{"role":"assistant","text":"Hi! How can I help?"}}
{"type":"result","subtype":"success"}
```

---

### 3.3 `executeTask()` Implementation

```typescript
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

  // Build command with --resume flag
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--resume', sessionId,
    '--stream-partial-output',  // Enable streaming
    prompt,
  ];

  // Spawn process
  const proc = spawn('cursor-agent', args, {
    cwd: context.workingDir,
    env: {
      ...process.env,
      CURSOR_API_KEY: this.config.apiKey,
    },
  });

  // Track process for stopTask()
  this.processes.set(sessionId, proc);

  // Parse NDJSON stream
  const messages: Message[] = [];
  let currentMessageId: string | null = null;
  let currentText = '';
  let tokenUsage = { input: 0, output: 0 };

  const readline = createInterface({ input: proc.stdout });

  for await (const line of readline) {
    const event = JSON.parse(line) as CursorEvent;

    switch (event.type) {
      case 'user':
        // Create user message in Agor DB
        await this.createUserMessage(sessionId, prompt, taskId);
        break;

      case 'assistant':
        // Stream to UI if callbacks provided
        if (streamingCallbacks && !currentMessageId) {
          currentMessageId = generateId();
          await streamingCallbacks.onStreamStart(currentMessageId, {
            session_id: sessionId,
            task_id: taskId,
            role: MessageRole.ASSISTANT,
            timestamp: new Date().toISOString(),
          });
        }

        if (streamingCallbacks && event.message?.text) {
          await streamingCallbacks.onStreamChunk(currentMessageId!, event.message.text);
        }

        currentText += event.message?.text || '';
        break;

      case 'tool_call':
        // Handle tool execution events
        if (event.subtype === 'completed') {
          await this.createToolMessage(sessionId, event, taskId);
        }
        break;

      case 'result':
        // Finalize assistant message
        if (currentMessageId) {
          await streamingCallbacks?.onStreamEnd(currentMessageId);

          await this.messagesService.create({
            message_id: currentMessageId,
            session_id: sessionId,
            task_id: taskId,
            type: 'assistant',
            role: MessageRole.ASSISTANT,
            index: 0, // Calculate from existing messages
            timestamp: new Date().toISOString(),
            content_preview: currentText.substring(0, 200),
            content: [{ type: 'text', text: currentText }],
            metadata: {
              model: context.model,
              tokens: tokenUsage,
            },
          });
        }
        break;
    }
  }

  // Clean up process reference
  this.processes.delete(sessionId);

  return {
    taskId: taskId || generateId(),
    status: 'completed',
    messages,
    completedAt: new Date(),
  };
}
```

**CLI Command**:
```bash
cursor-agent -p --output-format stream-json --resume abc123-def456 --stream-partial-output "Fix the bug in auth.ts"
```

**Expected Output**:
```jsonl
{"type":"user","message":{"role":"user","text":"Fix the bug in auth.ts"}}
{"type":"tool_call","subtype":"started","name":"read_file","args":{"path":"auth.ts"}}
{"type":"tool_call","subtype":"completed","name":"read_file","result":{"content":"...","metadata":{"size":1024}}}
{"type":"assistant","message":{"role":"assistant","text":"I found the issue on line 42..."}}
{"type":"tool_call","subtype":"started","name":"write_file","args":{"path":"auth.ts","content":"..."}}
{"type":"tool_call","subtype":"completed","name":"write_file","result":{"path":"auth.ts","stats":{"size":1100}}}
{"type":"assistant","message":{"role":"assistant","text":"Fixed! The bug was..."}}
{"type":"result","subtype":"success"}
```

---

### 3.4 `stopTask()` Implementation

```typescript
async stopTask(sessionId: string, taskId?: string): Promise<{
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

  return {
    success: true,
    partialResult: {
      taskId: taskId || 'unknown',
      status: 'cancelled',
    },
  };
}
```

**Implementation**: Send `SIGTERM` to the `cursor-agent` process tracked in `this.processes`.

---

### 3.5 `normalizedSdkResponse()` Implementation

```typescript
normalizedSdkResponse(rawResponse: RawSdkResponse): NormalizedSdkResponse {
  // rawResponse is the final NDJSON event with type="result"
  const cursorEvent = rawResponse as CursorResultEvent;

  return {
    model: cursorEvent.model || 'unknown',
    usage: {
      inputTokens: cursorEvent.usage?.input_tokens || 0,
      outputTokens: cursorEvent.usage?.output_tokens || 0,
      totalTokens:
        (cursorEvent.usage?.input_tokens || 0) +
        (cursorEvent.usage?.output_tokens || 0),
    },
    stopReason: cursorEvent.subtype === 'success' ? 'end_turn' : 'error',
    contextWindow: cursorEvent.context_window,
    rawSdkResponse: rawResponse,
  };
}
```

**Input** (Cursor NDJSON event):
```json
{
  "type": "result",
  "subtype": "success",
  "model": "claude-sonnet-4",
  "usage": {
    "input_tokens": 1250,
    "output_tokens": 380
  },
  "context_window": 200000
}
```

**Output** (Agor normalized format):
```json
{
  "model": "claude-sonnet-4",
  "usage": {
    "inputTokens": 1250,
    "outputTokens": 380,
    "totalTokens": 1630
  },
  "stopReason": "end_turn",
  "contextWindow": 200000,
  "rawSdkResponse": { /* original event */ }
}
```

---

## 4. Gap Analysis

| Feature | Status | Challenge | Mitigation Strategy |
|---------|--------|-----------|---------------------|
| **Session persistence** | ⚠️ Partial | Cursor manages sessions internally (`~/.cursor/sessions/`) | Parse session directory structure; use `--resume` flag |
| **Session import** | ❌ Not supported | No export API from Cursor | Mark `supportsSessionImport: false`; defer until API exists |
| **Fork/spawn** | ❌ Not supported | Cursor doesn't support session branching | Mark both `supportsSessionFork: false` and `supportsChildSpawn: false` |
| **State management** | ⚠️ Manual | Must track PIDs for `stopTask()` | Maintain `Map<SessionID, ChildProcess>` |
| **Token accounting** | ✅ Supported | Cursor includes `usage` in result events | Extract from final NDJSON event |
| **MCP servers** | ⚠️ Limited | Cursor has MCP support but unclear if exposed in CLI | Test with `cursor-agent mcp list`; may need separate config |
| **Permission modes** | ⚠️ Binary | Only `-f, --force` flag (not granular like Claude Code) | Map Agor's `ask|auto|allow-all` → Cursor's force flag |
| **Model selection** | ✅ Supported | `-m, --model` flag | Pass through from Agor config |
| **Streaming** | ✅ Supported | `--stream-partial-output` + NDJSON parsing | Buffer chunks at word boundaries (3-10 words) |

### Key Challenges

1. **Session Resume**: Cursor's `--resume` requires a chat ID that may not be easily discoverable. Need to extract from `system/init` event and persist.

2. **Permission Mapping**: Agor has granular modes (`ask`, `auto`, `on-failure`, `allow-all`). Cursor only has `-f/--force`. Proposed mapping:
   - `ask` → no `-f` flag (prompts user)
   - `auto` → `-f` flag (force allow)
   - `allow-all` → `-f` flag (force allow)

3. **Error Handling**: NDJSON stream may end prematurely on error. Need robust parsing:
   ```typescript
   try {
     const event = JSON.parse(line);
   } catch (err) {
     console.error('Failed to parse NDJSON:', line, err);
     continue; // Skip malformed lines
   }
   ```

4. **Context Window Computation**: Cursor may not provide cumulative token counts. Solution:
   - Query all messages for the session
   - Sum `metadata.tokens.input` + `metadata.tokens.output`
   - Cache result in `Task.computed_context_window`

---

## 5. Event Normalization Strategy

### Input: Cursor NDJSON Events

```typescript
type CursorEvent =
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; cwd: string; }
  | { type: 'user'; message: { role: 'user'; text: string; }; }
  | { type: 'assistant'; message: { role: 'assistant'; text: string; }; }
  | { type: 'tool_call'; subtype: 'started' | 'completed'; name: string; args?: any; result?: any; }
  | { type: 'result'; subtype: 'success' | 'error'; usage?: TokenUsage; };
```

### Output: Agor Message Format

```typescript
interface AgorMessage {
  message_id: string;       // UUIDv7 (generated by Agor)
  session_id: string;       // From Cursor session_id
  task_id?: string;         // Agor task ID
  type: 'user' | 'assistant';
  role: MessageRole;
  index: number;            // Sequential within session
  timestamp: string;        // ISO 8601
  content_preview: string;  // First 200 chars
  content: ContentBlock[];  // Structured content
  tool_uses?: ToolUse[];    // Tool invocations
  metadata?: {
    model?: string;
    tokens?: { input: number; output: number; };
    cursor?: { session_id: string; };
  };
}
```

### Normalization Mapping

| Cursor Event | Agor Message Field | Transformation |
|--------------|-------------------|----------------|
| `event.type` | `message.type` | Map `user` → `'user'`, `assistant` → `'assistant'` |
| `event.message.text` | `message.content[0].text` | Wrap text in `{ type: 'text', text: '...' }` |
| `event.session_id` | `message.session_id` | Direct mapping |
| `tool_call.name` | `message.tool_uses[].name` | Extract tool name |
| `tool_call.args` | `message.tool_uses[].input` | Map args to input |
| `tool_call.result` | `message.content[].tool_result` | Wrap in tool_result block |
| `result.usage` | `message.metadata.tokens` | Map `input_tokens` → `input`, `output_tokens` → `output` |

### Example Transformation

**Input (Cursor)**:
```json
{"type":"tool_call","subtype":"completed","name":"read_file","args":{"path":"auth.ts"},"result":{"content":"export const auth = ...","metadata":{"size":1024}}}
```

**Output (Agor)**:
```json
{
  "message_id": "01JDQWXY...",
  "session_id": "abc123-def456",
  "task_id": "01JDQWXZ...",
  "type": "assistant",
  "role": "assistant",
  "index": 2,
  "timestamp": "2025-11-28T12:34:56Z",
  "content_preview": "Read file: auth.ts (1024 bytes)",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_abc123",
      "name": "read_file",
      "input": { "path": "auth.ts" }
    },
    {
      "type": "tool_result",
      "tool_use_id": "toolu_abc123",
      "content": "export const auth = ...",
      "is_error": false
    }
  ],
  "tool_uses": [
    {
      "id": "toolu_abc123",
      "name": "read_file",
      "input": { "path": "auth.ts" }
    }
  ],
  "metadata": {
    "cursor": { "session_id": "abc123-def456" }
  }
}
```

---

## 6. Prototype Pseudocode

### Complete Implementation Outline

```typescript
// cursor-tool.ts
import { ITool, ToolCapabilities, CreateSessionConfig, SessionHandle, TaskResult } from '../base/tool.interface.js';
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { generateId } from '@agor/core';

export class CursorTool implements ITool {
  toolType = 'cursor-agent' as const;
  name = 'Cursor Agent';

  private processes = new Map<string, ChildProcess>();
  private sessionContexts = new Map<string, SessionContext>();

  constructor(
    private messagesService: MessagesService,
    private config: { apiKey: string }
  ) {}

  // 1. CAPABILITIES
  getCapabilities(): ToolCapabilities {
    return {
      supportsSessionImport: false,
      supportsSessionCreate: true,
      supportsLiveExecution: true,
      supportsSessionFork: false,
      supportsChildSpawn: false,
      supportsGitState: false,
      supportsStreaming: true,
    };
  }

  // 2. INSTALLATION CHECK
  async checkInstalled(): Promise<boolean> {
    try {
      execSync('which cursor-agent', { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  // 3. CREATE SESSION
  async createSession(config: CreateSessionConfig): Promise<SessionHandle> {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '-m', config.model || 'claude-sonnet-4',
      config.initialPrompt || 'Hello',
    ];

    const proc = spawn('cursor-agent', args, {
      cwd: config.workingDirectory || process.cwd(),
      env: {
        ...process.env,
        CURSOR_API_KEY: this.config.apiKey,
      },
    });

    let sessionId: string | null = null;
    const readline = createInterface({ input: proc.stdout });

    for await (const line of readline) {
      const event = JSON.parse(line);
      if (event.type === 'system' && event.subtype === 'init') {
        sessionId = event.session_id;
        break;
      }
    }

    if (!sessionId) throw new Error('Failed to create session');

    this.sessionContexts.set(sessionId, {
      workingDir: config.workingDirectory || process.cwd(),
      model: config.model,
      createdAt: new Date(),
    });

    await new Promise((resolve) => proc.on('exit', resolve));

    return { sessionId, toolType: 'cursor-agent' };
  }

  // 4. EXECUTE TASK (with streaming)
  async executeTask(
    sessionId: string,
    prompt: string,
    taskId?: string,
    streamingCallbacks?: StreamingCallbacks
  ): Promise<TaskResult> {
    const context = this.sessionContexts.get(sessionId);
    if (!context) throw new Error(`Session ${sessionId} not found`);

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--resume', sessionId,
      '--stream-partial-output',
      prompt,
    ];

    const proc = spawn('cursor-agent', args, {
      cwd: context.workingDir,
      env: {
        ...process.env,
        CURSOR_API_KEY: this.config.apiKey,
      },
    });

    this.processes.set(sessionId, proc);

    let currentMessageId: string | null = null;
    let currentText = '';
    const messages: Message[] = [];

    const readline = createInterface({ input: proc.stdout });

    for await (const line of readline) {
      const event = JSON.parse(line) as CursorEvent;

      switch (event.type) {
        case 'user':
          await this.createUserMessage(sessionId, prompt, taskId);
          break;

        case 'assistant':
          if (streamingCallbacks && !currentMessageId) {
            currentMessageId = generateId();
            await streamingCallbacks.onStreamStart(currentMessageId, {
              session_id: sessionId,
              task_id: taskId,
              role: MessageRole.ASSISTANT,
              timestamp: new Date().toISOString(),
            });
          }

          if (event.message?.text) {
            if (streamingCallbacks) {
              await streamingCallbacks.onStreamChunk(currentMessageId!, event.message.text);
            }
            currentText += event.message.text;
          }
          break;

        case 'tool_call':
          if (event.subtype === 'completed') {
            await this.createToolMessage(sessionId, event, taskId);
          }
          break;

        case 'result':
          if (currentMessageId) {
            await streamingCallbacks?.onStreamEnd(currentMessageId);

            const message = await this.messagesService.create({
              message_id: currentMessageId,
              session_id: sessionId,
              task_id: taskId,
              type: 'assistant',
              role: MessageRole.ASSISTANT,
              index: 0, // Calculate properly
              timestamp: new Date().toISOString(),
              content_preview: currentText.substring(0, 200),
              content: [{ type: 'text', text: currentText }],
              metadata: {
                model: context.model,
                tokens: event.usage || { input: 0, output: 0 },
              },
            });

            messages.push(message);
          }
          break;
      }
    }

    this.processes.delete(sessionId);

    return {
      taskId: taskId || generateId(),
      status: 'completed',
      messages,
      completedAt: new Date(),
    };
  }

  // 5. STOP TASK
  async stopTask(sessionId: string, taskId?: string): Promise<{
    success: boolean;
    partialResult?: Partial<TaskResult>;
    reason?: string;
  }> {
    const proc = this.processes.get(sessionId);

    if (!proc) {
      return { success: false, reason: 'No active process' };
    }

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.processes.delete(sessionId);

    return {
      success: true,
      partialResult: {
        taskId: taskId || 'unknown',
        status: 'cancelled',
      },
    };
  }

  // 6. NORMALIZE SDK RESPONSE
  normalizedSdkResponse(rawResponse: RawSdkResponse): NormalizedSdkResponse {
    const event = rawResponse as CursorResultEvent;

    return {
      model: event.model || 'unknown',
      usage: {
        inputTokens: event.usage?.input_tokens || 0,
        outputTokens: event.usage?.output_tokens || 0,
        totalTokens:
          (event.usage?.input_tokens || 0) +
          (event.usage?.output_tokens || 0),
      },
      stopReason: event.subtype === 'success' ? 'end_turn' : 'error',
      contextWindow: event.context_window,
      rawSdkResponse,
    };
  }

  // 7. COMPUTE CONTEXT WINDOW
  async computeContextWindow(sessionId: string, currentTaskId?: string): Promise<number> {
    // Query all messages for session (excluding current task)
    const messages = await this.messagesService.findBySessionId(sessionId);

    let totalTokens = 0;
    for (const msg of messages) {
      if (msg.task_id !== currentTaskId) {
        const tokens = msg.metadata?.tokens;
        if (tokens) {
          totalTokens += (tokens.input || 0) + (tokens.output || 0);
        }
      }
    }

    return totalTokens;
  }

  // Helper methods
  private async createUserMessage(sessionId: string, text: string, taskId?: string) {
    // Implementation
  }

  private async createToolMessage(sessionId: string, event: CursorToolCallEvent, taskId?: string) {
    // Implementation
  }
}

// Types
interface SessionContext {
  workingDir: string;
  model?: string;
  createdAt: Date;
}

type CursorEvent =
  | CursorSystemEvent
  | CursorUserEvent
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent;

interface CursorSystemEvent {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  cwd: string;
  permission_mode: string;
}

interface CursorUserEvent {
  type: 'user';
  message: {
    role: 'user';
    text: string;
  };
}

interface CursorAssistantEvent {
  type: 'assistant';
  message: {
    role: 'assistant';
    text: string;
  };
}

interface CursorToolCallEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  name: string;
  args?: Record<string, any>;
  result?: any;
}

interface CursorResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  context_window?: number;
}
```

---

## 7. Next Steps

1. **Prototype Development**
   - [ ] Create `cursor-tool.ts` based on pseudocode
   - [ ] Implement NDJSON parser with error handling
   - [ ] Add process tracking for `stopTask()`
   - [ ] Implement event normalizer

2. **Testing**
   - [ ] Unit tests for event parsing
   - [ ] Integration tests with real `cursor-agent` CLI
   - [ ] Test session resume functionality
   - [ ] Verify streaming callbacks work correctly

3. **Documentation**
   - [ ] Add cursor-agent installation instructions
   - [ ] Document permission mode mapping
   - [ ] Add troubleshooting guide for common errors
   - [ ] Create example usage in Agor context

4. **Integration**
   - [ ] Register CursorTool in Agor's tool registry
   - [ ] Add Cursor model configs (claude-sonnet-4, etc.)
   - [ ] Update UI to show Cursor sessions
   - [ ] Test with Agor's spawning/prompting workflows

---

## 8. References

### Official Documentation
- [Cursor Agent CLI Blog Post](https://cursor.com/blog/cli)
- [Using Headless CLI | Cursor Docs](https://cursor.com/docs/cli/headless)
- [Output Format Reference](https://cursor.com/docs/cli/reference/output-format)
- [Parameters Reference](https://cursor.com/docs/cli/reference/parameters)
- [Using Agent in CLI](https://cursor.com/docs/cli/using)

### Related Resources
- [Prettifying Cursor CLI Agent's Stream Format](https://tarq.net/posts/cursor-agent-stream-format/)
- [Cursor CLI Engineering Article](https://www.engineering.fyi/article/cursor-agent-cli)

### Agor Reference Implementations
- Codex Tool: `/Users/slowbro/.nvm/versions/node/v22.14.0/lib/node_modules/agor-live/dist/executor/sdk-handlers/codex/codex-tool.js`
- OpenCode Tool: `/Users/slowbro/.nvm/versions/node/v22.14.0/lib/node_modules/agor-live/dist/executor/sdk-handlers/opencode/opencode-tool.js`
- ITool Interface: `/Users/slowbro/.nvm/versions/node/v22.14.0/lib/node_modules/agor-live/dist/executor/sdk-handlers/base/tool.interface.d.ts`

---

**Document Status**: ✅ Complete
**Ready for Implementation**: Yes
**Estimated Complexity**: Medium (similar to Codex/OpenCode integrations)
