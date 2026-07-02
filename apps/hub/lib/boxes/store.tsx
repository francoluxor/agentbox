'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createInitialState } from './mock-data';
import type { Box, BoxStatus, HubState, Project, Repo } from './types';

export type Modal = { type: 'box'; project: Project } | { type: 'project' } | null;

interface HubContextValue {
  state: HubState;
  project: (id: string) => Project | undefined;
  box: (id: string) => Box | undefined;
  boxesFor: (pid: string) => Box[];
  repo: (full: string) => Repo | undefined;
  pauseBox: (id: string) => void;
  resumeBox: (id: string) => void;
  stopBox: (id: string) => void;
  destroyBox: (id: string) => void;
  createBox: (input: { projectId: string; branch: string; task: string; agent: string }) => string;
  createProject: (input: { repo: string; name?: string; provider?: string }) => string;
  modal: Modal;
  openCreateBox: (project: Project) => void;
  openCreateProject: () => void;
  closeModal: () => void;
}

const HubContext = createContext<HubContextValue | null>(null);

export function HubProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HubState>(createInitialState);
  const [modal, setModal] = useState<Modal>(null);
  const [mounted, setMounted] = useState(false);
  const idRef = useRef(100);

  useEffect(() => setMounted(true), []);

  const setStatus = useCallback((id: string, status: BoxStatus) => {
    setState((s) => ({
      ...s,
      boxes: s.boxes.map((b) =>
        b.id === id ? { ...b, status, lastActivity: Date.now(), error: status === 'running' ? null : b.error } : b,
      ),
    }));
  }, []);

  const value = useMemo<HubContextValue>(() => {
    const project = (id: string) => state.projects.find((p) => p.id === id);

    return {
      state,
      project,
      box: (id) => state.boxes.find((b) => b.id === id),
      boxesFor: (pid) => state.boxes.filter((b) => b.projectId === pid),
      repo: (full) => state.github.repos.find((r) => r.full === full),
      pauseBox: (id) => setStatus(id, 'paused'),
      resumeBox: (id) => setStatus(id, 'running'),
      stopBox: (id) => setStatus(id, 'stopped'),
      destroyBox: (id) => setState((s) => ({ ...s, boxes: s.boxes.filter((b) => b.id !== id) })),
      createBox: ({ projectId, branch, task, agent }) => {
        const p = project(projectId);
        const id = 'bx_' + ++idRef.current;
        const box: Box = {
          id,
          projectId,
          repo: p?.repo ?? '',
          branch: branch || p?.defaultBranch || 'main',
          task: task || 'Idle — awaiting instructions',
          agent: agent || 'claude',
          status: 'creating',
          createdAt: Date.now(),
          lastActivity: Date.now(),
          host: (p?.provider ?? 'local').toLowerCase(),
          commits: 0,
          filesTouched: 0,
        };
        setState((s) => ({ ...s, boxes: [box, ...s.boxes] }));
        // simulate provisioning → running
        setTimeout(() => {
          setState((s) => ({
            ...s,
            boxes: s.boxes.map((b) =>
              b.id === id && b.status === 'creating' ? { ...b, status: 'running', lastActivity: Date.now() } : b,
            ),
          }));
        }, 2200);
        return id;
      },
      createProject: ({ repo, name, provider }) => {
        const id = 'p' + (state.projects.length + 1) + '_' + Date.now().toString(36);
        const proj: Project = {
          id,
          name: name || repo.split('/')[1] || repo,
          repo,
          defaultBranch: 'main',
          provider: provider || 'Local Docker',
          createdAt: Date.now(),
        };
        setState((s) => ({ ...s, projects: [...s.projects, proj] }));
        return id;
      },
      modal,
      openCreateBox: (project) => setModal({ type: 'box', project }),
      openCreateProject: () => setModal({ type: 'project' }),
      closeModal: () => setModal(null),
    };
  }, [state, modal, setStatus]);

  // Gate on mount: the mock timestamps are Date.now()-relative, so rendering
  // them during SSR/hydration would mismatch. Phase 2's server data removes this.
  if (!mounted) return null;

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}

export function useStore(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useStore must be used within HubProvider');
  return ctx;
}
