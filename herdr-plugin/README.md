# AgentBox plugin for Herdr

A [Herdr](https://herdr.dev) plugin for [AgentBox](https://agent-box.sh) — run
coding agents (Claude Code, Codex, OpenCode) in isolated sandboxes and drive them
from Herdr.

## Install

```sh
herdr plugin install madarco/agentbox/herdr-plugin
```

The install runs `build.sh`, which finishes setup if the AgentBox CLI is present
(it installs the keyboard shortcuts and a small command shim). If the CLI isn't
installed yet, the plugin still installs and tells you how to get it:

```sh
npm i -g @madarco/agentbox && agentbox install herdr
```

> Already have the AgentBox CLI? `agentbox install herdr` installs this same
> plugin directly — no `herdr plugin install` needed.

## What it adds

- **Boxes overlay** — `prefix a` (Herdr prefix, default `Ctrl+b`, then `a`): a
  live list of all your boxes, grouped by project.
- **New box** — `prefix shift a`: create a box for the current project and attach
  its agent in a new tab.
- **Ctrl+click** a box name in the overlay to open its web app in the browser.

Attached boxes also show up in Herdr's native sidebar agent panel — set
`agent_panel_scope = "all"` to keep them visible across workspaces.

## How it works

AgentBox already reports each attached box to Herdr as a normal agent over the
socket API. This plugin adds the overlay, shortcuts, and link handler on top.
Plugin commands route through `agentbox-shim.sh` (generated at install time with
the absolute CLI path), so it works regardless of the Herdr server's `PATH`
(including under nvm). Keyboard shortcuts are written to your
`~/.config/herdr/config.toml` (Herdr doesn't take keybindings from plugin
manifests); remove them with `herdr config reset-keys`.

## Uninstall

```sh
herdr plugin uninstall agentbox
herdr config reset-keys   # drop the shortcuts
```

This plugin's manifest is generated from the AgentBox CLI
(`apps/cli/src/commands/install-herdr.ts`) and kept in sync by a test — edit it
there, not here.
