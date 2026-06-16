# Control box — build-out status

Status of the **control-box** feature: an always-on cloud box that runs the host
relay and holds a GitHub fine-grained PAT, so boxes keep pushing / opening PRs /
(later) being created when the user's laptop is off. Maintained live during
implementation (per project convention), not as end-of-PR cleanup.

Plan: `~/.claude/plans/to-allow-using-agentbox-rustling-comet.md`.

## The idea

Today the host relay (`agentbox-relay serve`) runs on the laptop and performs
every privileged action a box can't (git push, PR, box creation, cp, checkpoint)
with host-native credentials. Laptop off ⇒ all of that stops for cloud boxes.

A **control box** is just a `host`-mode relay running on an always-on cloud box,
reached by other cloud boxes the same way docker boxes already reach the laptop
relay — via the in-box `box-relay-forwarder`, but pointed at the control box's
**public HTTPS URL** instead of `host.docker.internal`. The control box has no
local checkout and no SSH/gh login, so it pushes with a **fine-grained PAT**
using the existing cloud git-bundle pull-back (materialize a throwaway repo from
the box's bundle → push to origin over HTTPS).

## Decisions (locked with the user)

- **Host:** provider-agnostic; persistent Vercel/E2B boxes are the natural fit
  (persistent snapshot + free public HTTPS preview URL). **Open risk:** does an
  inbound HTTPS request wake a *slept* persistent VM? → Phase 0 PoC.
- **GitHub auth:** fine-grained PAT, set/refreshed manually via
  `agentbox control-box set-token` (no refresh-token flow for fine-grained PATs).
  Stored on the control box (root-only env file), mirrored to
  `~/.agentbox/secrets.env`.
- **Phase 1 scope:** (1) git push + PRs, (2) creating new boxes — both laptop-off.
  Teleport-through-control-box and box→box fork are deferred.

## Comms model

```
cloud box  --(forwarder, https)-->  control-box relay (mode:'host', --control-box)
   |  /rpc git.push (per-box bearer)        |  executeCloudAction (PAT push)
   |  /events                               |  /admin/*, /remote/*  (admin bearer)
laptop CLI --(register-box, admin bearer)--> same relay
```

- `/admin/*` and `/remote/*` are gated on a constant-time **admin-bearer** match
  (not loopback) in control-box mode — the provider HTTPS proxy can present as
  loopback, so loopback is NOT trusted. Fails closed without a token.
- Per-box `/events` + `/rpc` keep their per-box bearers (already 0.0.0.0-safe).
- TLS terminates at the provider's public HTTPS proxy; the relay stays HTTP.

## Phase status

- [x] **W1 — control-box relay mode.** `RelayServerOptions.controlBox` +
  `adminToken`; `/admin/*` & `/remote/*` admin-bearer guard (constant-time,
  fail-closed); `agentbox-relay serve --control-box` reads
  `AGENTBOX_RELAY_ADMIN_TOKEN`. Laptop relay unchanged (loopback-only, `/remote`
  hidden). Unit tests: `packages/relay/test/control-box-admin.test.ts`.
  (W2 box-wiring details moved below, after the pull decision.)
- [x] **W3 — PAT git push/PR.** `git-pat.ts` (`toAuthedHttpsUrl`,
  `repoSlugFromRemote`, `pushBundleToRemote`); `runGitRpc`/`runGhPrRpc`
  control-box variants; `assertGhReady` honors `GH_TOKEN`; server `/rpc` routes
  cloud-kind boxes through `executeCloudAction`. Unit tests:
  `packages/relay/test/git-pat.test.ts` (incl. a real local bundle→bare-repo push).
- [x] **W4 — `agentbox control-box` command + Hetzner provisioning.** Live-validated
  2026-06-16 on a real `cx23` VPS: Caddy + Let's Encrypt TLS for `<ip>.sslip.io`,
  relay in `--control-box` mode reachable over public HTTPS, admin endpoints
  401-without / 200-with the bearer. `create`/`set-token`/`status`/`destroy` in
  `apps/cli/src/commands/control-box.ts`; provisioning in
  `packages/sandbox-hetzner/src/control-box.ts`. Secrets (admin token + PAT) in
  `/etc/agentbox/relay.env` 0600; **no provider tokens** on the box.
  `relay.controlBoxUrl` persisted to global config; admin token in
  `~/.agentbox/control-box.json` (0600).

  **DECIDED 2026-06-16 — pull, and the control box is a full agentbox node.**
  Rationale: W5 (create boxes from the control box) needs provider API tokens + the
  backend SDKs on the box *anyway*, so "keep the VPS minimal" doesn't apply — the
  control box holds provider tokens regardless. Therefore git push reuses the
  existing pull-based `runGitRpc` (control box `backend.exec`/`downloadFile`s the
  box's bundle), no protocol change. Consequence: the minimal relay-bin-only VPS
  from W4 must become a **full agentbox install** (relay bin + `@agentbox/sandbox-*`
  resolvable + provider tokens + its own `~/.agentbox/state.json`). Hetzner per-box
  SSH keys: boxes *created by* the control box mint their keys on the box (fine);
  laptop-created Hetzner boxes pushing via the control box is a follow-up.

- [ ] **W4b — upgrade the control box to a full install.** Replace the
  scp-relay-bin step with installing the agentbox CLI (backends bundled) so the
  relay resolves `@agentbox/sandbox-*` and `agentbox create` works on the box. Ship
  provider tokens into `/etc/agentbox/relay.env` + `~/.agentbox/secrets.env` on the
  box. Approach TBD: `npm pack` the dev build + install the tarball (dev) →
  `npm i -g @madarco/agentbox` (once published). Verify the relay's `resolveCloudBackend`
  works on the box.
- [ ] **W2 — boxes/laptop reach the remote relay (pull wiring).**
  - [x] `box-relay-forwarder` https + `relay.controlBoxUrl` config key.
  - [ ] `ENDPOINT`/`ensureRelay` resolvable from `relay.controlBoxUrl`;
    `registerBoxWithRelay`/`adminPost` parameterized base URL + admin bearer;
    thread box origin URL into `BoxRegistration`; `daemon.ts` selects the forwarder.
  - [ ] Sync the box's `BoxRecord` to the control box's `state.json` so
    `lookupCloudBox` resolves the sandboxId there.
- [ ] **W5 — create boxes from the control box.** Provider tokens on the box (W4b);
  `seedCloudWorkspace` origin-clone mode (clone via PAT, strip after); bearer-
  gated `POST /remote/queue/enqueue` reusing `startQueueLoop` + `runCloudJob`.

> Validation gap: any live git-push test needs a GitHub fine-grained PAT (scoped to
> the test repo) set via `agentbox control-box set-token`. Not yet provided.

## Phase 0 PoC results

1. **Wake-on-inbound (make-or-break) — ❌ FALSE for Vercel (verified 2026-06-16).**
   Created a persistent Vercel box, `agentbox stop` it (→ state `paused`), then
   `curl` its public `*.vercel.run` URL 3×: every request returned **HTTP 502 in
   ~0.1s** and the box **stayed paused**. An inbound HTTPS request does NOT
   resume a stopped/paused Vercel box — only an SDK `Sandbox.get({resume:true})`
   /`backend.start` does. (Matches the documented persistent model.) E2B is
   expected to behave the same (SDK-only resume).

   **Implication:** a Vercel/E2B box can't be an always-on control box reached by
   inbound traffic on its own — it dies at the session cap (~45 min Hobby / 5 h
   Pro) and nothing wakes it from a box's outbound `/rpc`. It would need an
   **external always-on driver** (e.g. a scheduled GitHub Action / cron service)
   to periodically SDK-resume it. That's extra moving parts and still depends on
   something always-on.

   **Decision needed (was Vercel):** either (A) put the control box on **Hetzner**
   — a real VPS that never sleeps + public IP, no waker needed (only adds a TLS
   terminator, e.g. Caddy); or (B) keep Vercel/E2B and add the external keep-alive
   driver. Leaning **(A) Hetzner** now that the wake assumption is disproven.
2. **PAT push from a no-checkout host — ✅ validated (unit).**
   `pushBundleToRemote` + `toAuthedHttpsUrl` push a real bundle to a local bare
   repo in `git-pat.test.ts`. Live GitHub round-trip still TODO once a control box
   exists.
3. **Control-box relay over public HTTPS — ✅ partially validated.** The built
   relay bin runs in `--control-box` mode and enforces admin-bearer auth over a
   live listener (healthz 200, admin 401/401/200, `/remote` gated). Full
   box→control-box→GitHub round trip needs W2 wiring + a real control box.

## Security notes

- Admin/remote endpoints: constant-time bearer, fail-closed, never loopback-open
  when `--control-box`.
- PAT blast radius is broader than per-box SSH (any repo in scope, any served
  box). Keep it fine-grained + short-lived; keep the `askPrompt` /
  host-initiated-token gates for non-`agentbox/` branches; unattended pushes to
  arbitrary branches need an explicit opt-in (`AGENTBOX_GIT_PUSH_NO_SUB=allow`
  or per-box `autoApproveHostActions`).
- PAT + provider tokens live in a root-only on-box env file, never baked into a
  snapshot. The push token lives in a throwaway temp remote URL, not in argv.
