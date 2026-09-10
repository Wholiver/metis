/**
 * Source: https://www.beautifului.dev/r/context-cards.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
import { cn } from '../../lib/utils';

export type ContextCardItem = {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  previewUrl?: string;
};

export default function ContextCards({ items, className, onOpen }: {
  items: ContextCardItem[];
  className?: string;
  onOpen?: (item: ContextCardItem) => void;
}) {
  return (
    <div className={cn('grid w-full gap-1.5', className)} data-context-cards="">
      {items.map((item) => {
        const content = (
          <>
            {item.previewUrl ? <img src={item.previewUrl} alt="" className="size-10 shrink-0 rounded-control object-cover shadow-hairline" /> : (
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-control bg-accent-tint font-mono text-[11px] font-semibold text-accent-ink">{item.title.slice(0, 2).toUpperCase()}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{item.title}</span>
              {item.description && <span className="mt-0.5 block truncate text-[11.5px] text-ink-2">{item.description}</span>}
            </span>
            {item.meta && <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-3">{item.meta}</span>}
          </>
        );
        return onOpen ? (
          <button key={item.id} type="button" onClick={() => onOpen(item)} className="flex min-h-12 w-full items-center gap-2.5 rounded-card bg-surface px-3 py-2 text-left shadow-card transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.99]">{content}</button>
        ) : (
          <div key={item.id} className="flex min-h-12 w-full items-center gap-2.5 rounded-card bg-surface px-3 py-2 shadow-card">{content}</div>
        );
      })}
    </div>
  );
}
