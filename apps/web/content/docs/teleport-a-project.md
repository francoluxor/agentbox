---
title: Teleport a project
description: How agentbox create moves your files and git history into an isolated box.
---

> **Draft** — this page is a stub; prose is coming soon.

## Create a box

_`agentbox create` from your project directory, and what it provisions._

## How your files get in

_The in-container git worktree against your bind-mounted `.git` (and the cloud git-bundle path)._

## Carry-over

_Uncommitted work: stash + untracked files carried into the box._

## Environment files

_`--with-env` to copy gitignored env files into `/workspace`._

## Non-git projects

_Seeding a plain directory via tar when there's no repo._

## Choosing a branch

_Per-box branch `agentbox/<name>`, `--from-branch`, and `-b/--use-branch`._
