# AgentBox — context for Claude Code

`agentbox` is an npm CLI that spins up isolated Docker containers ("boxes") for coding agents (Claude Code, Codex, others) to work in, so they can't touch the host. Each box gets a FUSE overlay filesystem: the host workspace is bind-mounted read-only (or as a frozen APFS clone) and all writes go to a per-box named volume.

The full design — three-layer overlay, snapshot rationale, pause/resume strategy, what we explicitly rejected — lives in [`docs/architecture.md`](./docs/architecture.md). **Read it before making non-trivial changes to the lifecycle code.**

## Repo layout

```
apps/cli/                   commander-based npm bin (`agentbox`), entry `src/index.ts`
  src/commands/             one file per subcommand (create, list, inspect, pause, unpause, stop, start, destroy, prune)
  src/commands/_errors.ts   shared lifecycle-error → user-facing message mapper
packages/core/              @agentbox/core — SandboxProvider interface, BoxState, etc.
packages/sandbox-docker/    @agentbox/sandbox-docker — the local Docker provider
  Dockerfile.box            base:ubuntu + fuse-overlayfs + node + python
  src/create.ts             create orchestrator: image → snapshot? → volumes → run → mount → verify → persist
  src/lifecycle.ts          list/inspect/pause/unpause/stop/start/destroy/prune; BoxNotFoundError + AmbiguousBoxError
  src/{docker,image,overlay,snapshot,state}.ts
docs/architecture.md        the design doc — source of truth for *why*
```

**Box identifier resolution** (shared by every lifecycle command that takes `<box>`): `findBox(idOrName, state)` in `state.ts` matches in order: exact id → unique id prefix → exact name → exact container. Ambiguous prefix → `AmbiguousBoxError`; no match → `BoxNotFoundError`. Use `resolveBox()` in `lifecycle.ts` to get a `BoxRecord` from a CLI arg.

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

Full local-Docker lifecycle:

- `agentbox create` — builds the image on first run, creates the snapshot if requested, spins up the container, mounts the FUSE overlay, runs four self-checks, records the box.
- `agentbox list` / `inspect` — read from `~/.agentbox/state.json` and cross-reference `docker inspect` for live state (`running` / `paused` / `stopped` / `missing`).
- `agentbox pause` / `unpause` — `docker pause` / `docker unpause`.
- `agentbox stop` / `start` — `docker stop` / `docker start`. **`start` re-runs `mountOverlay()`** because the FUSE process dies with the container.
- `agentbox destroy` — force-removes container + volumes + snapshot dir + state record (prompts unless `-y`).
- `agentbox prune` — drops `missing` state records; `--all` also reaps orphan `agentbox-*` containers / volumes / snapshot dirs.

## What's not built yet (don't claim it works)

- Background rsync `/host-src → /snapshot` + atomic remount (the second half of the boot sequence in `architecture.md`).
- Any actual agent installation inside the box (no Claude Code, no Codex, no vscode-server, no browser tooling yet).
- VS Code Dev Containers attach automation.
- Auto-pause-on-idle / auto-stop policy.
- Exporting the upper volume on destroy (`--export <path>` flag).
- Remote providers (E2B / Modal / Daytona / Vercel Sandbox).
- Non-macOS host support for the snapshot path (`cp -c` is APFS-only; Linux fallback to `rsync --exclude` is TODO).

## Common workflows

Build + verify after changes:

```sh
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Manual end-to-end on this repo (slow path on first run — builds the image if missing):

```sh
node apps/cli/dist/index.js create --snapshot -y -n smoke
node apps/cli/dist/index.js list
node apps/cli/dist/index.js inspect smoke
node apps/cli/dist/index.js pause smoke && node apps/cli/dist/index.js unpause smoke
node apps/cli/dist/index.js stop smoke && node apps/cli/dist/index.js start smoke   # re-mounts overlay
node apps/cli/dist/index.js destroy smoke -y
```

Wipe everything if state drifts (see README → Development for the raw escape hatch); the preferred path is `agentbox prune --all -y`.

## Host environment assumed

macOS (arm64 tested), Docker via OrbStack or Docker Desktop. Container needs `--cap-add=SYS_ADMIN --device=/dev/fuse --security-opt=apparmor:unconfined` — `runBox` in `packages/sandbox-docker/src/docker.ts` is the single source of truth for those flags.
