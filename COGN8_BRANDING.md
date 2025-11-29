# Cogn8 Branding Configuration

This fork maintains **Cogn8** branding while staying compatible with upstream **Agor**.

## Branding Changes (Minimal)

This branch (`cogn8-branding`) contains only essential branding patches:

1. **AGOR_HOME environment variable** - Custom data directory support
   - Set `AGOR_HOME=~/.cogn8` to use cogn8 data directory
   - Defaults to `~/.agor` for upstream compatibility

2. **CLI bin alias** - `cogn8` command alongside `agor`
   - Both commands work identically
   - Allows gradual migration

## Upstream Sync Workflow

```bash
# 1. Fetch upstream changes
git fetch upstream

# 2. Rebase branding commits on top of upstream
git checkout cogn8-branding
git rebase upstream/main

# 3. Resolve any conflicts (usually minimal)
# Conflicts typically occur in:
#   - apps/agor-cli/package.json (bin entries)
#   - packages/core/src/config/config-manager.ts (AGOR_HOME)

# 4. Force push to your fork
git push --force-with-lease origin cogn8-branding

# 5. Rebuild
pnpm install && pnpm build
```

## Runtime Configuration

Instead of patching source code, prefer runtime configuration:

```bash
# Data directory
export AGOR_HOME="$HOME/.cogn8"

# CLI alias (in ~/.zshrc)
alias cogn8='AGOR_HOME=~/.cogn8 agor'
```

## Files Modified

| File                                         | Change            |
| -------------------------------------------- | ----------------- |
| `packages/core/src/config/config-manager.ts` | AGOR_HOME support |
| `apps/agor-cli/src/lib/daemon-manager.ts`    | AGOR_HOME support |
| `apps/agor-cli/src/lib/auth.ts`              | AGOR_HOME support |
| `apps/agor-cli/src/lib/context.ts`           | AGOR_HOME support |
| `apps/agor-cli/src/commands/init.ts`         | AGOR_HOME support |
| `apps/agor-cli/src/commands/db/migrate.ts`   | AGOR_HOME support |
| `apps/agor-cli/src/commands/db/status.ts`    | AGOR_HOME support |
| `apps/agor-daemon/src/index.ts`              | AGOR_HOME support |
| `packages/core/drizzle.config.ts`            | AGOR_HOME support |
| `packages/core/src/db/client.ts`             | AGOR_HOME support |
| `packages/core/src/seed/dev-fixtures.ts`     | AGOR_HOME support |
| `apps/agor-cli/package.json`                 | `cogn8` bin alias |

## Future Branding (Optional)

These can be added later if needed:

- [ ] UI title change (`apps/agor-ui/index.html`)
- [ ] Logo/favicon replacement
- [ ] Package name aliasing (`@cogn8/*`)
- [ ] Documentation updates

## Contributing Upstream

When making changes:

1. **Generic improvements** → Submit PR to upstream, then rebase
2. **Cogn8-specific** → Add to `cogn8-branding` branch only

This keeps the branding layer thin and maintainable.
