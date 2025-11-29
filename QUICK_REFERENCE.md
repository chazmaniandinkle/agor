# Cursor Integration - Quick Reference Card

**One-page cheat sheet for implementing Cursor Agent in Agor**

---

## 📋 Documents Map

| Document | Size | Purpose | Read When |
|----------|------|---------|-----------|
| **INTEGRATION_SUMMARY.md** | 9.5K | Executive summary & roadmap | Start here |
| **CURSOR_ITOOL_INTERFACE_MAPPING.md** | 28K | Complete design spec | Understanding design |
| **CURSOR_IMPLEMENTATION_EXAMPLES.md** | 27K | Code examples | Writing code |
| **QUICK_REFERENCE.md** | This | Cheat sheet | Quick lookups |

**Total**: 64.5K of documentation

---

## ⚡ Critical CLI Commands

```bash
# Create session (extracts session_id from output)
cursor-agent -p --output-format stream-json -m claude-sonnet-4 "Hello"

# Execute task (resume existing session)
cursor-agent -p --output-format stream-json --resume <sessionId> \
  --stream-partial-output "Your prompt"

# With force permission
cursor-agent -p --output-format stream-json --resume <sessionId> \
  -f "Your prompt"
```

---

## 🔢 ITool Method Cheatsheet

```typescript
// 1. Check if installed
checkInstalled() → execSync('which cursor-agent')

// 2. Create session
createSession(config) → spawn cursor-agent → parse session_id

// 3. Execute task (main method)
executeTask(sessionId, prompt, taskId?, callbacks?) →
  spawn cursor-agent --resume → parse NDJSON → create messages

// 4. Stop task
stopTask(sessionId) → proc.kill('SIGTERM')

// 5. Normalize response
normalizedSdkResponse(raw) → { model, usage, stopReason, ... }

// 6. Context window
computeContextWindow(sessionId) → sum message tokens
```

---

## 📦 NDJSON Event Quick Reference

```jsonl
// 1. System init - extract session_id
{"type":"system","subtype":"init","session_id":"abc123","model":"claude-sonnet-4"}

// 2. User message - log prompt
{"type":"user","message":{"role":"user","text":"Your prompt"}}

// 3. Assistant response - stream to UI
{"type":"assistant","message":{"role":"assistant","text":"Response chunk"}}

// 4. Tool started - track pending
{"type":"tool_call","subtype":"started","name":"read_file","args":{"path":"file.ts"}}

// 5. Tool completed - create message
{"type":"tool_call","subtype":"completed","name":"read_file","result":{"content":"..."}}

// 6. Result - finalize and extract tokens
{"type":"result","subtype":"success","usage":{"input_tokens":150,"output_tokens":50}}
```

---

## 🎨 Class Hierarchy

```
CursorTool (ITool)
├─ checkInstalled()
├─ getCapabilities()
├─ createSession()
├─ executeTask()           ← MAIN METHOD
│  ├─ CursorEventParser    (parses NDJSON)
│  ├─ MessageAccumulator   (buffers streaming)
│  ├─ ToolCallAggregator   (tracks tools)
│  └─ SessionManager       (context storage)
├─ stopTask()
├─ normalizedSdkResponse()
└─ computeContextWindow()
```

---

## 🔄 Event Flow Diagram

```
User Prompt
    ↓
Agor.executeTask(sessionId, prompt)
    ↓
spawn('cursor-agent', ['--resume', sessionId, prompt])
    ↓
NDJSON Stream
    ↓
┌─────────────────────────────────────┐
│  Parse Events                       │
├─────────────────────────────────────┤
│  system/init  → Extract session_id  │
│  user         → Create user msg     │
│  assistant    → Stream chunks       │
│  tool_call    → Track & store       │
│  result       → Finalize & tokens   │
└─────────────────────────────────────┘
    ↓
Messages in Agor DB
    ↓
TaskResult { status, messages, completedAt }
```

---

## 🚦 Capability Flags

```typescript
getCapabilities() {
  return {
    supportsSessionImport: false,   // ❌ No export API
    supportsSessionCreate: true,    // ✅ Via CLI
    supportsLiveExecution: true,    // ✅ Via CLI
    supportsSessionFork: false,     // ❌ Not supported
    supportsChildSpawn: false,      // ❌ Not supported
    supportsGitState: false,        // ❌ Not tracked
    supportsStreaming: true,        // ✅ Via buffering
  };
}
```

---

## 🔐 Permission Mapping

