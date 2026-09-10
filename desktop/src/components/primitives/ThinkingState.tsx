/**
 * Source: https://www.beautifului.dev/r/thinking-state.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: demo timers removed — state is driven by props.
 */
"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type ThinkingRow = {
  id?: string;
  primary: string;
  secondary?: string;
  mono?: boolean;
  add?: number;
  del?: number;
  href?: string;
  running?: boolean;
};

export type ThinkingStateProps = {
  variant?: "Steps" | "Reasoning" | "Search" | "Coding" | string;
  activeLabel?: string;
  doneLabel?: string;
  working?: boolean;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  rows?: ThinkingRow[];
  query?: string;
  className?: string;
  /** For Reasoning: rich body (e.g. MarkdownContent) instead of row list */
  children?: ReactNode;
  headerClassName?: string;
  "data-thinking-block"?: string;
};

function Dot({ tone }: { tone: string }) {
  return (
    <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-full text-white ${tone}`}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    </span>
  );
}

const TONES = ["bg-accent", "bg-orange", "bg-green"];

export default function ThinkingState({
  variant = "Steps",
  activeLabel = "Thinking",
  doneLabel = "Thought",
  working = false,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  rows = [],
  query,
  className,
  children,
  headerClassName,
  ...dataAttrs
}: ThinkingStateProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const expanded = expandedProp ?? uncontrolledExpanded;
  const setExpanded = (next: boolean) => {
    onExpandedChange?.(next);
    if (expandedProp === undefined) setUncontrolledExpanded(next);
  };

  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [rows.length, expanded, variant, children, working]);

  return (
    <div
      className={cn("flex w-full max-w-full flex-col", className)}
      {...(dataAttrs["data-thinking-block"] !== undefined
        ? {
            "data-thinking-block": dataAttrs["data-thinking-block"],
            "data-thinking-content": "",
            "data-part-type": "thinking",
          }
        : {})}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "-mx-1.5 flex w-fit max-w-full items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2",
          headerClassName,
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={working ? "var(--ink-2)" : "var(--ink-3)"} aria-hidden>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="contents">
          {working ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {activeLabel}
            </span>
          ) : (
            <span className="text-[13px] font-medium whitespace-nowrap text-ink-2">{doneLabel}</span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 transition-transform duration-300"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
        aria-hidden={!expanded}
      >
        <div className="overflow-hidden">
          <div className={cn("relative mt-1", !(children && !rows.length) && "ml-[5px] pl-4")}>
            {!(children && !rows.length) && (
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{
                top: -8,
                height: lineHeight ? lineHeight - 2 : 0,
                transition: "height 500ms cubic-bezier(0.23,1,0.32,1)",
              }}
            />
            )}
            <div ref={traceRef} className={cn("flex flex-col gap-1 py-1", children && !rows.length && "ml-0 pl-0")}>
              {query && (
                <div className="flex h-6 items-center gap-2 px-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  <span className="text-[12.5px] text-ink-2">{query}</span>
                </div>
              )}

              {children ? (
                <div className="min-w-0 px-0.5 text-[12.5px] leading-relaxed text-ink-2">{children}</div>
              ) : (
                rows.map((row, i) => {
                  const content = (
                    <>
                      {variant === "Search" && <Dot tone={TONES[i % 3]} />}
                      {variant === "Steps" && (
                        row.running ? (
                          <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} />
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )
                      )}
                      <span
                        className={cn(
                          "min-w-0 truncate text-[12.5px]",
                          variant === "Reasoning" ? "whitespace-normal leading-relaxed text-ink-2" : "font-medium text-ink",
                          variant === "Search" && "animated-underline",
                        )}
                      >
                        {row.primary}
                      </span>
                      {row.secondary && (
                        <span className={cn("shrink-0 text-[11.5px] text-ink-3", row.mono && "font-mono")}>
                          {row.secondary}
                        </span>
                      )}
                      {row.add !== undefined && (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums">
                          <span className="text-green">+{row.add}</span>{" "}
                          <span className="text-red">−{row.del ?? 0}</span>
                        </span>
                      )}
                    </>
                  );
                  const rowClass = "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left";
                  const key = row.id ?? `${row.primary}-${i}`;

                  if (variant === "Search" && row.href) {
                    return (
                      <a key={key} href={row.href} target="_blank" rel="noreferrer" className={`${rowClass} transition-colors duration-150 hover:bg-hover`}>
                        {content}
                      </a>
                    );
                  }

                  if (variant === "Coding") {
                    const selected = selectedTool === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedTool(selected ? null : key)}
                        className={`${rowClass} transition-colors duration-150 ${selected ? "bg-inset" : "hover:bg-hover"}`}
                      >
                        {content}
                      </button>
                    );
                  }

                  return (
                    <div key={key} className={rowClass}>
                      {content}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
