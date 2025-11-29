# Agor Fork Setup

## Repository Status

**Fork**: `chazmaniandinkle/agor`
**Upstream**: `preset-io/agor`
**Local Clone**: `/Users/slowbro/.agor/repos/agor-fork`

## Remotes Configured

```
origin    https://github.com/chazmaniandinkle/agor.git
upstream  https://github.com/preset-io/agor.git
```

## Next Steps

### 1. Register in Agor UI

The CLI login is not working from this session. To register the fork:

1. Open Agor UI (http://localhost:3000 or your Agor URL)
2. Go to Repositories section
3. Add local repository: `/Users/slowbro/.agor/repos/agor-fork`

Or use CLI after logging in:
```bash
agor login
agor repo add-local /Users/slowbro/.agor/repos/agor-fork
```

### 2. Create Cursor Integration Branch

```bash
cd /Users/slowbro/.agor/repos/agor-fork
git checkout -b feat/cursor-integration
```

### 3. Sync with Upstream (when needed)

```bash
git fetch upstream
git merge upstream/main
```

## Project Structure

```
agor-fork/
├── apps/
│   ├── browser/          # Frontend UI (React)
│   └── daemon/           # Backend server
├── packages/
│   ├── agor-live/        # CLI + core logic
│   └── ...
├── context/              # Agent context files
└── scripts/              # Build/dev scripts
```

## Cursor Integration Target

Files to create in `packages/agor-live/src/executor/sdk-handlers/cursor/`:
- `cursor-tool.ts`
- `cursor-event-parser.ts`
- `cursor-message-accumulator.ts`
- `cursor-tool-aggregator.ts`
- `cursor-permission-mapper.ts`
- `cursor-session-manager.ts`
- `cursor-error-handler.ts`
- `cursor-command-builder.ts`
- `types.ts`
- `index.ts`

## Development Commands

```bash
# Install dependencies
pnpm install

# Run development servers
pnpm dev

# Build all packages
pnpm build

# Run specific package
pnpm --filter @agor/agor-live dev
```