```typescript
// Agor → Cursor
'ask'        → []        // No -f flag
'auto'       → ['-f']    // Force allow
'on-failure' → ['-f']    // Force allow
'allow-all'  → ['-f']    // Force allow
```

---

## 🧪 Streaming Buffer Strategy

```typescript
// Buffer config
const CHUNK_SIZE_WORDS = 5;      // Flush every 5 words
const FLUSH_INTERVAL_MS = 100;    // Or every 100ms

// Flush triggers
- Word count >= 5
- Time since last flush >= 100ms
- Sentence boundary (. ! ? \n\n)
- Stream end
```

---

## 🐛 Error Handling Pattern

```typescript
try {
  for await (const line of readline) {
    try {
      const event = JSON.parse(line);
      // Process event
    } catch (parseErr) {
      console.error('Malformed JSON:', line);
      continue; // Skip bad line
    }
  }
} catch (streamErr) {
  // Handle stream errors
  await callbacks?.onStreamError(messageId, streamErr);
} finally {
  // ALWAYS cleanup
  this.processes.delete(sessionId);
}
```

---

## 📊 Testing Checklist

```typescript
// Unit tests
✅ Parse system/init event
✅ Extract session_id correctly
✅ Buffer streaming chunks
✅ Match tool started/completed
✅ Generate unique tool IDs
✅ Handle malformed JSON gracefully

// Integration tests
✅ Create session with real CLI
✅ Execute task and get response
✅ Stream callbacks fire correctly
✅ Messages created in DB
✅ Stop task works
✅ Session resume works
```

---

## 🔧 Common Patterns

### Spawn Process
```typescript
const proc = spawn('cursor-agent', args, {
  cwd: workingDir,
  env: { ...process.env, CURSOR_API_KEY: apiKey },
});
```

### Parse NDJSON
```typescript
const readline = createInterface({ input: proc.stdout });
for await (const line of readline) {
  const event = JSON.parse(line);
  // Handle event
}
```

### Track Process
```typescript
this.processes.set(sessionId, proc);
// ... later ...
this.processes.delete(sessionId);
```

### Generate Tool ID
```typescript
const toolId = `toolu_${generateId().slice(0, 12)}`;
```

---

## 🎯 Implementation Priorities

### P0 (Must Have)
1. Basic session creation
2. Simple executeTask (no streaming)
3. NDJSON event parser
4. Message creation in Agor DB

### P1 (Should Have)
1. Streaming support
2. Tool call tracking
3. Error handling
4. Process cleanup

### P2 (Nice to Have)
1. Retry logic
2. Advanced error classification
3. Session persistence
4. Metrics & monitoring

---

## 📝 Code Snippets

### Minimal executeTask
```typescript
async executeTask(sessionId: string, prompt: string) {
  const proc = spawn('cursor-agent', [
    '-p', '--output-format', 'stream-json',
    '--resume', sessionId, prompt
  ]);

  const readline = createInterface({ input: proc.stdout });
  for await (const line of readline) {
    const event = JSON.parse(line);
    if (event.type === 'assistant') {
      // Create message
    }
  }
}
```

### Extract Session ID
```typescript
for await (const line of readline) {
  const event = JSON.parse(line);
  if (event.type === 'system' && event.subtype === 'init') {
    return event.session_id;
  }
}
```

### Buffer Streaming
```typescript
const accumulator = new MessageAccumulator(messageId, onChunk);
for await (const event of parser.parseStream(proc.stdout)) {
  if (event.type === 'assistant') {
    await accumulator.addText(event.message.text);
  }
}
await accumulator.flush();
```

---

## 🔗 Quick Links

**Cursor Docs**:
- CLI: https://cursor.com/blog/cli
- Output Format: https://cursor.com/docs/cli/reference/output-format
- Parameters: https://cursor.com/docs/cli/reference/parameters

**Agor Reference**:
- Codex: `agor-live/dist/executor/sdk-handlers/codex/codex-tool.js`
- OpenCode: `agor-live/dist/executor/sdk-handlers/opencode/opencode-tool.js`
- ITool: `agor-live/dist/executor/sdk-handlers/base/tool.interface.d.ts`

**Local Docs**:
- Design: `./CURSOR_ITOOL_INTERFACE_MAPPING.md`
- Examples: `./CURSOR_IMPLEMENTATION_EXAMPLES.md`
- Summary: `./INTEGRATION_SUMMARY.md`

---

**Print this for desk reference!** 🖨️
