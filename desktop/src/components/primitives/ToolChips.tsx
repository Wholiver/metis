/**
 * Source: https://www.beautifului.dev/r/tool-chips.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: no auto step timer — all rows/diffs come from props.
 */
"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

const Icons: Record<string, React.ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
  search: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></g>,
  agent: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></g>,
};

export type ToolDetailLine = { text: string; tone?: "add" };
export type ToolStep = {
  id?: string;
  icon?: string;
  partType?: "thinking" | "text" | "toolCall";
  label: string;
  chip: string;
  mono: boolean;
  detailMono: boolean;
  detail: ToolDetailLine[];
  running?: boolean;
  failed?: boolean;
};
export type ToolDiff = { file: string; add: number; del: number };
export type ToolDiffLine = { text: string; tone: "add" | "del" | "ctx" };
export type ToolChipsLabels = {
  header: string;
  more?: string;
};

export type ToolChipsProps = {
  variant?: string;
  steps?: ToolStep[];
  diffs?: ToolDiff[];
  diffLines?: Record<string, ToolDiffLine[]>;
  labels?: Partial<ToolChipsLabels>;
  className?: string;
  partKeys?: boolean;
  animateRows?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onToggleRow?: (label: string, open: boolean) => void;
  moreLabel?: string;
  onMore?: () => void;
  showHeader?: boolean;
};

