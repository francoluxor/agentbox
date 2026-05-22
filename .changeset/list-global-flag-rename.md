---
"@madarco/agentbox": minor
---

`agentbox list --all` / `-a` renamed to `--global` / `-g`.

The flag that widens `agentbox list` from the current project to all projects
now follows the convention used by other CLIs (npm/pnpm `-g, --global`). The
old `--all` / `-a` form is removed with no alias — update any scripts that
used it.
