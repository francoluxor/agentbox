# AgentBox — context for Claude Code

`agentbox` is an npm CLI that spins up isolated Docker containers ("boxes") for coding agents (Claude Code, Codex, others) to work in, so they can't touch the host. Each box gets a FUSE overlay filesystem: the host workspace is bind-mounted read-only (or as a frozen APFS clone) and all writes go to a per-box named volume.

The full design — three-layer overlay, snapshot rationale, pause/resume strategy, what we explicitly rejected — lives in [`docs/architecture.md`](./docs/architecture.md). **Read it before making non-trivial changes to the lifecycle code.**

## Repo layout

```
apps/cli/                   commander-based npm bin (`agentbox`), entry `src/index.ts`
  src/commands/             one file per subcommand
packages/core/              @agentbox/core — SandboxProvider interface, BoxState, etc.
packages/sandbox-docker/    @agentbox/sandbox-docker — the local Docker provider
  Dockerfile.box            base:ubuntu + fuse-overlayfs + node + python
  src/create.ts             orchestrator: image → snapshot? → volumes → run → mount → verify → persist
  src/{docker,image,overlay,snapshot,state}.ts
docs/architecture.md        the design doc — source of truth for *why*
```

Internal deps are wired via `workspace:*`. Build order is enforced by Turborepo (`^build`).

## Conventions

- **TypeScript strict, ESM, `verbatimModuleSyntax`** — always `import type { … }` for types.
- **tsup** builds each package's `src/index.ts` → `dist/`. Don't reach into another package's `src/` from a sibling; consume via the package name.
- **vitest** for tests, default discovery (`test/**/*.test.ts`). Keep unit tests pure — no docker, no network. Integration testing is manual for now (see README → Development).
- **eslint + prettier**, flat config at repo root. `pnpm lint` and `pnpm format` are the commands.
- **commander** for CLI surface; **@clack/prompts** for any interactivity. Don't add a third prompts/CLI lib.
- **execa** for shelling out to `docker` (debuggable, no native deps). Don't introduce `dockerode` without a good reason.
- **No emojis in code or output** unless explicitly requested.
- **Comments only when the WHY is non-obvious** (a constraint, a workaround, a surprising invariant). Names should carry the WHAT.

## Where state lives

- `~/.agentbox/state.json` — registry of created boxes
- `~/.agentbox/snapshots/<id>/` — frozen APFS clones of host workspaces
- Docker objects: containers `agentbox-<id|name>`, volumes `agentbox-upper-<id>` + `agentbox-nm-<id>`
- The box image is `agentbox/box:dev`, built locally from `packages/sandbox-docker/Dockerfile.box`

## What works today

`agentbox create` only. It builds the image on first run, creates the snapshot if requested, spins up the container, mounts the FUSE overlay, runs four self-checks, and records the box.

## What's not built yet (don't claim it works)

- `list / pause / resume / stop / destroy` commands
- Background rsync `/host-src → /snapshot` + atomic remount (the second half of the boot sequence in `architecture.md`)
- Any actual agent installation inside the box (no Claude Code, no Codex, no vscode-server, no browser tooling yet)
- VS Code Dev Containers attach automation
- Remote providers (E2B / Modal / Daytona / Vercel Sandbox)
- Non-macOS host support for the snapshot path (`cp -c` is APFS-only; Linux fallback to `rsync --exclude` is TODO)

## Common workflows

Build + verify after changes:

```sh
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Manual end-to-end on this repo (slow path — builds the image if missing):

```sh
node apps/cli/dist/index.js create --snapshot -y -n smoke
docker exec -it agentbox-smoke bash
docker rm -f agentbox-smoke
```

Wipe all agentbox containers / volumes / state (see README → Development for the full snippet).

## Host environment assumed

macOS (arm64 tested), Docker via OrbStack or Docker Desktop. Container needs `--cap-add=SYS_ADMIN --device=/dev/fuse --security-opt=apparmor:unconfined` — `runBox` in `packages/sandbox-docker/src/docker.ts` is the single source of truth for those flags.
