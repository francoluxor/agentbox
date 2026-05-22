# Development

> Part of the AgentBox docs. Start at [CLAUDE.md](../CLAUDE.md).

## Common workflows

Build + verify after changes:

```sh
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Manual end-to-end on this repo (slow path on first run — builds the image if missing):

```sh
node apps/cli/dist/index.js create --host-snapshot -y -n smoke   # frozen APFS clone of host workspace as lower (renamed from --snapshot)
node apps/cli/dist/index.js create --with-env -y -n smoke-env   # also copies host .env*/secrets.toml/agentbox.yaml into /workspace
node apps/cli/dist/index.js checkpoint create smoke --set-default   # capture warm state -> smoke-1, project default
node apps/cli/dist/index.js checkpoint ls                       # `checkpoint` / `checkpoints` with no subcommand default to `ls`
node apps/cli/dist/index.js create -y -n smoke2                 # starts from the default checkpoint (warm)
node apps/cli/dist/index.js create -y -n smoke3 --snapshot smoke-1   # explicit checkpoint ref
node apps/cli/dist/index.js list
node apps/cli/dist/index.js status smoke --inspect
node apps/cli/dist/index.js status smoke                   # services + claude session state
node apps/cli/dist/index.js logs smoke <service> -f        # if you have an agentbox.yaml in the workspace
node apps/cli/dist/index.js pause smoke && node apps/cli/dist/index.js unpause smoke
node apps/cli/dist/index.js stop smoke && node apps/cli/dist/index.js start smoke   # re-mounts overlay + relaunches ctl
node apps/cli/dist/index.js open smoke           # rsync /workspace -> host export + open Finder
node apps/cli/dist/index.js open smoke --path   # just print the merged host export path (--no-refresh to skip rsync)
node apps/cli/dist/index.js open smoke --path   # same rsync as `open`, but just prints the host path (--no-refresh to skip)
node apps/cli/dist/index.js browser smoke        # open the box's web app URL in the browser (even with no expose:)
node apps/cli/dist/index.js screen smoke         # open the box's noVNC viewer in the browser
node apps/cli/dist/index.js wait smoke            # block until autostart units (tasks + services) ready
node apps/cli/dist/index.js code smoke            # auto-unpause/start + wait + write .vscode/tasks.json + open VS Code (or Cursor if `code` not in PATH)
node apps/cli/dist/index.js code smoke --ide cursor  # force Cursor (default: prefer `code`, fall back to `cursor`)
node apps/cli/dist/index.js code smoke --print    # just print the vscode-remote:// URL (after the warm-up)
node apps/cli/dist/index.js shell smoke           # interactive bash in /workspace (auto-unpause/start)
node apps/cli/dist/index.js shell smoke -- whoami # one-shot exec; prints "vscode"
node apps/cli/dist/index.js download claude smoke --dry-run  # list box-installed skills/plugins not on host (excl. agentbox-*)
node apps/cli/dist/index.js download claude smoke -y         # additive box->host download into ~/.claude (box may be stopped)
node apps/cli/dist/index.js download config smoke --dry-run  # just agentbox.yaml: show change without writing
node apps/cli/dist/index.js cp smoke:/workspace/some.txt ./   # one-off file copy box -> host (cwd)
node apps/cli/dist/index.js cp ./local.txt smoke:/workspace/  # one-off upload host -> box (chowned to vscode)
node apps/cli/dist/index.js destroy smoke -y
```

Git worktree end-to-end (run from inside a git checkout — this repo works):

```sh
node apps/cli/dist/index.js create -y -n git-smoke
git worktree list                              # the box's worktree shows up under ~/.agentbox/boxes/<id>/worktrees/root
docker exec agentbox-git-smoke bash -lc 'cd /workspace && git status'  # on branch agentbox/git-smoke
docker exec agentbox-git-smoke bash -lc 'cd /workspace && git commit --allow-empty -m "from-box"'
git log agentbox/git-smoke -1                  # commit visible on host immediately (.git/ is bind-mounted)
docker exec agentbox-git-smoke bash -lc 'agentbox-ctl git push -- --set-upstream origin agentbox/git-smoke'
# ↑ the RPC runs `git push` on the host with the user's creds; box has no SSH keys
node apps/cli/dist/index.js destroy git-smoke -y
git worktree list                              # cleaned up
```

Run Claude Code in a sandboxed box (detach with `Ctrl+a d`, reattach with `claude attach`):

```sh
node apps/cli/dist/index.js claude --host-snapshot -y -n cc -- --model sonnet
# (in tmux) Ctrl+a d to detach
node apps/cli/dist/index.js claude attach cc
node apps/cli/dist/index.js status cc --inspect  # shows "claude session: running (...) since ..."
node apps/cli/dist/index.js destroy cc -y
```

After **any** change that bakes into the box image, wipe the cached image so the next `create` rebuilds. The image is pinned to `agentbox/box:dev` and reused across creates — without an explicit rmi, you'll keep the stale copy. Watch out for:

- `packages/sandbox-docker/Dockerfile.box` (obvious)
- `packages/ctl/src/**` — the Dockerfile copies `packages/ctl/dist/bin.cjs` into `/usr/local/bin/agentbox-ctl`, so new wire ops / subcommands need a rebuild. The same goes for any change to `packages/ctl/tsup.config.ts` or the bundled bin.cjs output. **The `expose:` / `WebProxy` work is image-baked** (new `bin.cjs` parser + forwarder, plus `EXPOSE 80` + the `setcap cap_net_bind_service` on node in `Dockerfile.box`): existing boxes do **not** get the web port mapping or the `:80` forwarder until recreated (the `-p` is immutable; `startBox` cleanly skips boxes with no `BoxRecord.webContainerPort`). `agentbox self-update` already does `docker image rm -f agentbox/box:dev`.
- Updates to the Claude Code installer (the `curl claude.ai/install.sh` step in the Dockerfile).
- The Codex CLI install (`npm install -g @openai/codex` in `Dockerfile.box`) — a new `@openai/codex` release won't reach existing boxes until the image is rebuilt.
- The OpenCode CLI install (`npm install -g opencode-ai` in `Dockerfile.box`) — same: a new `opencode-ai` release needs an image rebuild to reach existing boxes.
- Updates to the `agent-browser` install (the `npm install -g agent-browser playwright` + `playwright install chromium` + `/usr/local/bin/chromium` symlink steps). A new agent-browser release, or a Playwright chromium revision bump, won't reach existing boxes until the image is rebuilt.
- Changes to `packages/sandbox-docker/scripts/agentbox-vnc-start` — the script is `COPY`'d into the image at `/usr/local/bin/agentbox-vnc-start`. Edits to Xvnc flags, port choices, or the websockify invocation won't reach existing boxes until the image is rebuilt.
- Changes to `packages/sandbox-docker/scripts/agentbox-dockerd-start` — same reasoning as the VNC script (`COPY`'d to `/usr/local/bin/agentbox-dockerd-start`). The script now also owns storage-driver selection (probe overlay2 → fuse-overlayfs fallback) and rewrites `/etc/docker/daemon.json` at runtime, so the `storage-driver` is **not** baked — only `iptables: true` is. Likewise, edits to the baked `daemon.json` printf or the `docker.io`/`iptables` apt set need a rebuild.
- Changes to `packages/sandbox-docker/scripts/agentbox-checkpoint-cleanup` — `COPY`'d into the image at `/usr/local/bin/agentbox-checkpoint-cleanup` and `docker exec`'d by `runCleanup` right before `docker commit`. Edits to what the pre-commit cleanup deletes/keeps won't reach existing boxes until the image is rebuilt.
- Changes to `packages/sandbox-docker/scripts/agentbox-open` — `COPY`'d to `/usr/local/bin/agentbox-open`, symlinked over `/usr/local/bin/xdg-open`, and set as `ENV BROWSER` in `Dockerfile.box`. The host-routed link opener; edits (and the `xdg-open` symlink / `BROWSER` env) won't reach existing boxes until the image is rebuilt.
- Changes to `packages/sandbox-docker/scripts/claude-managed-settings.json` / `agentbox-codex-hooks.json` — `COPY`'d into the image (`/etc/claude-code/managed-settings.json`, `/usr/local/share/agentbox/codex-hooks.json`); both are also listed in `apps/cli/scripts/stage-runtime.mjs`'s `contextFiles` (a new image-`COPY`'d asset MUST be added there or the staged build context won't have it and the build fails). Edits to the activity-reporting hooks need a rebuild.
- Changes to `apps/cli/share/agentbox-setup/SKILL.md` — `COPY`'d into the image at `/usr/local/share/agentbox/setup-guide.md` and re-seeded into the claude-config volume by `seedSetupSkillIntoVolume` on every `create`/`claude` (image-versioned: the seed overwrites a stale copy in a long-lived shared volume). Edits to the setup wizard text need a rebuild to take effect.
- Edits to the baked-in `/etc/claude-code/CLAUDE.md` hint (content in `packages/sandbox-docker/scripts/custom-system-CLAUDE.md`, `COPY`'d into the image — edit the file, not the Dockerfile), the `/etc/profile.d/agentbox.sh` shim, or the `/etc/agentbox/` perms (the latter two are `RUN printf` blocks in `Dockerfile.box`). The runtime `box.env` is written per-create via `docker exec`, so its contents change without a rebuild; the shim that sources it does not.

```sh
docker rmi agentbox/box:dev
```

Wipe everything if state drifts (see README → Development for the raw escape hatch); the preferred path is `agentbox prune --all -y`.

## Host environment assumed

macOS (arm64 tested), Docker via OrbStack or Docker Desktop. Container needs `--cap-add=SYS_ADMIN --device=/dev/fuse --security-opt=apparmor:unconfined` — `runBox` in `packages/sandbox-docker/src/docker.ts` is the single source of truth for those flags.
