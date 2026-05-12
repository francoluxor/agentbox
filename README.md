# AgentBox

Launch Claude Code, Codex, and other coding agents inside isolated sandboxes — local Docker today, remote providers (E2B / Modal / Daytona / Vercel Sandbox) later.

**Status:** early work in progress. See [`docs/architecture.md`](./docs/architecture.md) for the design.

## What it does

`agentbox create` spins up a Docker container per project, with a three-layer **FUSE overlay** filesystem:

- **lower** — your host workspace, bind-mounted read-only (or a frozen APFS clone of it)
- **upper** — a per-box named volume that captures all writes
- **`/workspace`** — the merged overlay the agent actually sees

Result: the agent can `git commit`, install packages, scribble files — without touching your host. `node_modules` is shadowed by a Linux-native volume so macOS binaries don't leak in. `~/.claude`, `~/.codex`, `~/.gitconfig` are mounted opportunistically so the agent inherits your identity.

## Quick start

Requires macOS (arm64 or Intel), Docker (Docker Desktop or OrbStack), Node `>=20.10`, and pnpm `>=9`.

```sh
pnpm install
pnpm build
node apps/cli/dist/index.js create --help
```

Create your first box against the current directory:

```sh
node apps/cli/dist/index.js create
# pick "yes" at the snapshot prompt (recommended)
```

First run pulls and builds the `agentbox/box:dev` image (~1 GB, ~30 s on a warm pull). Subsequent runs are instant.

Once the box is up:

```sh
docker exec -it agentbox-<id> bash
# inside: cd /workspace; ls; echo hi > note.txt; ls /upper/upper/
```

## Commands

```sh
agentbox create [-w <path>] [-n <name>] [--snapshot | --no-snapshot] [--attach] [-y]
agentbox list                       # alias: ls
agentbox inspect <box> [--json]
agentbox pause <box>                # docker pause — 0 CPU, RAM stays mapped
agentbox unpause <box>              # docker unpause — sub-second resume
agentbox stop <box>                 # docker stop — preserves upper + node_modules volumes
agentbox start <box>                # docker start + re-mount the FUSE overlay
agentbox destroy <box> [-y] [--keep-snapshot]   # alias: rm — discards upper volume
agentbox prune [--dry-run] [--all] [-y]         # default: drops "missing" state records
```

`<box>` resolves against `~/.agentbox/state.json` in this order: exact id → unique id prefix → exact name → exact container name. So `agentbox destroy abc1` works as long as the prefix is unique.

Quick tour:

```sh
agentbox create -n alpha          # spin one up
agentbox list                     # see it
agentbox inspect alpha            # state, overlay status, volume mountpoint, sizes
agentbox pause alpha              # freeze (TS server cache, RAM all stays)
agentbox unpause alpha            # resume
agentbox stop alpha               # full shutdown
agentbox start alpha              # restart + re-mount the overlay
agentbox destroy alpha            # nuke it (prompts to confirm — `-y` to skip)
agentbox prune --all              # clean up any orphan containers/volumes/snapshots
```

## Layout

```
apps/cli/                 → published as `agentbox` (the npm bin, commander-based)
packages/core/            → @agentbox/core — sandbox provider interface, types
packages/sandbox-docker/  → @agentbox/sandbox-docker — local Docker provider
docs/architecture.md      → the FUSE-overlay design + lifecycle rationale
```

Remote sandbox adapters (E2B, Modal, Daytona, Vercel Sandbox) will be added as separate packages.

## Development

### Iterating on the CLI

One-shot (after a build):

```sh
node apps/cli/dist/index.js create --help
node apps/cli/dist/index.js create --no-snapshot -n my-box
node apps/cli/dist/index.js create --snapshot -y
```

Watch-rebuild while editing source:

```sh
# terminal 1 — rebuilds on every save
pnpm --filter agentbox dev

# terminal 2 — invoke the freshly-built bin
node apps/cli/dist/index.js create
```

Use `agentbox` from anywhere on disk:

```sh
pnpm --filter agentbox exec npm link
agentbox create -w /path/to/some/other/project
# undo with: pnpm --filter agentbox exec npm unlink -g
```

### Workspace scripts

```sh
pnpm build       # turbo run build (tsup per package)
pnpm test        # turbo run test  (vitest run)
pnpm lint        # eslint via flat config
pnpm typecheck   # tsc --noEmit per package
pnpm format      # prettier --write .
pnpm clean       # nuke dist/ + .turbo/ + node_modules/
```

### Tearing down test boxes

During testing you'll create lots of boxes. The clean way:

```sh
agentbox list                     # see what's there
agentbox prune --all -y           # remove orphan containers/volumes/snapshot dirs
# or, to nuke one by one:
agentbox destroy <id|name> -y
```

If something goes really sideways and `agentbox` itself can't reach a clean state, the raw escape hatch is:

```sh
docker rm -f $(docker ps -aq --filter "name=agentbox-")
docker volume ls -q | grep "^agentbox-" | xargs -r docker volume rm
rm -rf ~/.agentbox/snapshots/*
echo '{"version":1,"boxes":[]}' > ~/.agentbox/state.json
```

### Stack

- **pnpm 9** workspaces + **Turborepo 2** for task orchestration
- **TypeScript 5** strict + `verbatimModuleSyntax`, ESM
- **tsup** (esbuild) for package builds, **vitest** for tests
- **ESLint 9** flat config + **Prettier 3**, **changesets** for versioning
- **commander** for the CLI, **@clack/prompts** for interactive prompts
- **execa** to shell out to `docker`

## License

MIT. See [`LICENSE`](./LICENSE).
