'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icons, LangDot } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogIcon, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { fmtAgo } from '@/lib/boxes/format';
import { useStore } from '@/lib/boxes/store';

export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { state, createProject } = useStore();
  const router = useRouter();
  const gh = state.github;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [provider, setProvider] = useState('Local Docker');
  const [busy, setBusy] = useState(false);

  const repos = gh.repos.filter((r) => r.full.toLowerCase().includes(q.toLowerCase()));
  const existing = new Set(state.projects.map((p) => p.repo));

  const submit = () => {
    if (!sel) return;
    setBusy(true);
    const id = createProject({ repo: sel, provider });
    setTimeout(() => {
      onClose();
      router.push('/projects/' + id);
    }, 400);
  };

  return (
    <Dialog onClose={onClose} className="max-w-[560px]">
      <DialogHeader>
        <DialogIcon>
          <Icons.folder />
        </DialogIcon>
        <div>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Connect a repository the GitHub App can access</DialogDescription>
        </div>
      </DialogHeader>
      <DialogBody>
        <Command>
          <CommandInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories…" autoFocus />
          <CommandList>
            {repos.map((r) => {
              const taken = existing.has(r.full);
              const on = sel === r.full;
              return (
                <button
                  key={r.id}
                  disabled={taken}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 border-0 border-b border-t-0 border-solid border-border/60 bg-card px-4 py-3 text-left transition-colors last:border-b-0',
                    on ? 'bg-accent shadow-[inset_2px_0_0_hsl(var(--primary))]' : 'hover:bg-[#fcfcfb]',
                    taken ? 'cursor-not-allowed opacity-50' : '',
                  )}
                  onClick={() => setSel(r.full)}
                >
                  <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-md border border-border bg-background text-secondary-foreground">
                    <Icons.repo className="size-[15px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-mono text-[13px] font-medium">
                      {r.full}
                      {taken ? <Badge className="px-1.5 py-0 text-[10px] normal-case">added</Badge> : null}
                    </span>
                    <span className="mt-0.5 flex items-center gap-3 font-mono text-[11.5px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <LangDot lang={r.lang} />
                        {r.lang}
                      </span>
                      <span>updated {fmtAgo(r.pushedAt)}</span>
                      <Badge className={cn('px-1.5 py-0 text-[10px] uppercase tracking-[.03em]', r.private ? '' : 'border-[var(--green-line)] text-primary')}>
                        {r.private ? 'private' : 'public'}
                      </Badge>
                    </span>
                  </span>
                  <span
                    className={cn(
                      'grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px] transition-colors',
                      on ? 'border-primary bg-primary' : 'border-border',
                    )}
                  >
                    <Icons.check className={cn('size-[11px] text-primary-foreground', on ? 'opacity-100' : 'opacity-0')} />
                  </span>
                </button>
              );
            })}
            {repos.length === 0 ? <CommandEmpty>No repositories match.</CommandEmpty> : null}
          </CommandList>
        </Command>
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs text-muted-foreground hover:text-[var(--green-ink)]"
            onClick={() => {
              onClose();
              router.push('/settings');
            }}
          >
            <Icons.plus />
            Repo missing? Manage GitHub App access
          </Button>
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Provider</span>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {['Local Docker', 'Hetzner', 'Daytona', 'Vercel'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </span>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!sel || busy}>
          {busy ? <span className="spin" /> : <Icons.check />}
          {busy ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
