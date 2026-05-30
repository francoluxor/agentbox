---
description: Generate a short, curated CHANGELOG.md entry from the commits since the last release
argument-hint: "[patch|minor|major]"
allowed-tools: Bash(git describe:*), Bash(git log:*), Bash(git tag:*), Bash(git rev-list:*), Bash(node:*), Read, Edit
---

You are writing the next release-notes entry for `@madarco/agentbox`. The
changelog is at `apps/cli/CHANGELOG.md` (Keep a Changelog format). Produce
**short, user-facing notes — not a commit dump.**

## 1. Find the range

- Last release anchor: `git describe --tags --abbrev=0` (e.g. `v0.9.0`). If that
  fails (no tags), fall back to the last `New release` commit:
  `git log --grep='^New release$' -1 --pretty=%H`.
- The range is `<anchor>..HEAD`.

## 2. Gather material (not just subjects)

- `git log <anchor>..HEAD --no-merges --pretty=format:'===%h %s%n%b'` — read the
  **bodies**, they carry the real "why".
- `git log <anchor>..HEAD --stat --oneline` — gauge surface area.
- If a commit message is thin but the diff looks user-visible, inspect it with
  `git log -1 -p <hash> -- <path>`.

## 3. Curate — this is the point

- **Drop noise:** merge commits, CI / typecheck / lint / bugbot fixes, version
  bumps, and internal refactors or doc/copy tweaks with no user-visible effect.
- **Merge related commits** into a single bullet (e.g. several `feat(vercel)` /
  `fix(cloud)` commits → one "Vercel provider" line). Aim for a handful of
  bullets per heading, not one per commit.
- **Group** under these headings, in this order, omitting any that are empty:
  `### Breaking`, `### Added`, `### Changed`, `### Fixed`, `### Removed`.
- **Rewrite for a CLI user:** what changed for someone running `agentbox`, terse,
  past tense, no commit hashes. Mention the flag / config key / command name when
  relevant. Call out anything that breaks existing scripts under Breaking.

## 4. Pick the version

- Decide the bump from the commits: any breaking change → minor while pre-1.0
  (note it under Breaking), any `feat` → minor, else patch. Compute the next
  version from the current `apps/cli/package.json` `version`.
- If `$ARGUMENTS` names a bump (`patch` / `minor` / `major`), use that instead.

## 5. Write it

- Read `apps/cli/CHANGELOG.md`, then **prepend** a new section directly under the
  intro, above the most recent existing version:

  ```
  ## [<next-version>] - <today's date, YYYY-MM-DD>

  ### Added
  - ...
  ```

  Use today's real date — get it from the environment context, do not invent one.
- Do **not** bump `package.json` or create a git tag — that happens at publish
  time (`pnpm --filter @madarco/agentbox run publish:<bump>`).
- Print the entry you wrote and stop, so the user can review and edit before
  releasing.
