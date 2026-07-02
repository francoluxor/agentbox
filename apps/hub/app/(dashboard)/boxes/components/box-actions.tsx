'use client';

import type { MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useStore } from '@/lib/boxes/store';
import type { Box } from '@/lib/boxes/types';

export function BoxActions({ box, size }: { box: Box; size?: 'lg' }) {
  const { pauseBox, resumeBox, stopBox, destroyBox } = useStore();
  const running = box.status === 'running';
  const paused = box.status === 'paused';
  const lg = size === 'lg';
  const sz = lg ? 'sm' : 'icon-sm';

  const stop = (e: MouseEvent) => e.stopPropagation();
  const confirmDestroy = (e: MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Destroy box ' + box.id + '? Its workspace volume is discarded. This cannot be undone.')) {
      destroyBox(box.id);
    }
  };

  return (
    <div className={cn('flex gap-1.5', lg ? '' : 'justify-end')}>
      {paused ? (
        <Button
          variant={lg ? 'default' : 'outline'}
          size={sz}
          title="Resume"
          className={lg ? '' : 'hover:border-[var(--green)] hover:bg-accent hover:text-[var(--green-ink)]'}
          onClick={(e) => {
            stop(e);
            resumeBox(box.id);
          }}
        >
          <Icons.play />
          {lg ? 'Resume' : null}
        </Button>
      ) : (
        <Button
          variant="outline"
          size={sz}
          disabled={!running}
          title="Pause"
          className={lg ? '' : 'hover:border-[var(--amber)] hover:bg-[var(--amber-soft)] hover:text-[var(--amber)]'}
          onClick={(e) => {
            stop(e);
            pauseBox(box.id);
          }}
        >
          <Icons.pause />
          {lg ? 'Pause' : null}
        </Button>
      )}
      <Button
        variant="outline"
        size={sz}
        disabled={box.status === 'stopped'}
        title="Stop"
        onClick={(e) => {
          stop(e);
          stopBox(box.id);
        }}
      >
        <Icons.stop />
        {lg ? 'Stop' : null}
      </Button>
      <Button variant="destructive" size={sz} title="Destroy" onClick={confirmDestroy}>
        <Icons.trash />
        {lg ? 'Destroy' : null}
      </Button>
    </div>
  );
}
