# Control-plane — architecture & roadmap

> Part of the AgentBox docs. Start at [CLAUDE.md](../CLAUDE.md). Status doc for the **hosted
> control-plane**: how it creates/hosts/manages boxes so they keep working with the laptop off.
> See also [`control-plane-backlog.md`](./control-plane-backlog.md) (what shipped), [`host-relay.md`](./host-relay.md),
> and [`in-box-supervisor.md`](./in-box-supervisor.md) (`agentbox-ctl bootstrap`).

Goal: a portable control-plane that creates, hosts, and manages boxes so they keep working with the
laptop off. Two deployment topologies share one codebase (`@agentbox/relay` core + Postgres):

- **Serverless (Vercel):** stateless functions + Neon Postgres.
- **Container (Hetzner VPS):** an always-on VM running the app + Postgres (+ optional worker).

Box bring-up is unified on `agentbox-ctl bootstrap` (idempotent, leased-token self-clone) — shipped.
Git auth (GitHub-App leasing) is done.

## Verified feasibility (checked against the code)

1. **Box creation is pure-Node for ALL providers — no host SSH, no ephemeral sandbox.**
   - vercel/e2b/daytona: provision is a pure SDK call (`CloudHandle` = `{sandboxId}` + env creds).
   - hetzner: ed25519 keygen → `crypto.generateKeyPairSync` (replaces the `ssh-keygen` binary);
     firewall + server create are REST; `sandboxId` + public IP come straight from the `createServer`
     response. The post-provision SSH seed/kick is replaced by **cloud-init `runcmd: agentbox-ctl
     bootstrap`** + `inBoxClone` self-clone; the box **pushes "ready"** to the plane. The plane never
     SSHes — the per-box SSH **private key is stored in the plane** for the laptop to download later.
   - Two dependencies this introduces: (i) the box **pulls agent creds from the plane** at bootstrap
     (cloud-init's ~16 KB limit can't carry cred tarballs); (ii) pure-Node **resume** needs the box to
     self-bootstrap on power-on — a baked **systemd oneshot / cloud-init re-run** (the "boot-hook"
     track) — else resume needs an SSH kick from the laptop/worker.
2. **Base bake runs on the provider's own infra; only the serverless timeout matters.**
   daytona/e2b build **server-side** (kick + poll the SDK). vercel/hetzner run the install script on a
   **temp builder box under tmux** + poll, then a quick `snapshot`/`createImage` REST/SDK call. No
   long-lived local process. → **fire-and-poll bake jobs**, pure-Node.

**Consequence:** the previously-assumed "ephemeral Vercel Sandbox executor" is **dropped** — unneeded
for create or bake. The **container worker becomes optional**, and **vercel→hetzner is feasible**
(once the boot-hook lands for resume).

## Core model (shared)

- **The plane is the brain + custodian.** Postgres holds: box registry (+`sandboxId`, public IP),
  per-box **secrets** (SSH keys, relay tokens), **agent credentials**, the GitHub-App key,
  events/status, and the create/bake job queues. Stateless per request.
- **Boxes are self-contained.** Provisioned from a baked snapshot; `agentbox-ctl bootstrap` (run by
  cloud-init / entrypoint) self-clones via a leased token, **pulls agent creds from the plane**, and
  launches ctl/dockerd/VNC. The box **pushes** events to the plane and **leases** GitHub-App tokens to
  push to GitHub directly.
- **Executor = where host-exec-ish work runs** (simplified to two, both pure-Node-friendly):
  - **Inline (pure-Node) in the plane** — provision (all providers, incl. hetzner via crypto+REST+
    cloud-init), lifecycle (pause/resume/destroy = SDK/REST), and bake orchestration (kick + poll).
    Works in a serverless function and on the VPS.
  - **Resident worker (optional, container topology)** — `agentbox control-plane worker` on the VPS,
    kept alive by **systemd**, for ops one prefers to run from a persistent host (e.g. SSH-kick a
    resume before the boot-hook exists, or long bakes without tmux gymnastics). Not required for create.
- **Federation (laptop ↔ plane).** The laptop reads the hosted registry/status via RemoteStore
  (`/admin/store`, built) and **syncs secrets down** to manage/attach/tunnel locally. Local actions
  (agent login) **forward up**.

## The nine concerns × both topologies

1. **Local↔hosted forward.** Down: laptop reads hosted boxes via federation. Up: forward agent-login
   creds to the plane secret store (post-login hook) + repo onboarding (`ensureProjectRepoOnControlPlane`).
