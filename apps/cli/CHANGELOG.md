# Changelog

All notable changes to `@madarco/agentbox` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are generated from the commit history with `/release-notes` and then
hand-reviewed — they describe what changed for someone using the `agentbox`
CLI, not the raw commits.

## [0.10.0] - 2026-05-30

### Breaking

- `agentbox browser` is renamed to `agentbox url` (it opens the box's web-app
  URL). No alias is kept.
- `agentbox list --all` / `-a` is renamed to `--global` / `-g`, matching the
  npm/pnpm convention. The old form is removed with no alias — update any
  scripts that used it.

### Added

- `agentbox install` is now an interactive setup wizard (system compatibility
  check, provider picker, login/prepare hints, host `/agentbox` skill install)
  and a new `agentbox doctor` reports the same checks in full detail. The wizard
  auto-runs once on first use; `--skills-only` keeps the old host-skill-only
  behavior.
- Portless integration on Docker Desktop: boxes can get a stable
  `https://<box-name>.localhost` URL for their web app via the
  [Portless](https://portless.sh) proxy. Opt-in on first run (saved to the new
  `portless.enabled` config key; `--portless` / `--no-portless` flags). The same
  URL works from the host and from inside the box's VNC browser.
- Cloud boxes now offer to sign you in before the box starts when agent
  credentials are missing or expired, seeding the login into this box and every
  future one (Claude, Codex, OpenCode).
- A 3-line alert band above the footer surfaces relay confirm prompts,
  checkpoint notices, and the agent's questions without hiding the status bar —
  in both the single-attach TUI and the dashboard.
- Agents skip their interactive permission prompts by default inside boxes
  (boxes are already isolated). Controlled by `claude.dangerouslySkipPermissions`
  / `codex.dangerouslySkipPermissions` (both default on); override per-box with
  `--no-dangerously-skip-permissions`.

### Changed

- `Ctrl+a` leader chords are now mnemonic and consistent across the agent/shell
  footers and the dashboard: `s` opens the noVNC screen, `u` opens the web-app
  URL, `d` detaches. The dashboard keeps `Ctrl+a q` to quit and moves "stop the
  box" to `Ctrl+a t`.
- Faster dashboard switching on the Vercel provider; install-wizard copy and
  progress animation polished.

### Fixed

- The cloud login offer runs in the default docker image instead of a cloud
  snapshot ref, fixing a `docker build` failure on `snap_…` image names.
- Skip-permissions conflict detection now also matches inline `--flag=value`
  syntax, so an explicit user choice always wins; background-queue jobs honor
  `--no-dangerously-skip-permissions`.
- The footer spinner keeps animating when the alert band collapses on a tiny
  terminal.

## [0.9.0] - 2026-05-29

First release with a tracked changelog. Earlier history lives in the git log.
