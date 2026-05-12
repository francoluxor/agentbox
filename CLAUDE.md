# AgentBox — context for Claude Code

`agentbox` is an npm CLI that spins up isolated Docker containers ("boxes") for coding agents (Claude Code, Codex, others) to work in, so they can't touch the host. Each box gets a FUSE overlay filesystem: the host workspace is bind-mounted read-only (or as a frozen APFS clone) and all writes go to a per-box named volume.

The full design — three-layer overlay, snapshot rationale, pause/resume strategy, what we explicitly rejected — lives in [`docs/architecture.md`](./docs/architecture.md). **Read it before making non-trivial changes to the lifecycle code.**

## Important notes

 - You have docker and you are authorized to run docker commands, inspect containers, run commands inside containers, etc.

## Repo layout

```
apps/cli/                   commander-based npm bin (`agentbox`), entry `src/index.ts`
  src/commands/             one file per subcommand (create, list, inspect, pause, unpause, stop, start, destroy, prune)
  src/commands/_errors.ts   shared lifecycle-error → user-facing message mapper
packages/core/              @agentbox/core — SandboxProvider interface, BoxState, etc.
packages/sandbox-docker/    @agentbox/sandbox-docker — the local Docker provider
  Dockerfile.box            base:ubuntu + fuse-overlayfs + node + python + bundled agentbox-ctl
  src/create.ts             create orchestrator: image → snapshot? → volumes → run → mount → verify → ctl daemon → persist
  src/lifecycle.ts          list/inspect/pause/unpause/stop/start/destroy/prune; BoxNotFoundError + AmbiguousBoxError
  src/ctl.ts                launchCtlDaemon — `docker exec -d` the in-box supervisor
  src/{docker,image,overlay,snapshot,state}.ts
packages/ctl/               @agentbox/ctl — in-container supervisor + CLI (`agentbox-ctl`)
  src/bin.ts                bundled CJS bin (dist/bin.cjs, baked into the image)
  src/{daemon,supervisor,socket,client,config,render}.ts
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
- `~/.agentbox/boxes/<id>/run/ctl.sock` — host-side view of the in-box ctl socket (bind-mounted to `/run/agentbox/` in the container)
- Docker objects: containers `agentbox-<id|name>`, volumes `agentbox-upper-<id>` + `agentbox-nm-<id>`
- The box image is `agentbox/box:dev`, built locally from `packages/sandbox-docker/Dockerfile.box`. **Build context is the monorepo root** (so the Dockerfile can `COPY packages/ctl/dist/bin.cjs`); see `BUILD_CONTEXT_DIR` in `image.ts`.

## In-box supervisor (`@agentbox/ctl`)

- Reads `/workspace/agentbox.yaml`; runs declared services, restarts crashed ones with exponential backoff, captures logs to `/var/log/agentbox/<svc>.log`.
- Listens on `/run/agentbox/ctl.sock` (UNIX socket, newline-delimited JSON). Both the in-box `agentbox-ctl` client and host commands talk to the same socket — but the **host commands shell in via `docker exec`**, not the bind-mounted socket: Docker Desktop / OrbStack's VM boundary breaks `connect()` from the mac side, even though the file is visible.
- Launched by `launchCtlDaemon()` in `sandbox-docker/src/ctl.ts` (best-effort; missing/empty `agentbox.yaml` is fine and doesn't fail `create`). Same call is repeated in `startBox()` because the daemon dies with the container — same lifecycle as `mountOverlay()`.
- The bin is built as **CJS** (`dist/bin.cjs`) with all deps bundled — esbuild's ESM output poisons `require()` from CJS deps like commander. Library entry (`dist/index.js`) stays ESM.
- **Config validation has two sources of truth that must agree**: the runtime parser in `packages/ctl/src/config.ts` (used by the daemon and the host pre-flight) and the JSON Schema at `packages/ctl/schema/agentbox.schema.json` (used by editors). `packages/ctl/test/schema-drift.test.ts` feeds the same fixtures to both and asserts they accept/reject identically. The schema can't express cross-field rules (`max_ms >= initial_ms`) — those cases are marked `runtimeOnly` in the fixtures.
- `createBox` pre-validates the host's `agentbox.yaml` via `loadConfig` **before** any docker work; a `ConfigError` aborts create with the formatted message. The in-container daemon re-validates on start (defence in depth, and necessary because the file lives in the overlay and can change after create).
- Editors auto-wire via `# yaml-language-server: $schema=…` (Red Hat YAML extension reads it). The repo's `.vscode/settings.json` maps the schema for in-tree files.

## What works today

Full local-Docker lifecycle:

- `agentbox create` — builds the image on first run, creates the snapshot if requested, spins up the container, mounts the FUSE overlay, runs four self-checks, records the box.
- `agentbox list` / `inspect` — read from `~/.agentbox/state.json` and cross-reference `docker inspect` for live state (`running` / `paused` / `stopped` / `missing`).
- `agentbox pause` / `unpause` — `docker pause` / `docker unpause`.
- `agentbox stop` / `start` — `docker stop` / `docker start`. **`start` re-runs `mountOverlay()` and re-launches `agentbox-ctl daemon`** because both processes die with the container.
- `agentbox status` / `logs` — proxy into the in-box `agentbox-ctl` via `docker exec` (see "In-box supervisor" below).
- `agentbox destroy` — force-removes container + volumes + snapshot dir + per-box run dir (`~/.agentbox/boxes/<id>/`) + state record (prompts unless `-y`).
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
node apps/cli/dist/index.js status smoke                   # services managed by agentbox-ctl
node apps/cli/dist/index.js logs smoke <service> -f        # if you have an agentbox.yaml in the workspace
node apps/cli/dist/index.js pause smoke && node apps/cli/dist/index.js unpause smoke
node apps/cli/dist/index.js stop smoke && node apps/cli/dist/index.js start smoke   # re-mounts overlay + relaunches ctl
node apps/cli/dist/index.js destroy smoke -y
```

Wipe everything if state drifts (see README → Development for the raw escape hatch); the preferred path is `agentbox prune --all -y`.

## Host environment assumed

macOS (arm64 tested), Docker via OrbStack or Docker Desktop. Container needs `--cap-add=SYS_ADMIN --device=/dev/fuse --security-opt=apparmor:unconfined` — `runBox` in `packages/sandbox-docker/src/docker.ts` is the single source of truth for those flags.
