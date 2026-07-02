import type { HubState } from './types';

// Mock initial state ported from the prototype's data.jsx. Timestamps are
// relative to now so fmtAgo reads naturally. Built lazily (in the store's
// useState initializer) so Date.now() runs client-side only.
export function createInitialState(): HubState {
  const now = Date.now();
  const min = 60 * 1000;
  const hr = 60 * min;

  return {
    user: { login: 'madarco', name: 'Marco D.' },
    github: {
      installed: true,
      appName: 'agentbox-control',
      account: 'madarco',
      installedAt: now - 26 * 24 * hr,
      repos: [
        { id: 'r1', full: 'madarco/my-app', private: true, lang: 'TypeScript', pushedAt: now - 2 * hr },
        { id: 'r2', full: 'madarco/agentbox', private: false, lang: 'TypeScript', pushedAt: now - 5 * hr },
        { id: 'r3', full: 'madarco/landing-site', private: true, lang: 'Astro', pushedAt: now - 1 * 24 * hr },
        { id: 'r4', full: 'madarco/internal-tools', private: true, lang: 'Go', pushedAt: now - 3 * 24 * hr },
        { id: 'r5', full: 'madarco/docs-site', private: false, lang: 'MDX', pushedAt: now - 8 * 24 * hr },
      ],
    },
    projects: [
      { id: 'p1', name: 'my-app', repo: 'madarco/my-app', defaultBranch: 'main', provider: 'Hetzner', createdAt: now - 20 * 24 * hr },
      { id: 'p2', name: 'agentbox', repo: 'madarco/agentbox', defaultBranch: 'main', provider: 'Local Docker', createdAt: now - 12 * 24 * hr },
      { id: 'p3', name: 'landing-site', repo: 'madarco/landing-site', defaultBranch: 'main', provider: 'Daytona', createdAt: now - 4 * 24 * hr },
      { id: 'p4', name: 'docs-site', repo: 'madarco/docs-site', defaultBranch: 'main', provider: 'Local Docker', createdAt: now - 2 * hr },
    ],
    boxes: [
      {
        id: 'bx_1', projectId: 'p1', repo: 'madarco/my-app', branch: 'feat/checkout',
        task: 'Implement Stripe checkout flow', agent: 'claude', status: 'running',
        createdAt: now - 42 * min, lastActivity: now - 30 * 1000, host: 'hetzner · cax21',
        commits: 3, filesTouched: 11,
      },
      {
        id: 'bx_2', projectId: 'p1', repo: 'madarco/my-app', branch: 'fix/oauth-loop',
        task: 'Fix OAuth redirect loop on Safari', agent: 'claude', status: 'paused',
        createdAt: now - 3 * hr, lastActivity: now - 52 * min, host: 'hetzner · cax21',
        commits: 1, filesTouched: 4,
      },
      {
        id: 'bx_3', projectId: 'p2', repo: 'madarco/agentbox', branch: 'docs/control-plane',
        task: 'Write control-plane quickstart docs', agent: 'codex', status: 'running',
        createdAt: now - 18 * min, lastActivity: now - 8 * 1000, host: 'local · docker',
        commits: 2, filesTouched: 6,
      },
      {
        id: 'bx_4', projectId: 'p2', repo: 'madarco/agentbox', branch: 'refactor/cli-parser',
        task: 'Refactor CLI argument parser', agent: 'claude', status: 'stopped',
        createdAt: now - 2 * 24 * hr, lastActivity: now - 1 * 24 * hr, host: 'local · docker',
        commits: 7, filesTouched: 23,
      },
      {
        id: 'bx_5', projectId: 'p3', repo: 'madarco/landing-site', branch: 'redesign/hero',
        task: 'Rebuild hero section with new art direction', agent: 'claude', status: 'error',
        createdAt: now - 6 * hr, lastActivity: now - 4 * hr, host: 'daytona · sandbox',
        commits: 0, filesTouched: 2, error: 'Agent exited: npm install failed (ENOSPC)',
      },
    ],
  };
}
