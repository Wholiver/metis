/**
 * Source: https://www.beautifului.dev/r/task-rows.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: no auto sequence timer — status comes from props.
 */
"use client";

import { useState } from "react";
import { cn } from "../../lib/utils";

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24, stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size} height={size} className="absolute inset-0" aria-hidden
        style={active ? { animation: "spin 1.1s linear infinite" } : undefined}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--ink-3)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "red" | "green"; children: React.ReactNode }) {
  return (
    <span className={`flex size-5.5 shrink-0 items-center justify-center rounded-full text-white ${tone === "red" ? "bg-red" : "bg-green"}`}>
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
);

export type TaskDetail = { label: string; meta: string };
export type TaskRow = {
  key: string;
  label: string;
  amount: string;
  status: "done" | "running" | "failed" | "pending";
  step?: number;
  details: TaskDetail[];
  defaultOpen?: boolean;
};

export type TaskRowsLabels = {
  completed: string;
  failed: string;
};

export type TaskRowsProps = {
  variant?: string;
  rows?: TaskRow[];
  labels?: Partial<TaskRowsLabels>;
  className?: string;
  maxVisibleRows?: number;
  expandable?: boolean;
  onToggleRow?: (key: string, open: boolean) => void;
  onRowClick?: (key: string) => void;
};

export default function TaskRows({
  variant = "Capsules",
  rows = [],
  labels,
  className,
  maxVisibleRows,
  expandable = true,
  onToggleRow,
  onRowClick,
}: TaskRowsProps) {
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const copy = {
    completed: labels?.completed ?? "Completed",
    failed: labels?.failed ?? "Failed",
  };

  const badgeFor = (row: TaskRow) => {
    if (row.status === "done") return <Badge tone="green">{CheckIcon}</Badge>;
    if (row.status === "failed") return <Badge tone="red">{XIcon}</Badge>;
    if (row.status === "running") return <SpinnerRing active>{row.step}</SpinnerRing>;
    return <SpinnerRing>{row.step}</SpinnerRing>;
  };

  const pillFor = (row: TaskRow) => {
    if (row.status === "done") {
      return (
        <span className="inline-flex h-5.5 items-center rounded-full bg-green-tint px-2 text-[11.5px] font-medium text-green">
          {copy.completed}
        </span>
      );
    }
    if (row.status === "failed") {
      return (
        <span className="inline-flex h-5.5 items-center rounded-full bg-red-tint px-2 text-[11.5px] font-medium text-red">
          {copy.failed}
        </span>
      );
    }
    return null;
  };

  const list = variant === "List";
  const scrolls = Boolean(maxVisibleRows && maxVisibleRows > 0 && rows.length > maxVisibleRows);
  return (
    <div
      className={cn(
        "flex w-full max-w-full flex-col",
        list ? "gap-0 self-start rounded-card bg-surface shadow-card" : "gap-2",
        scrolls ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
        className,
      )}
      style={scrolls ? { maxHeight: `${maxVisibleRows * 44}px` } : undefined}
      data-task-rows=""
      data-max-visible-rows={maxVisibleRows ?? undefined}
    >
      {rows.map((row, index) => {
        const open = manualOpen[row.key] ?? Boolean(row.defaultOpen);
        return (
          <div
            key={row.key}
            className={cn(
              "shrink-0 self-stretch overflow-hidden transition-[border-radius,background-color] duration-300 hover:bg-inset",
              list ? "border-b border-line last:border-0" : "bg-surface shadow-card",
            )}
            data-task-row=""
            data-task-status={row.status}
            style={{
              borderRadius: list ? 0 : open ? 14 : 22,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${index * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={expandable ? open : undefined}
              disabled={!expandable}
              onClick={() => {
                if (!expandable) return;
                const next = !open;
                setManualOpen((current) => ({ ...current, [row.key]: next }));
                onToggleRow?.(row.key, next);
                onRowClick?.(row.key);
              }}
              className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">{badgeFor(row)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{row.label}</span>
              <span className="text-[12.5px] text-ink-2 tabular-nums">{row.amount}</span>
              {pillFor(row)}
              {expandable ? (
                <span aria-hidden className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3">
                  <svg
                    width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    className="transition-transform duration-300"
                    style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              ) : null}
            </button>

            {expandable ? <div
              className="grid transition-[grid-template-rows,opacity] duration-300"
              style={{
                gridTemplateRows: open ? "1fr" : "0fr",
                opacity: open ? 1 : 0,
                transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            >
              <div className="overflow-hidden">
                <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                  <span aria-hidden className="mx-auto h-full w-px bg-line" />
                  <div className="flex flex-col gap-1.5">
                    {row.details.map((d) => (
                      <div key={d.label} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[12px] text-ink-2">{d.label}</span>
                        <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular-nums">{d.meta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div> : null}
          </div>
        );
      })}
    </div>
  );
}
