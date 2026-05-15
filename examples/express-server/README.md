# express-server — wizard test fixture

A deliberately tiny Express server used to exercise the **first-run setup wizard** (`apps/cli/src/wizard.ts`). There is no `agentbox.yaml` checked in — that is the whole point: the wizard should fire on `agentbox create` / `agentbox claude` and ask the agent to generate one.

## What a correctly-generated `agentbox.yaml` looks like

The agent should detect:

- `package.json` with `dependencies.express` and `scripts.dev` → a `pnpm install` (or `npm install`) **task** is needed before the server runs.
- `server.js` reads `process.env.GREETING` and exits non-zero when it's missing → either declare a `service.env.GREETING` value in the yaml, or remind the user to `cp .env.example .env` before starting.
- The server listens on `process.env.PORT ?? 3000` → readiness probe should be `port: 3000` (or whatever PORT is set to).

A plausible result, written to `/workspace/agentbox.yaml`:

```yaml
# yaml-language-server: $schema=https://agentbox.dev/schema/agentbox.schema.json
tasks:
  install:
    command: npm install

services:
  dev:
    command: npm run dev
    needs: [install]
    env:
      GREETING: hello from agentbox
    ready_when:
      port: 3000
      timeout_ms: 60000
    restart: on-failure
```

## Manual smoke test

From the repo root, after `pnpm build`:

```sh
cd examples/express-server
docker rmi agentbox/box:dev   # force image rebuild so the new guide bakes in
node ../../apps/cli/dist/index.js claude -n express-wiz
```

Expected:
1. Wizard prompt: *"No `agentbox.yaml` found in …/express-server. Want me to launch Claude to generate one for you?"* — answer yes.
2. `~/.claude/skills/agentbox-setup/SKILL.md` is created the first time (`log.success` confirms it).
3. Claude opens with an initial directive to read `/usr/local/share/agentbox/setup-guide.md` and write `/workspace/agentbox.yaml`.
4. Verify in the box: `docker exec agentbox-express-wiz cat /workspace/agentbox.yaml`.

To exercise the `create` switch-to-claude path instead:

```sh
node ../../apps/cli/dist/index.js create -n express-wiz2
```

Answer yes to both prompts (generate / switch). The CLI re-dispatches to `claudeCommand` with the create flags forwarded, and the inner wizard pass slots in the initial prompt.

## Cleanup

```sh
node ../../apps/cli/dist/index.js destroy express-wiz express-wiz2 -y
```
