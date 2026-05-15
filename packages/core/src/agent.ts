import type { AgentKind } from './types.js';

export interface AgentLauncher {
  readonly kind: AgentKind;
  buildArgs(initialMessage: string, userArgs: string[]): string[];
}

const claudeCodeLauncher: AgentLauncher = {
  kind: 'claude-code',
  // claude treats its first positional argument as the seed user turn in
  // interactive mode (`claude "<message>"`), so we slot the initial message
  // ahead of any user-passed flags.
  buildArgs(initialMessage, userArgs) {
    if (!initialMessage) return [...userArgs];
    return [initialMessage, ...userArgs];
  },
};

const codexLauncher: AgentLauncher = {
  kind: 'codex',
  buildArgs() {
    throw new Error(
      'codex agent is not yet supported by agentbox; install + wire the codex launcher first',
    );
  },
};

export function resolveAgentLauncher(kind: AgentKind): AgentLauncher {
  if (kind === 'claude-code') return claudeCodeLauncher;
  if (kind === 'codex') return codexLauncher;
  throw new Error(`unknown agent kind: ${String(kind)}`);
}
