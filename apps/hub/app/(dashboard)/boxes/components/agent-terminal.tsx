import type { Box } from '@/lib/boxes/types';

function buildLog(box: Box): { s: string; c: string }[] {
  return [
    { s: box.task, c: 'cmd-line' },
    { s: '↳ reading ' + box.filesTouched + ' files in /workspace …', c: 'dim' },
    { s: '● Analysing ' + box.repo + ' @ ' + box.branch, c: '' },
    { s: '  ⎿ planning changes across ' + box.filesTouched + ' files', c: 'dim' },
    { s: '✓ edited src/checkout/session.ts (+48 −6)', c: 'ok' },
    { s: '✓ edited src/api/stripe.ts (+21 −2)', c: 'ok' },
    { s: '⚙ running test suite …', c: 'warnl' },
    { s: '✓ 42 passing · 0 failing', c: 'ok' },
    { s: '● Committing: ' + box.commits + ' commits on ' + box.branch, c: '' },
  ];
}

export function AgentTerminal({ box }: { box: Box }) {
  const live = box.status === 'running';
  const lines = buildLog(box);
  const prompt = 'claude@' + box.id + ':~/workspace$ ';

  return (
    <div className="term">
      <div className="term-bar">
        <span className="td r" />
        <span className="td y" />
        <span className="td g" />
        <span className="term-title">
          {box.agent} — {box.id}
        </span>
        {live ? (
          <span className="term-state">
            <span className="ld" />
            streaming
          </span>
        ) : null}
      </div>
      {live ? (
        <div className="term-body">
          {lines.map((l, i) => (
            <div key={i} className={'term-line' + (l.c && l.c !== 'cmd-line' ? ' ' + l.c : '')}>
              {l.c === 'cmd-line' ? (
                <>
                  <span className="shellp">{prompt}</span>
                  <span className="cmd">{l.s}</span>
                </>
              ) : (
                l.s
              )}
            </div>
          ))}
          <div className="term-line">
            <span className="shellp">{prompt}</span>
            <span className="cur" />
          </div>
        </div>
      ) : (
        <div className="term-body grid min-h-[150px] place-items-center">
          <div className="text-center">
            <span className="inline-block rounded-full border border-[#2c313a] px-3 py-1 text-[11px] uppercase tracking-[.1em] text-[#828893]">
              Output unavailable
            </span>
            <div className="mt-3 text-[11.5px] text-[#5b616b]">
              {box.status === 'paused'
                ? 'Box is paused — resume to stream agent output.'
                : 'Box is ' + box.status + '. Live CLI streaming arrives when the box is running.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
