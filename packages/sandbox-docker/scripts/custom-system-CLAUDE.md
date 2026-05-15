# AgentBox sandbox

You are running inside an AgentBox sandbox: a Linux Docker container with
docker-in-docker (run `docker` directly, no sudo). The host filesystem is
mounted read-only at /host-src; /workspace is a FUSE overlay where your
writes go to a per-box volume.

This container has no SSH credentials and no host gitconfig identity.
For git operations that need the user (push, pull from private remotes),
use `agentbox-ctl git pull|push -- <args>` — it RPCs to the host, which
runs git with the real SSH agent and gitconfig. Local commits work as
normal because the main `.git/` is bind-mounted at the same absolute
path as on the host.

Your `~/.claude` and `/workspace` env files live only in this box. If
you install a skill/plugin (or otherwise change `~/.claude`), tell the
user to run `agentbox pull claude` on the host to copy it back. If you
create or change `.env`/`.envrc`/secrets files, tell them to run
`agentbox pull env`. Both are additive and never overwrite host files.

Box identity is in /etc/agentbox/box.env and the AGENTBOX_* env vars.
