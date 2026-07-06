'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. non-secure context) — no-op; the URL still opens via the button.
    }
  }, [url]);
  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Icons.check /> : <Icons.copy />}
      {copied ? 'Copied' : 'Copy URL'}
    </Button>
  );
}

export function Access({ webUrl, vncUrl }: { webUrl?: string | null; vncUrl?: string | null }) {
  if (!webUrl && !vncUrl) return null;
  return (
    <Card className="divide-y divide-border/60 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4.5 p-3.5">
        <div className="min-w-[150px] flex-1">
          <div className="text-[13.5px] font-medium">{webUrl ? 'Web' : 'VNC'}</div>
          <div className="mt-0.5 break-all font-mono text-[11.5px] text-muted-foreground">{webUrl ?? 'Remote desktop'}</div>
        </div>
        <div className="flex flex-none flex-wrap gap-1.5">
          {webUrl ? (
            <Button variant="outline" size="sm" href={webUrl} target="_blank" rel="noreferrer">
              <Icons.ext />
              Open web
            </Button>
          ) : null}
          {webUrl ? <CopyButton url={webUrl} /> : null}
          {vncUrl ? (
            <Button variant="outline" size="sm" href={vncUrl} target="_blank" rel="noreferrer">
              <Icons.ext />
              Open VNC
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