2. **Git auth — DONE.** GitHub-App lease (1h, repo-scoped) for clone (`inBoxClone`), pull, push.
3. **Box creation — pure-Node, all providers** (see Verified §1). Serverless plane creates inline;
   the VPS plane can too (worker optional). Boxes self-clone + self-bootstrap + push ready.
4. **Base bake — provider-infra + fire-and-poll** (see Verified §2). A `bake_jobs` queue: kick →
   persist job → poll (SDK status for daytona/e2b; temp-box tmux + `createImage`/`snapshot` for
   hetzner/vercel) → record the prepared id.
5. **HTTPS/DNS — DONE.** Vercel managed; Hetzner `<ip>.sslip.io` + Caddy + Let's Encrypt. Plane-created
   hetzner boxes serve their own web via the box's public IP (sslip.io+Caddy), no host tunnel needed.
6. **Agent credentials.** Box **pulls** creds from the plane at bootstrap (per-box token → plane
   endpoint) — unified across topologies, dodges cloud-init size + scp. Sourced by relay-upload
   (`control-plane creds push`) or in-box login (VPS). Verify a real `claude -p` turn ("usable").
7. **Secret/SSH-key download.** `agentbox control-plane pull <box>`: admin-gated
   `GET /remote/boxes/:id/secrets` → SSH key into `~/.agentbox/hetzner/boxes/<id>/ssh/` + local record.
8. **Local portless/tunnel.** Laptop reuses the existing Portless path for plane-created boxes
   (`https://<box>.localhost`); hetzner attach runs `agentbox hetzner firewall sync` to admit the
   laptop IP (the box opens no inbound SSH at create).
9. **Web UI portal.** Dashboard → create/start/stop/destroy from the browser; box detail/status;
   later in-box agent control (prompts, agent activity state, action approvals).

## Roadmap (milestones)

- **M0 — Bring-up (DONE):** `agentbox-ctl bootstrap` + `inBoxClone` + provider allow-list gate.
- **M1 — Plane registry + custodian:** box records (+`sandboxId`/IP), encrypted secrets store,
  agent-cred store + `creds push`, `GET /remote/boxes`/`:id`/`:id/secrets`, federation read.
- **M2 — Boot-hook + cred-pull (the pure-Node enabler):** cloud-init/systemd-oneshot runs
  `agentbox-ctl bootstrap` on boot (create + resume); bootstrap **pulls agent creds from the plane**;
  hetzner keygen → `crypto`. Unblocks pure-Node create *and* resume.
- **M3 — Serverless create (all providers, pure-Node):** plane provisions + records + pre-registers;
  box self-clones/bootstraps/pushes. Delivers vercel→vercel/e2b and **vercel→hetzner**.
- **M4 — Laptop sync + manage:** `control-plane pull` → reuse local lifecycle/attach; firewall-sync;
  local portless tunnel for plane boxes.
- **M5 — Bake jobs:** `bake_jobs` queue, fire-and-poll per provider (server-side / temp-box+tmux),
  so the plane can prepare base snapshots without the laptop.
- **M6 — Web UI portal.**
- **Optional — Container worker:** systemd-kept-alive worker on the VPS for host-side ops; reposition
  as a convenience, not a requirement.

## Reuse
`agentbox-ctl bootstrap` + `CreateBoxRequest.inBoxClone`; `GitHubAppLeaser`/`toAuthedHttpsUrl`;
`create_jobs` queue + `drainCreateJobs`; `vercelBackend`/`e2bBackend`/`hetzner backend` REST + SDK;
local `pause`/`resume`/`destroy`/`attach` + `providerForBox`; RemoteStore (`/admin/store`); Portless;
`agentbox hetzner firewall sync`; Caddy+sslip.io deploy; `crypto.generateKeyPairSync('ed25519')`.

## Assumptions / risks
- **Single-user, shared cloud creds** (plane + laptop use your accounts) so the laptop can
  manage/attach plane-created boxes. Multi-tenant is a later evolution.
- **Serverless `backend.ts` import** must stay free of `sandbox-cloud`/docker/host deps (use a package
  `./backend` subpath; verify the graph, else extract a thin `@agentbox/cloud-backends`).
- **Boot-hook reliability per provider** (M2): Hetzner = cloud-init/systemd (real VM, fine);
  microVMs/containers may need an entrypoint shim — verify PID 1 empirically before relying on systemd.
- **Encrypted secrets at rest**, admin-gated `/secrets`, never log keys/tokens.
