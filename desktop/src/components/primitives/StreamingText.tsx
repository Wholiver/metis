/**
 * Source: https://www.beautifului.dev/r/streaming-text.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: no auto word timer / ice-cream demo. Body must go through Markdown + DOMPurify.
 */
"use client";

import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type StreamingToken = { text: string; cite?: boolean };
export type StreamingSource = { name: string; domain: string; href: string; image: string };
export type StreamingLabels = {
  sources: string;
  followUps: string;
};

export type StreamingTextProps = {
  variant?: string;
  /** Prefer rendering safe Markdown via children (MarkdownContent). */
  children?: ReactNode;
  /** When true, show the streaming caret after children. */
  streaming?: boolean;
  fill?: boolean;
  className?: string;
  /** Optional follow-ups once complete (controlled; no loop). */
  followUps?: string[];
  followUpsLabel?: string;
  onFollowUp?: (text: string, index: number) => void;
  /** Kept for registry parity — unused in Metis (no demo stream). */
  content?: StreamingToken[];
  sources?: StreamingSource[];
  labels?: Partial<StreamingLabels>;
  loop?: boolean;
  onDone?: () => void;
};

export default function StreamingText({
  children,
  streaming = false,
  fill = true,
  className,
  followUps,
  followUpsLabel = "Follow-ups",
  onFollowUp,
}: StreamingTextProps) {
  const done = !streaming;

  return (
    <div className={cn(fill ? "w-full min-w-0 max-w-full" : "min-h-[15.5rem] w-full max-w-95", className)}>
      <div className="text-[14px] leading-relaxed text-ink [overflow-wrap:anywhere]">
        {children}
        {streaming && (
          <span
            className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink align-middle"
            style={{ animation: "fade-in 150ms ease-out both" }}
            aria-label="Receiving message"
          />
        )}
      </div>

      {done && followUps && followUps.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[12px] font-medium text-ink-2">{followUpsLabel}</p>
          <div className="mt-0.5 flex flex-col">
            {followUps.map((text, i) => (
              <button
                key={text}
                type="button"
                onClick={() => onFollowUp?.(text, i)}
                className="-mx-1.5 flex items-center gap-2 rounded-[7px] border-b border-line px-1.5 py-1.5 text-left text-[12.5px] text-ink transition-colors duration-100 hover:bg-hover-2"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
