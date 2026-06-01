---
title: Core concepts
description: Boxes, the workspace, providers, checkpoints, and the host relay — the ideas behind AgentBox.
---

> **Draft** — this page is a stub; prose is coming soon.

## Boxes

_What a box is: one isolated VM per agent run, and how it maps across providers._

## The workspace

_The two-way git worktree at `/workspace`, mounted against your host `.git`._

## Providers

_Local Docker plus the Hetzner, Daytona, and Vercel cloud backends behind one interface._

## Checkpoints & pausing

_Warm starts: pause/resume and checkpoint snapshots for sub-second boot._

## The host relay

_Why credentials stay on the host and how boxes call back for git and file ops._

## Agents & sessions

_Claude Code, Codex, and OpenCode in detachable tmux sessions._
