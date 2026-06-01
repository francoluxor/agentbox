---
title: agentbox.yaml
description: Reference for the in-box services and tasks configuration file.
---

> **Draft** — this page is a stub; prose is coming soon.

## Top-level keys

_`services`, `tasks`, `ide`, `defaults`._

## Services

_`command`, `cwd`, `env`, `autostart`, `restart`, `backoff`._

## Tasks

_One-shot units and their fields._

## ready_when

_The `port`, `log_match`, and `http` readiness probes._

## expose

_Marking the web service to forward its port._

## needs & restart

_DAG dependencies and restart policies._

## defaults

_Project-level box-creation defaults (same shape as user config)._

## carry

_Host-to-box file copy declared at the top level (host-applied)._
