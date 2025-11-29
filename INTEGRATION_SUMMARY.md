# Agor × Cursor Integration - Summary

**Status**: Design Phase Complete ✅
**Deliverables**: 3 comprehensive documents
**Next Step**: Implementation
**Complexity**: Medium (similar to Codex/OpenCode)

---

## 📦 Deliverables

### 1. [CURSOR_ITOOL_INTERFACE_MAPPING.md](./CURSOR_ITOOL_INTERFACE_MAPPING.md) (6,500 words)
**Complete interface design specification**

✅ ITool method mapping table
✅ Cursor CLI capabilities reference
✅ Implementation blueprint with pseudocode
✅ Gap analysis and mitigation strategies
✅ Event normalization strategy
✅ Official documentation references

**Key sections**:
- Interface mapping for all 9 ITool methods
- Complete Cursor CLI flag reference
- NDJSON event types and structures
- Session management strategy
- Permission mode mapping

### 2. [CURSOR_IMPLEMENTATION_EXAMPLES.md](./CURSOR_IMPLEMENTATION_EXAMPLES.md) (4,800 words)
**Production-ready code examples**

✅ 10 concrete implementation patterns
✅ Event parser with error handling
✅ Streaming message accumulator
✅ Tool call aggregator
✅ Complete `executeTask()` method
✅ Error handling & retry logic
✅ Testing helpers & integration tests

**Examples cover**:
- NDJSON stream parsing
- Real-time streaming buffer
- Tool execution tracking
- Permission mode mapping
- Session context management
- CLI command building
- Integration testing

### 3. [INTEGRATION_SUMMARY.md](./INTEGRATION_SUMMARY.md) (this file)
**Quick reference and roadmap**

---

## 🎯 Implementation Roadmap

### Phase 1: Core Implementation (Est. 2-3 days)
- [ ] Create `cursor-tool.ts` implementing ITool interface
- [ ] Implement `CursorEventParser` for NDJSON parsing
- [ ] Implement `MessageAccumulator` for streaming
- [ ] Implement `ToolCallAggregator` for tool tracking
- [ ] Add process management for `stopTask()`
- [ ] Write unit tests for event parsing

### Phase 2: Integration (Est. 1-2 days)
- [ ] Register CursorTool in Agor's tool registry
- [ ] Add Cursor model configurations
- [ ] Test with Agor spawn/prompt workflows
- [ ] Verify streaming callbacks work
- [ ] Test session resume functionality

### Phase 3: Polish (Est. 1 day)
- [ ] Add error handling and retry logic
- [ ] Write integration tests with real CLI
- [ ] Add logging and debugging aids
- [ ] Update Agor UI to show Cursor sessions
- [ ] Document installation and usage

**Total estimated effort**: 4-6 days

---

## 🔑 Key Technical Decisions

### 1. Session Management
**Cursor manages sessions in `~/.cursor/sessions/`**

✅ Extract `session_id` from NDJSON `system/init` event
✅ Use `--resume <sessionId>` for subsequent prompts
✅ Maintain `Map<SessionID, SessionContext>` for Agor metadata

### 2. Permission Mapping
**Agor has 4 modes, Cursor has 1 flag**

```typescript
'ask'        → (no flag)  // Interactive prompts
'auto'       → -f         // Force allow
'on-failure' → -f         // Force allow
'allow-all'  → -f         // Force allow
```

### 3. Tool Call Tracking
**Cursor emits started/completed without IDs**

✅ Generate unique `toolu_<id>` for each tool
✅ Match completed events by tool name
✅ Create Agor messages on completion

### 4. Streaming Strategy
**Balance UX with efficiency**

✅ Buffer chunks (5 words or 100ms)
✅ Flush on sentence boundaries
✅ Always create complete message in DB after streaming

---

## 📊 Capability Matrix

| Feature | Support | Notes |
|---------|---------|-------|
| **Session Creation** | ✅ | Via `cursor-agent -p --output-format stream-json` |
| **Live Execution** | ✅ | Via `--resume <sessionId>` |
| **Streaming** | ✅ | Via `--stream-partial-output` + buffering |
| **Token Accounting** | ✅ | Extract from `result` event |
| **Model Selection** | ✅ | Via `-m, --model` flag |
| **Permission Modes** | ⚠️ | Binary only (-f flag) |
| **Session Import** | ❌ | Defer until API available |
| **Fork/Spawn** | ❌ | Not supported by Cursor |

Legend: ✅ Full support | ⚠️ Partial/workaround | ❌ Not supported

