---
"@madarco/agentbox": minor
---

Keybinding cleanup and `agentbox browser` → `agentbox url` rename.

- `agentbox browser` is renamed to `agentbox url` (it opens the box's web app
  URL). No alias is kept.
- The `Ctrl+a` leader chords are now mnemonic and consistent across the
  agent/shell footers (`agentbox claude`/`codex`/`opencode`/`shell`) and the
  dashboard: `s` opens the noVNC screen, `u` opens the web app URL.
- In the agent/shell footers, detach moved from `Ctrl+a q` to `Ctrl+a d`.
  The dashboard keeps `Ctrl+a q` for quit; its "stop the box" chord moved
  from `Ctrl+a s` to `Ctrl+a t` (since `s` is now screen).
