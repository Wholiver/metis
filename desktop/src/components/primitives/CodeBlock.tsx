/**
 * Source: https://www.beautifului.dev/r/code-block.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: no ice-cream defaults — empty until props provided.
 */
"use client";

import { useCallback, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type CodePiece = { text: string; change?: "add" | "del" };
export type DiffRow = {
  old: number | null;
  cur: number | null;
  type: "ctx" | "add" | "del";
  pieces: CodePiece[];
};
export type CodeBlockLabels = { copy: string; copied: string };

type Piece = CodePiece;
type Row = DiffRow;

const HATCH = "repeating-linear-gradient(45deg, var(--red) 0, var(--red) 1.5px, transparent 1.5px, transparent 3px)";
const KEYWORDS = new Set(["import", "from", "export", "default", "async", "function", "const", "let", "var", "await", "return", "if", "else", "for", "while", "new", "throw", "try", "catch", "null", "true", "false", "undefined"]);
const TOKEN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b|[A-Za-z_$][\w$]*(?=\s*\())/g;

function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    const t = m[0];
    if (idx > last) nodes.push(<span key={k++}>{text.slice(last, idx)}</span>);
    let color: string;
    let weight: number | undefined;
    if (/^["'`]/.test(t) || /^\d/.test(t)) color = "var(--orange)";
    else if (KEYWORDS.has(t)) color = "var(--accent-ink)";
    else { color = "var(--ink)"; weight = 500; }
    nodes.push(<span key={k++} style={{ color, fontWeight: weight }}>{t}</span>);
    last = idx + t.length;
  }
  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  return nodes;
}

function Pieces({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, i) => {
        if (p.change) {
          const add = p.change === "add";
          return (
            <span
              key={i}
              className="rounded-[3px]"
              style={{
                background: `color-mix(in srgb, var(--${add ? "green" : "red"}) 18%, transparent)`,
                padding: "0 2px",
                margin: "0 -1px",
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
              }}
            >
              {highlight(p.text)}
            </span>
          );
        }
        return <span key={i}>{highlight(p.text)}</span>;
      })}
    </>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-3">
      <path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
    </svg>
  );
}

const DEFAULT_LABELS: CodeBlockLabels = { copy: "Copy", copied: "Copied" };

export type CodeBlockProps = {
  variant?: string;
  lines?: string[];
  code?: string;
  diff?: DiffRow[];
  filename?: string;
  labels?: Partial<CodeBlockLabels>;
  onCopy?: (text: string) => void;
  className?: string;
  /** OpenCode-style flush viewer: no card chrome / file header. */
  flush?: boolean;
};

export default function CodeBlock({
  variant = "Code",
  lines = [],
  code,
  diff = [],
  filename = "code",
  labels,
  onCopy,
  className,
  flush = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDiff = variant === "Diff";
  const text = { ...DEFAULT_LABELS, ...labels };
  const raw = code ?? (isDiff
    ? diff.map((row) => row.pieces.map((piece) => piece.text).join("")).join("\n")
    : lines.join("\n"));

  const copy = useCallback(() => {
    if (!raw) return;
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      onCopy?.(raw);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [raw, onCopy]);

  const added = diff.filter((r) => r.type === "add").length;
  const removed = diff.filter((r) => r.type === "del").length;

  const body = (
    <div className={`${flush ? "py-1" : "py-3"} font-mono text-[12.5px] leading-[1.65] text-ink-2`} data-code-block-body="">
      {isDiff ? (
        <div className="relative" data-component="diff">
          {!flush && <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />}
          {diff.map((r, i) => {
            const add = r.type === "add";
            const del = r.type === "del";
            const num = del ? r.old : r.cur;
            return (
              <div
                key={i}
                data-line={r.type}
                className={`relative grid grid-cols-[28px_minmax(0,1fr)] items-start
                  ${add ? "bg-green-tint" : del ? "bg-red-tint" : ""}`}
              >
                {(add || del) && (
                  <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: add ? "var(--green)" : HATCH }} />
                )}
                <span className={`select-none pr-1 text-right text-[11px] tabular-nums ${add ? "text-green" : del ? "text-red" : "text-ink-3"}`}>{num ?? ""}</span>
                <code className="pr-3 pl-1 break-words whitespace-pre-wrap">
                  <Pieces pieces={r.pieces} />
                </code>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="relative">
          {!flush && <span className="pointer-events-none absolute inset-y-0 left-5 w-px bg-line" />}
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[28px_minmax(0,1fr)] items-start">
              <span className="select-none pr-1 text-right text-[11px] tabular-nums text-ink-3">{i + 1}</span>
              <code className="pr-3 pl-1 break-words whitespace-pre-wrap">{highlight(line)}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (flush) {
    return (
      <div className={cn("w-full max-w-full overflow-hidden bg-transparent", className)} data-code-block="" data-flush="">
        {body}
      </div>
    );
  }

  return (
    <div className={cn("w-full max-w-full overflow-hidden rounded-card bg-surface shadow-card", className)} data-code-block="">
      <div className="flex h-11 items-center gap-2 border-b border-line px-4 text-[12.5px]">
        <span className="inline-flex min-w-0 items-center gap-[7px]">
          <FileIcon />
          <span className="truncate font-mono leading-none text-ink">{filename}</span>
        </span>

        {isDiff ? (
          <span className="ml-auto inline-flex items-center gap-2 font-mono text-[12px] leading-none tabular-nums">
            <span className="text-green">+{added}</span>
            <span className="text-red">-{removed}</span>
          </span>
        ) : (
          <button
            type="button"
            aria-label={text.copy}
            onClick={copy}
            className={`-mr-1 ml-auto flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px]
              font-medium transition-colors duration-100 hover:bg-hover
              ${copied ? "text-green" : "text-ink-3 hover:text-ink"}`}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
            {copied ? text.copied : text.copy}
          </button>
        )}
      </div>

      {body}
    </div>
  );
}
