// Box view model — normalized shape the UI renders. Phase 2's
// lib/boxes/source.ts will produce this same shape from the relay store.
import type { AgentId } from '@/components/icons';

export type BoxStatus = 'running' | 'paused' | 'stopped' | 'creating' | 'error';

export interface Box {
  id: string;
  projectId: string;
  repo: string;
  branch: string;
  task: string;
  agent: AgentId | string;
  status: BoxStatus;
  createdAt: number;
  lastActivity: number;
  host: string;
  commits: number;
  filesTouched: number;
  error?: string | null;
}

export interface Project {
  id: string;
  name: string;
  repo: string;
  defaultBranch: string;
  provider: string;
  createdAt: number;
}

export interface Repo {
  id: string;
  full: string;
  private: boolean;
  lang: string;
  pushedAt: number;
}

export interface GithubState {
  installed: boolean;
  appName: string;
  account: string;
  installedAt: number;
  repos: Repo[];
}

export interface User {
  login: string;
  name: string;
}

export interface HubState {
  user: User;
  github: GithubState;
  projects: Project[];
  boxes: Box[];
}

export const statusMeta: Record<BoxStatus, { label: string; badgeClass: string }> = {
  running: { label: 'running', badgeClass: 'badge-run' },
  paused: { label: 'paused', badgeClass: 'badge-pause' },
  stopped: { label: 'stopped', badgeClass: 'badge-stop' },
  creating: { label: 'creating', badgeClass: 'badge-create' },
  error: { label: 'error', badgeClass: 'badge-err' },
};
