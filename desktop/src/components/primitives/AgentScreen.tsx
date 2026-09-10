/**
 * Source: https://www.beautifului.dev/r/agent-screen.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
import { useState } from 'react';
import { Button } from '../atoms/Button';

export default function AgentScreen({ agentName, streamSrc, screenLabel, openLabel, closeLabel }: {
  agentName: string;
  streamSrc?: string;
  screenLabel: string;
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (!streamSrc) return null;
  return (
    <div className="w-full" data-agent-screen="">
      <button type="button" onClick={() => setOpen(true)} className="group relative aspect-[2964/1856] w-full overflow-hidden rounded-window bg-inset text-left shadow-card transition-shadow hover:shadow-raised">
        <img src={streamSrc} alt={screenLabel} className="h-full w-full object-cover" />
        <span className="absolute inset-0 grid place-items-center bg-ink/0 transition-colors group-hover:bg-ink/15"><span className="translate-y-1 opacity-0 transition-[opacity,transform] group-hover:translate-y-0 group-hover:opacity-100"><Button variant="accent" size="sm" tabIndex={-1}>{openLabel}</Button></span></span>
      </button>
      <p className="mt-2 px-0.5 text-[13px] font-medium text-ink">{screenLabel}</p>
      {open && <div className="fixed inset-0 z-[120] grid place-items-center bg-ink/60 p-6" role="dialog" aria-modal="true" aria-label={screenLabel} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="flex max-h-full max-w-[min(960px,90vw)] flex-col overflow-hidden rounded-window bg-surface p-2 shadow-overlay">
          <header className="flex h-10 items-center justify-between px-2"><strong className="text-[13px] text-ink">{agentName}</strong><Button size="xs" variant="quiet" onClick={() => setOpen(false)}>{closeLabel}</Button></header>
          <img src={streamSrc} alt={screenLabel} className="min-h-0 w-full rounded-control object-contain" />
        </div>
      </div>}
    </div>
  );
}