---

## 🧪 Quick Test

```bash
# 1. Install Cursor CLI
curl https://cursor.com/install -fsSL | bash

# 2. Authenticate
cursor-agent login

# 3. Test basic execution
cursor-agent -p --output-format stream-json "Hello, world"

# 4. Expected output (NDJSON):
# {"type":"system","subtype":"init","session_id":"abc123",...}
# {"type":"user","message":{"role":"user","text":"Hello, world"}}
# {"type":"assistant","message":{"role":"assistant","text":"Hi! How can I help?"}}
# {"type":"result","subtype":"success"}
```

---

## 🔗 Key References

### Official Cursor Docs
- [CLI Blog Post](https://cursor.com/blog/cli)
- [Headless Mode](https://cursor.com/docs/cli/headless)
- [Output Format](https://cursor.com/docs/cli/reference/output-format)
- [Parameters](https://cursor.com/docs/cli/reference/parameters)

### Agor Reference Implementations
- Codex Tool: `agor-live/dist/executor/sdk-handlers/codex/codex-tool.js`
- OpenCode Tool: `agor-live/dist/executor/sdk-handlers/opencode/opencode-tool.js`
- ITool Interface: `agor-live/dist/executor/sdk-handlers/base/tool.interface.d.ts`

---

## 🎨 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Agor Platform                        │
├─────────────────────────────────────────────────────────────┤
│  SessionsService  │  MessagesService  │  TasksService       │
└────────────┬────────────────┬─────────────────┬─────────────┘
             │                │                 │
             ▼                ▼                 ▼
     ┌───────────────────────────────────────────────────┐
     │              CursorTool (ITool impl)              │
     ├───────────────────────────────────────────────────┤
     │  • createSession()                                │
     │  • executeTask()                                  │
     │  • stopTask()                                     │
     │  • normalizedSdkResponse()                        │
     │  • computeContextWindow()                         │
     └────────┬──────────────────────────────────────────┘
              │
         ┌────┴─────┬──────────────┬──────────────┐
         │          │              │              │
         ▼          ▼              ▼              ▼
   EventParser  Accumulator  ToolAggregator  SessionMgr
         │          │              │              │
         └──────────┴──────────────┴──────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   cursor-agent CLI   │
              │  (NDJSON via stdout) │
              └──────────────────────┘
```

---

## 💡 Implementation Tips

### 1. Start Simple
Begin with `createSession()` and basic `executeTask()` without streaming.

### 2. Use Test Helpers
Copy `CursorTestHelpers` to create mock streams for unit testing.

### 3. Handle Errors Gracefully
NDJSON streams can end prematurely - use try/catch per line.

### 4. Log Everything
Add detailed logging to track NDJSON events during development.

### 5. Test with Real CLI
Integration tests with actual `cursor-agent` are essential.

---

## 🐛 Common Pitfalls

### ❌ Don't assume event order
NDJSON events may arrive out of sequence - buffer and match carefully.

### ❌ Don't ignore malformed JSON
Parse errors happen - skip bad lines, log warnings, continue.

### ❌ Don't forget process cleanup
Always remove from `processes` Map in finally blocks.

### ❌ Don't block on streaming
Use async generators and proper event handling.

### ❌ Don't trust tool IDs
Cursor doesn't provide them - generate your own.

---

## ✅ Success Criteria

- [ ] `cursor-agent --version` succeeds
- [ ] Can create new session via ITool
- [ ] Can execute task in existing session
- [ ] Streaming callbacks fire during execution
- [ ] Messages created in Agor database
- [ ] Tool calls tracked and stored
- [ ] Token usage captured from events
- [ ] Can stop running task gracefully
- [ ] Session resume works correctly
- [ ] All unit tests pass
- [ ] Integration tests pass with real CLI

---

## 📝 Next Actions

1. **Read** [CURSOR_ITOOL_INTERFACE_MAPPING.md](./CURSOR_ITOOL_INTERFACE_MAPPING.md) for complete design
2. **Copy** examples from [CURSOR_IMPLEMENTATION_EXAMPLES.md](./CURSOR_IMPLEMENTATION_EXAMPLES.md)
3. **Create** `cursor-tool.ts` in Agor SDK handlers directory
4. **Test** with mock streams first, then real CLI
5. **Integrate** with Agor's tool registry
6. **Document** installation and configuration

---

**Created by**: Interface Mapping Specialist
**Date**: 2025-11-28
**Status**: ✅ Design Complete, Ready for Implementation
**Estimated Implementation**: 4-6 days
