'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AGENTS, Icons, type AgentId } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogIcon, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/lib/boxes/store';
import type { Project } from '@/lib/boxes/types';

export function CreateBoxModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { createBox } = useStore();
  const router = useRouter();
  const [branch, setBranch] = useState(project.defaultBranch);
  const [task, setTask] = useState('');
  const [agent, setAgent] = useState<AgentId>('claude');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    const id = createBox({ projectId: project.id, branch, task, agent });
    setTimeout(() => {
      onClose();
      router.push('/boxes/' + id);
    }, 480);
  };

  return (
    <Dialog onClose={onClose}>
      <DialogHeader>
        <DialogIcon>
          <Icons.box />
        </DialogIcon>
        <div>
          <DialogTitle>Create box</DialogTitle>
          <DialogDescription>
            {project.name} · {project.repo}
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogBody>
        <div className="mb-4">
          <Label>Agent CLI</Label>
          <div className="grid grid-cols-2 gap-2 max-[460px]:grid-cols-1" role="radiogroup">
            {AGENTS.map((a) => {
              const on = agent === a.id;
              const AgentIcon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                    on ? 'border-primary bg-accent ring-[3px] ring-primary/10' : 'border-border bg-card hover:border-[#a4a9b0] hover:bg-[#fcfcfb]',
                  )}
                  onClick={() => setAgent(a.id)}
                >
                  <span
                    className={cn(
                      'grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border',
                      on ? 'border-[var(--green-line)] bg-card text-primary' : 'border-border bg-background text-secondary-foreground',
                    )}
                  >
                    <AgentIcon className="size-4" />
                  </span>
                  <span className={cn('text-[13.5px] font-medium', on ? 'text-[var(--green-ink)]' : 'text-secondary-foreground')}>
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mb-4">
          <Label htmlFor="cb-branch">Branch</Label>
          <Input id="cb-branch" className="font-mono text-[13px]" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="feat/my-task" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Branched from <span className="font-mono">{project.defaultBranch}</span>. A new branch is created if it doesn&apos;t exist.
          </p>
        </div>
        <div>
          <Label htmlFor="cb-task">
            Initial task <span className="font-normal text-[#a4a9b0]">(optional)</span>
          </Label>
          <Textarea id="cb-task" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Describe what the agent should do first…" />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? <span className="spin" /> : <Icons.plus />}
          {busy ? 'Provisioning…' : 'Create box'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
