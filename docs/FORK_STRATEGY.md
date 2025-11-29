# Agor Fork Strategy

## Vision

Transform Agor into a personalized multi-agent orchestration platform with:
- Custom branding and UI
- Extended agentic tool support (starting with Cursor)
- Integration with CogOS ecosystem
- Novel features beyond upstream

## Fork Philosophy

### Cherry-Pick from Upstream
- Bug fixes
- Performance improvements
- Core SDK enhancements
- Security patches

### Diverge for Customization
- UI/UX rebrand
- New agentic tools
- CogOS-specific features
- Workflow customizations

## Immediate Priorities

### Priority 1: Cursor CLI Integration
- Add `cursor` as 5th agentic tool
- Full ITool implementation
- NDJSON event processing
- Session management

**Status**: Design complete, ready for implementation
**Reference**: `CURSOR_ITOOL_INTERFACE_MAPPING.md`, `CURSOR_IMPLEMENTATION_EXAMPLES.md`

### Priority 2: UI Rebrand (Future)
- Custom color scheme
- New logo/branding
- Modified navigation
- CogOS visual language

### Priority 3: CogOS Integration
- Cogdoc-aware sessions
- Memory system integration
- Role-based agent spawning
- Workspace context injection

## Technical Approach

### Branching Strategy

```
main                    # Stable releases
├── feat/cursor-integration   # Cursor tool
├── feat/ui-rebrand          # Visual customization
├── feat/cogos-integration   # CogOS features
└── upstream-sync            # Cherry-picks from preset-io/agor
```

### Upstream Sync Process

```bash
# Fetch upstream changes
git fetch upstream

# Review changes
git log main..upstream/main --oneline

# Cherry-pick specific commits
git cherry-pick <commit-sha>

# Or merge specific branches
git merge upstream/main --no-commit
# Review, resolve conflicts, commit
```

### Release Strategy

1. Develop features in feature branches
2. Test thoroughly
3. Merge to main
4. Tag releases with custom versioning (e.g., `cogos-v0.1.0`)

## Ideas Backlog

(Space for your 12+ ideas - add them here as they crystallize)

### Agent Orchestration
- [ ] Idea 1: _____________
- [ ] Idea 2: _____________

### UI/UX
- [ ] Idea 3: _____________
- [ ] Idea 4: _____________

### Workflow
- [ ] Idea 5: _____________
- [ ] Idea 6: _____________

### Integration
- [ ] Idea 7: _____________
- [ ] Idea 8: _____________

### Novel Features
- [ ] Idea 9: _____________
- [ ] Idea 10: _____________
- [ ] Idea 11: _____________
- [ ] Idea 12: _____________

## Success Metrics

- [ ] Cursor integration working end-to-end
- [ ] Can spawn Cursor sessions from Agor UI
- [ ] Messages flow correctly through NDJSON parser
- [ ] Tool calls tracked and displayed
- [ ] Session resume functional
- [ ] Custom branding applied (when ready)
- [ ] CogOS integration working (when ready)

## Timeline

| Phase | Focus | Target |
|-------|-------|--------|
| 1 | Cursor integration | This week |
| 2 | Testing & polish | Next week |
| 3 | UI exploration | When ready |
| 4 | CogOS integration | After UI |

---

*This is your fork. Build what you want.*
