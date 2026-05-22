# AgentBox — context for Claude Code

`agentbox` is an npm CLI that spins up isolated Docker containers ("boxes") for coding agents (Claude Code, Codex, others) to work in, so they can't touch the host. Each box gets its own per-box git branch in an in-container worktree — `agentbox create` runs `git worktree add /workspace` *inside* the box against the bind-mounted host `.git/`, so `/workspace` lives in the container's writable layer and is isolated by branch, not by overlay.

## Architecture overview

- **Boxes** — one Docker container per agent run (`agentbox-<id|name>`). `/workspace` is the in-container git worktree on branch `agentbox/<box-name>`; the host's `.git/` is bind-mounted RW so commits land on the host immediately. Boxes pause/unpause for cheap context switching and survive stop/start; `destroy` wipes the container + per-box volumes.
- **In-box supervisor** (`@agentbox/ctl`) — reads `/workspace/agentbox.yaml` and runs the declared tasks/services under a DAG scheduler. Ships as `agentbox-ctl` inside every box.
- **Host relay** (`@agentbox/relay`) — a host node process boxes call for things they have no credentials for (`git push`, checkpoint capture) and to push status events. Keeps SSH keys out of the box.
- **Checkpoints** — `docker commit` (+ periodic `FROM scratch` flatten) captures a box's warm state as a local image tag so future boxes start populated instead of cold.
- The full design — file-handling rationale, the checkpoint model, pause/resume strategy, what we explicitly rejected — lives in [`docs/architecture.md`](./docs/architecture.md) and [`docs/create-and-checkpoints.md`](./docs/create-and-checkpoints.md). **Read them before making non-trivial changes to the lifecycle code.**

## Important notes

 - You have docker and you are authorized to run docker commands, inspect containers, run commands inside containers, etc.

## Conventions

- **TypeScript strict, ESM, `verbatimModuleSyntax`** — always `import type { … }` for types.
- **tsup** builds each package's `src/index.ts` → `dist/`. Don't reach into another package's `src/` from a sibling; consume via the package name.
- **vitest** for tests, default discovery (`test/**/*.test.ts`). Keep unit tests pure — no docker, no network. Integration testing is manual for now (see README → Development).
- **eslint + prettier**, flat config at repo root. `pnpm lint` and `pnpm format` are the commands.
- **commander** for CLI surface; **@clack/prompts** for any interactivity. Don't add a third prompts/CLI lib.
- **execa** for shelling out to `docker` (debuggable, no native deps). Don't introduce `dockerode` without a good reason. **One sanctioned native-dep exception**: `@homebridge/node-pty-prebuilt-multiarch` (ships ABI-stable N-API prebuilds, no end-user compiler) is used **only** by `agentbox dashboard` for the in-process terminal compositor. It is an `optionalDependencies` of `apps/cli` with a guarded dynamic import — a missing prebuild degrades `dashboard` to a clear error, never breaks the rest of the CLI.
- **No emojis in code or output** unless explicitly requested.
- **Comments only when the WHY is non-obvious** (a constraint, a workaround, a surprising invariant). Names should carry the WHAT.

## Documentation map

Each topic has a dedicated file under [`docs/`](./docs). Read the relevant one before changing that area.

- [`docs/architecture.md`](./docs/architecture.md) — the design doc: *why* the box/worktree/checkpoint model is shaped the way it is, and what was rejected.
- [`docs/create-and-checkpoints.md`](./docs/create-and-checkpoints.md) — implementation reference for `agentbox create` (file/git handling) and the checkpoint capture/restore mechanics.
- [`docs/repo-layout.md`](./docs/repo-layout.md) — the package tree, build wiring, and box-identifier / per-project-index resolution rules.
- [`docs/state.md`](./docs/state.md) — where every piece of state lives: `~/.agentbox/*`, docker objects, volumes, worktrees, the box image.
- [`docs/in-box-supervisor.md`](./docs/in-box-supervisor.md) — `@agentbox/ctl`: the DAG scheduler, tasks vs services, `ready_when`, `expose`/`WebProxy`, wire ops, config validation.
- [`docs/host-relay.md`](./docs/host-relay.md) — `@agentbox/relay`: the host process, per-box bearer token, endpoints, registration/rehydration, in-box `agentbox-ctl git`/`open`.
- [`docs/features.md`](./docs/features.md) — what works today (the full CLI lifecycle) and what is not built yet.
- [`docs/development.md`](./docs/development.md) — build + verify commands, manual end-to-end runs, the image-rebuild checklist, and assumed host environment.