export default function ToolChips({
  steps = [],
  diffs = [],
  diffLines = {},
  labels,
  className,
  partKeys = true,
  animateRows = false,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  onToggleRow,
  moreLabel,
  onMore,
  showHeader = true,
}: ToolChipsProps = {}) {
  const copy = { header: labels?.header ?? "Tools", more: moreLabel ?? labels?.more };
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined) setUncontrolledOpen(next);
  };
  const [preview, setPreview] = useState<{
    file: string;
    x: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const openPreview = (file: string) => (event: React.SyntheticEvent) => {
    const rect = (event.currentTarget as Element).closest("[data-diffchip]")!.getBoundingClientRect();
    const previewHeight = 38 + (diffLines[file]?.length ?? 0) * 19;
    const fitsBelow = rect.bottom + 6 + previewHeight <= window.innerHeight - 12;
    setPreview({
      file,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
      ...(fitsBelow
        ? { top: rect.bottom + 6 }
        : { bottom: window.innerHeight - rect.top + 6 }),
    });
  };
  const closePreview = (file: string) => () =>
    setPreview((current) => (current?.file === file ? null : current));

  const toggleRow = (label: string) =>
    setOpenRows((current) => {
      const next = new Set(current);
      next.has(label) ? next.delete(label) : next.add(label);
      onToggleRow?.(label, next.has(label));
      return next;
    });

  return (
    <div className={cn("w-full max-w-80 pb-1", className)} data-tool-group="" data-tool-chips="" data-tool-count={steps.length}>
      {showHeader && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="-mx-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 transition-transform duration-200"
            style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="tabular-nums truncate">{copy.header}</span>
        </button>
      )}

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        aria-hidden={!open}
      >
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">
            {steps.map((row) => {
              const rowKey = row.id ?? row.label;
              const rowOpen = openRows.has(rowKey);
              return (
                <div key={rowKey} className={animateRows ? "cot-work-item-enter tool-row-enter" : undefined} data-tool-chip-row="" data-part-key={partKeys ? row.id : undefined} data-part-type={row.partType ?? "toolCall"} data-tool-status={row.failed ? "Error" : row.running ? "Running" : "Completed"}>
                  <button
                    type="button"
                    aria-expanded={rowOpen}
                    onClick={() => toggleRow(rowKey)}
                    className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill={row.icon === "think" ? "currentColor" : "none"}
                        stroke="currentColor"
                        className={`transition-opacity duration-100 group-hover/row:opacity-0 ${rowOpen ? "opacity-0" : ""}`}
                        aria-hidden
                      >
                        {Icons[row.icon ?? "run"] ?? Icons.run}
                      </svg>
                      <svg
                        data-tool-chip-chevron=""
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${rowOpen ? "opacity-100" : "opacity-0"}`}
                        style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                    <span className={cn("shrink-0 text-[12.5px] font-medium text-ink", row.failed && "text-red", row.running && "shimmering")}>
                      {row.label}
                    </span>
                    <span
                      data-tool-chip-value=""
                      className={cn(
                        "inline-flex h-5.5 min-w-0 flex-1 cursor-pointer items-center truncate rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline transition-colors duration-100 hover:bg-hover-2",
                        row.mono && "font-mono",
                      )}
                    >
                      {row.chip}
                    </span>
                  </button>

                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-300"
                    style={{
                      gridTemplateRows: rowOpen ? "1fr" : "0fr",
                      opacity: rowOpen ? 1 : 0,
                      transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                    }}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="mt-0.5 mb-1 ml-2 flex max-h-52 flex-col gap-0.5 overflow-y-auto border-l border-line py-0.5 pl-3.5">
                        {row.detail.map((line, index) => (
                          <span
                            key={`${index}-${line.text.slice(0, 24)}`}
                            className={cn(
                              "truncate text-[11.5px] leading-[1.6]",
                              row.detailMono && "font-mono",
                              line.tone === "add" ? "text-green" : "text-ink-2",
                            )}
                          >
                            {line.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {diffs.length > 0 && (
            <div className="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-t border-line pt-2.5">
              {diffs.map((d) => (
                <span
                  key={d.file}
                  data-diffchip
                  className="relative"
                  onMouseEnter={diffLines[d.file] ? openPreview(d.file) : undefined}
                  onMouseLeave={diffLines[d.file] ? closePreview(d.file) : undefined}
                >
                  <button
                    type="button"
                    aria-expanded={preview?.file === d.file}
                    aria-label={`Show diff for ${d.file}`}
                    onFocus={diffLines[d.file] ? openPreview(d.file) : undefined}
                    onBlur={diffLines[d.file] ? closePreview(d.file) : undefined}
                    className="inline-flex h-7 max-w-full items-center gap-2 rounded-chip bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover"
                  >
                    <span className="min-w-0 truncate">{d.file}</span>
                    <span className="shrink-0 text-green tabular-nums">+{d.add}</span>
                    {d.del > 0 && <span className="shrink-0 text-red tabular-nums">−{d.del}</span>}
                  </button>
                </span>
              ))}
              {copy.more && (
                <button
                  type="button"
                  onClick={onMore}
                  className="inline-flex h-7 items-center rounded-chip px-1.5 font-mono text-[11.5px] text-ink-3 underline decoration-transparent underline-offset-2 transition-colors duration-100 hover:text-ink-2 hover:decoration-current"
                >
                  {copy.more}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {preview && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-50 w-72 overflow-hidden rounded-[10px] bg-surface shadow-overlay"
          style={{
            left: preview.x,
            top: preview.top,
            bottom: preview.bottom,
            animation: "pop-in 160ms cubic-bezier(0.23,1,0.32,1) both",
            transformOrigin: preview.top === undefined ? "bottom left" : "top left",
          }}
        >
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5 font-mono text-[11px]">
            <span className="min-w-0 truncate text-ink-2">{preview.file}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-green">+{diffs.find((diff) => diff.file === preview.file)?.add}</span>
              {(diffs.find((diff) => diff.file === preview.file)?.del ?? 0) > 0 && (
                <span className="text-red"> −{diffs.find((diff) => diff.file === preview.file)?.del}</span>
              )}
            </span>
          </div>
          <div className="py-1 font-mono text-[11px] leading-[1.8]">
            {(diffLines[preview.file] ?? []).map((line, index) => (
              <div
                key={index}
                className={`flex gap-2 px-2.5 whitespace-pre ${
                  line.tone === "add"
                    ? "bg-green-tint text-green"
                    : line.tone === "del"
                      ? "bg-red-tint text-red"
                      : "text-ink-2"
                }`}
              >
                <span className="w-3 shrink-0 select-none">{line.tone === "add" ? "+" : line.tone === "del" ? "−" : " "}</span>
                <span className="min-w-0 truncate">{line.text}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
