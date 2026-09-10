"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import {
  ChevronDown,
  Search,
  Terminal,
  Check,
  Globe,
  ExternalLink,
  Brain,
  FileCode2,
  FileText,
  Command,
  Database,
  AlertCircle,
  Cpu,
  Code2,
  Copy,
  CheckCheck,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────
 * SAFE DYNAMIC ICON RENDERER
 * ───────────────────────────────────────────────────────── */
function renderDynamicIcon(icon: any, className?: string): React.ReactNode {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  if (typeof icon === "function" || typeof icon === "object") {
    return React.createElement(icon, {
      className: cn("size-3.5 shrink-0", className),
      "aria-hidden": "true",
    });
  }
  return null;
}

/* ─────────────────────────────────────────────────────────
 * COMPACT 3x3 PIXEL DOT GRID LOADER
 * ───────────────────────────────────────────────────────── */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

export function PixelDotsLoader({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 grid-cols-[repeat(3,3px)] gap-[1.5px] items-center",
        className
      )}
    >
      {CHEVRON_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-[3px] rounded-full bg-foreground/80 transition-opacity motion-reduce:animate-none"
          style={{
            opacity: 0.2,
            animation: `agent-pixel-on 650ms cubic-bezier(0.23, 1, 0.32, 1) ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────
 * TERMINAL & BASH COMMAND EXECUTION VIEWER
 * ───────────────────────────────────────────────────────── */
export interface TerminalCommandProps {
  command: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  isRunning?: boolean;
  className?: string;
}

export function TerminalCommand({
  command,
  output,
  exitCode = 0,
  durationMs,
  isRunning = false,
  className,
}: TerminalCommandProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    const fullText = output ? `$ ${command}\n\n${output}` : `$ ${command}`;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border border-border/80 bg-card font-mono text-[11.5px] shadow-xs select-text",
        className
      )}
    >
      {/* Terminal Command Header */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-2.5 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Terminal className="size-3.5 text-violet-500 shrink-0" aria-hidden="true" />
          <span className="text-muted-foreground/60 select-none font-bold">$</span>
          <span className="truncate font-semibold text-foreground tracking-tight">{command}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {durationMs !== undefined && (
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {durationMs}ms
            </span>
          )}

          {isRunning ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10.5px] font-medium text-violet-600 dark:text-violet-400">
              <span className="size-1.5 rounded-full bg-violet-500 animate-pulse" />
              running
            </span>
          ) : exitCode === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
              exit 0
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-600 dark:text-rose-400 tabular-nums">
              exit {exitCode}
            </span>
          )}

          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied command and output" : "Copy command"}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm px-1 py-0.5 active:scale-[0.96]"
          >
            {copied ? (
              <CheckCheck className="size-3 text-emerald-500" aria-hidden="true" />
            ) : (
              <Copy className="size-3" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Stdout Output Area */}
      {output && (
        <div className="relative p-2.5 overflow-x-auto bg-muted/20 text-[11px] leading-relaxed text-muted-foreground">
          <pre className="whitespace-pre font-mono">
            {output.split("\n").map((line, idx) => {
              const isPass = line.includes("✓") || line.includes("PASS") || line.includes("passed");
              const isFail = line.includes("FAIL") || line.includes("Error") || line.includes("failed");
              const isWarn = line.includes("WARN") || line.includes("warning");

              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-start gap-1",
                    isPass && "text-emerald-600 dark:text-emerald-400 font-medium",
                    isFail && "text-rose-600 dark:text-rose-400 font-medium",
                    isWarn && "text-amber-600 dark:text-amber-400",
                    !isPass && !isFail && !isWarn && "text-muted-foreground"
                  )}
                >
                  <span>{line}</span>
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * REAL FILE DIFF VIEWER
 * ───────────────────────────────────────────────────────── */
export type DiffRow = {
  old?: number | null;
  cur?: number | null;
  type: "add" | "del" | "ctx";
  text: string;
};

export interface FileDiffProps {
  file: string;
  rows: DiffRow[];
  className?: string;
}

export function FileDiff({ file, rows = [], className }: FileDiffProps) {
  const [copied, setCopied] = React.useState(false);
  const added = rows.filter((r) => r.type === "add").length;
  const removed = rows.filter((r) => r.type === "del").length;

  const handleCopy = () => {
    const textContent = rows
      .map((r) => `${r.type === "add" ? "+" : r.type === "del" ? "-" : " "} ${r.text}`)
      .join("\n");
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border border-border/80 bg-card font-mono text-[11.5px] shadow-xs select-text",
        className
      )}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-2.5 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="truncate font-medium text-foreground tracking-tight">{file}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          <div className="flex items-center gap-1.5 tabular-nums text-[11px] font-semibold">
            {added > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>}
            {removed > 0 && <span className="text-rose-600 dark:text-rose-400">−{removed}</span>}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied diff" : "Copy diff to clipboard"}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm px-1 py-0.5 active:scale-[0.96]"
          >
            {copied ? (
              <CheckCheck className="size-3 text-emerald-500" aria-hidden="true" />
            ) : (
              <Copy className="size-3" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Code Gutter & Lines */}
      <div className="relative flex flex-col py-1.5 overflow-x-auto leading-[21px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-[70px] top-0 w-[1px] bg-border/60 z-1"
        />

        {rows.map((r, i) => (
          <div
            key={i}
            className={cn(
              "group relative grid grid-cols-[34px_34px_20px_1fr] items-stretch transition-colors duration-100",
              r.type === "add" && "bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-950 dark:text-emerald-100",
              r.type === "del" && "bg-rose-500/10 dark:bg-rose-500/15 text-rose-950 dark:text-rose-100",
              r.type === "ctx" && "text-muted-foreground"
            )}
          >
            {r.type === "add" && (
              <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-emerald-500" aria-hidden="true" />
            )}
            {r.type === "del" && (
              <span
                className="absolute left-0 top-0 bottom-0 w-[3px]"
                aria-hidden="true"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, #ef4444 0, #ef4444 1.5px, transparent 1.5px, transparent 3px)",
                }}
              />
            )}

            <span className={cn("select-none text-right pr-2 text-[10.5px] tabular-nums", r.type === "del" ? "text-rose-600 dark:text-rose-400 font-semibold" : "text-muted-foreground/60")}>
              {r.old ?? ""}
            </span>
            <span className={cn("select-none text-right pr-2 text-[10.5px] tabular-nums", r.type === "add" ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-muted-foreground/60")}>
              {r.cur ?? ""}
            </span>

            <span className={cn("select-none text-center text-[11px] font-bold", r.type === "add" && "text-emerald-600 dark:text-emerald-400", r.type === "del" && "text-rose-600 dark:text-rose-400")}>
              {r.type === "add" ? "+" : r.type === "del" ? "−" : ""}
            </span>

            <code className={cn("whitespace-pre pl-1 pr-3 text-[11.5px] font-mono", r.type === "add" ? "text-foreground font-medium" : r.type === "del" ? "text-foreground line-through opacity-80" : "text-muted-foreground")}>
              {r.text}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * TYPE DEFINITIONS & SCHEMAS
 * ───────────────────────────────────────────────────────── */
export type TraceNodeType =
  | "reasoning"
  | "step"
  | "search"
  | "tool"
  | "terminal"
  | "diffs"
  | (string & {});

export type DetailLine = {
  text: string;
  tone?: "add" | "del" | "ctx" | "muted" | "error";
};

export interface ToolDefinition<TArgs = any, TResult = any> {
  name: string;
  label?: string | ((args: TArgs) => string);
  icon?: any;
  iconClassName?: string;
  formatChip?: (args: TArgs, result?: TResult) => string;
  monoChip?: boolean;
  renderCustomContent?: (props: {
    args?: TArgs;
    result?: TResult;
    node: TraceNode<TArgs, TResult>;
  }) => React.ReactNode;
}

export type TraceNode<TArgs = any, TResult = any> = {
  id?: string;
  type: TraceNodeType;
  toolName?: string;
  sentences?: string[];
  durationSeconds?: number;
  primary?: string;
  secondary?: string;
  mono?: boolean;
  icon?: any;
  iconClassName?: string;
  status?: "pending" | "running" | "completed" | "failed";
  args?: TArgs;
  result?: TResult;
  command?: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  add?: number;
  del?: number;
  diffRows?: DiffRow[];
  diffFile?: string;
  codeSnippet?: string;
  details?: DetailLine[];
  sources?: { name: string; url?: string }[];
  renderContent?: () => React.ReactNode;
};

export type AgentPhase = {
  trace: TraceNode[];
  message?: string;
};

const SENT_H = 46;
const GAP = 8;
const MAX_H = 184;
const FADE = 18;

/* ─────────────────────────────────────────────────────────
 * DEFAULT TOOL REGISTRY
 * ───────────────────────────────────────────────────────── */
export const DEFAULT_TOOL_REGISTRY: Record<string, ToolDefinition> = {
  read_file: {
    name: "read_file",
    label: "Read",
    icon: FileText,
    iconClassName: "text-muted-foreground/80",
    monoChip: true,
  },
  edit_file: {
    name: "edit_file",
    label: "Edit",
    icon: FileCode2,
    iconClassName: "text-amber-500",
    monoChip: true,
  },
  execute_command: {
    name: "execute_command",
    label: "Run",
    icon: Terminal,
    iconClassName: "text-violet-500",
    monoChip: true,
  },
  search_web: {
    name: "search_web",
    label: "Search",
    icon: Search,
    iconClassName: "text-blue-500",
  },
  query_database: {
    name: "query_database",
    label: "SQL Query",
    icon: Database,
    iconClassName: "text-emerald-500",
    monoChip: true,
  },
};

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT
 * ───────────────────────────────────────────────────────── */
export interface StreamingTextProps extends React.HTMLAttributes<HTMLDivElement> {
  text: string;
  speed?: number;
  chunkSize?: number;
  onComplete?: () => void;
}

export function StreamingText({
  text,
  speed = 18,
  chunkSize = 2,
  className,
  onComplete,
  ...props
}: StreamingTextProps) {
  const [shown, setShown] = React.useState("");
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;

  React.useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += chunkSize;
      const nextText = text.slice(0, i);
      setShown(nextText);
      if (i >= text.length) {
        clearInterval(id);
        onCompleteRef.current?.();
      }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, chunkSize]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "font-sans text-[14.5px] leading-relaxed text-foreground/90 select-text whitespace-pre-line text-pretty",
        className
      )}
      {...props}
    >
      {shown}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * NESTED REASONING BLOCK
 * ───────────────────────────────────────────────────────── */
interface NestedReasoningBlockProps {
  id?: string;
  sentences: string[];
  delays?: number[];
  isActive: boolean;
  isFinished: boolean;
  durationSeconds?: number;
  onFinished?: () => void;
  controlled?: boolean;
}

export function NestedReasoningBlock({
  id,
  sentences,
  delays,
  isActive,
  isFinished,
  durationSeconds = 4.2,
  onFinished,
  controlled = false,
}: NestedReasoningBlockProps) {
  const [revealedCount, setRevealedCount] = React.useState(isFinished ? sentences.length : 0);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [fade, setFade] = React.useState({ top: false, bottom: true });
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const onFinishedRef = React.useRef(onFinished);
  onFinishedRef.current = onFinished;

  React.useEffect(() => {
    if (controlled || !isActive || isFinished) return;

    const cadence = delays || sentences.map(() => 1800 + Math.floor(Math.random() * 400));
    const totalMs = cadence.reduce((a, b) => a + b, 0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let cumulative = 0;

    cadence.forEach((delay, idx) => {
      cumulative += delay;
      timers.push(
        setTimeout(() => {
          setRevealedCount(idx + 1);
        }, cumulative)
      );
    });

    timers.push(
      setTimeout(() => {
        onFinishedRef.current?.();
      }, totalMs + 600)
    );

    return () => timers.forEach(clearTimeout);
  }, [controlled, isActive, isFinished, delays, sentences]);

  const expanded = isFinished ? manualOpen : isActive;
  const count = controlled || isFinished ? sentences.length : revealedCount;
  const contentH = count > 0 ? count * SENT_H + (count - 1) * GAP : 0;
  const capped = contentH > MAX_H;
  const viewH = capped ? MAX_H : contentH;
  const scrollable = isFinished && manualOpen;
  const translate = scrollable ? 0 : capped ? MAX_H - FADE - contentH : 0;

  const showTop = scrollable ? fade.top : capped;
  const showBottom = scrollable ? fade.bottom : capped;

  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${
        showTop ? FADE : 0
      }px, #000 calc(100% - ${showBottom ? FADE : 0}px), transparent 100%)`
    : "none";

  const onScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  };

  return (
    <div className="flex w-full flex-col my-0.5" data-part-key={id} data-part-type="thinking" style={{ animation: "agent-fade 280ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <button
        type="button"
        disabled={!isFinished}
        aria-expanded={expanded}
        onClick={() => isFinished && setManualOpen((v) => !v)}
        className={cn(
          "group/row relative flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px] transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          isFinished ? "hover:bg-muted/60 cursor-pointer active:scale-[0.98]" : "cursor-default"
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <Brain
            aria-hidden="true"
            className={cn(
              "size-3.5 opacity-75 transition-opacity duration-150",
              isFinished && "group-hover/row:opacity-0",
              manualOpen && "opacity-0"
            )}
          />
          {isFinished && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "absolute size-3.5 transition-transform duration-200 opacity-0",
                "group-hover/row:opacity-100",
                manualOpen ? "opacity-100 rotate-0" : "-rotate-90"
              )}
            />
          )}
        </span>

        <span className="text-[12px] font-medium transition-colors">
          {isFinished ? (
            <span className="text-foreground">
              Thought for <span className="tabular-nums font-mono text-[11.5px]">{durationSeconds}s</span>
            </span>
          ) : (
            <span
              className="bg-clip-text text-transparent font-medium"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--color-muted-foreground, oklch(0.55 0 0)) 35%, var(--color-foreground, oklch(0.95 0 0)) 50%, var(--color-muted-foreground, oklch(0.55 0 0)) 65%)",
                backgroundSize: "200% 100%",
                animation: "agent-shimmer 1.8s linear infinite",
              }}
            >
              Thinking…
            </span>
          )}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 mb-1.5 ml-2.5 border-l border-border/70 py-0.5 pl-2.5">
            <div
              ref={viewportRef}
              className={cn(
                "overflow-hidden transition-[height] duration-300 ease-out pr-1",
                scrollable && "overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              )}
              style={{
                height: `${viewH}px`,
                WebkitMaskImage: mask,
                maskImage: mask,
              }}
              onScroll={scrollable ? onScroll : undefined}
            >
              <div
                className="flex flex-col gap-2 transition-transform duration-400 ease-out will-change-transform"
                style={{ transform: `translateY(${translate}px)` }}
              >
                {sentences.slice(0, count).map((line, i) => (
                  <p
                    key={i}
                    className="m-0 h-[46px] text-[13px] font-[425] leading-[23px] tracking-tight text-muted-foreground line-clamp-2 overflow-hidden text-pretty"
                    style={{ animation: "agent-fade 250ms cubic-bezier(0.23,1,0.32,1) both" }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * UNIVERSAL EXTENSIBLE PILL ROW ITEM
 * ───────────────────────────────────────────────────────── */
interface TracePillRowProps {
  node: TraceNode;
  isActive: boolean;
  isFinished: boolean;
  toolRegistry?: Record<string, ToolDefinition>;
}

function TracePillRow({
  node,
  isActive,
  isFinished,
  toolRegistry = DEFAULT_TOOL_REGISTRY,
}: TracePillRowProps) {
  const [open, setOpen] = React.useState(false);

  const toolDef = node.toolName ? toolRegistry[node.toolName] : undefined;

  const isCommandNode = Boolean(
    node.command || node.type === "terminal" || node.type === "command"
  );

  const hasDetails = Boolean(
    isCommandNode ||
      node.renderContent ||
      toolDef?.renderCustomContent ||
      node.diffRows ||
      node.codeSnippet ||
      (node.details && node.details.length > 0) ||
      (node.sources && node.sources.length > 0) ||
      node.args ||
      node.result
  );

  const primaryText =
    node.primary ||
    (isCommandNode ? "Run" : undefined) ||
    (typeof toolDef?.label === "function" ? toolDef.label(node.args) : toolDef?.label) ||
    toolDef?.name ||
    node.type;

  const secondaryText =
    node.secondary ||
    node.command ||
    (toolDef?.formatChip ? toolDef.formatChip(node.args, node.result) : undefined) ||
    (typeof node.args === "string" ? node.args : undefined);

  const isMono = node.mono ?? (isCommandNode || Boolean(toolDef?.monoChip));

  const renderIcon = () => {
    if (isActive) {
      return (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground"
        />
      );
    }
    if (node.status === "failed" || (node.exitCode !== undefined && node.exitCode > 0)) {
      return <AlertCircle className="size-3.5 text-rose-500 shrink-0" aria-hidden="true" />;
    }

    if (node.icon) return renderDynamicIcon(node.icon, node.iconClassName);
    if (toolDef?.icon) return renderDynamicIcon(toolDef.icon, toolDef.iconClassName);

    const semanticKey = `${node.primary || ""} ${node.toolName || ""} ${node.type || ""} ${node.command || ""}`.toLowerCase();

    if (semanticKey.includes("read") || semanticKey.includes("inspect") || semanticKey.includes("parse")) {
      return <FileText className="size-3.5 text-muted-foreground/80 shrink-0" aria-hidden="true" />;
    }
    if (
      semanticKey.includes("edit") ||
      semanticKey.includes("write") ||
      semanticKey.includes("patch") ||
      semanticKey.includes("create")
    ) {
      return <FileCode2 className="size-3.5 text-amber-500 shrink-0" aria-hidden="true" />;
    }
    if (
      isCommandNode ||
      semanticKey.includes("run") ||
      semanticKey.includes("test") ||
      semanticKey.includes("compile") ||
      semanticKey.includes("tsc") ||
      semanticKey.includes("exec")
    ) {
      return <Terminal className="size-3.5 text-violet-500 shrink-0" aria-hidden="true" />;
    }
    if (semanticKey.includes("search") || semanticKey.includes("query") || semanticKey.includes("lookup")) {
      return <Search className="size-3.5 text-blue-500 shrink-0" aria-hidden="true" />;
    }
    if (semanticKey.includes("db") || semanticKey.includes("database") || semanticKey.includes("sql") || semanticKey.includes("redis")) {
      return <Database className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />;
    }
    if (semanticKey.includes("deploy") || semanticKey.includes("canary") || semanticKey.includes("cluster")) {
      return <Cpu className="size-3.5 text-sky-500 shrink-0" aria-hidden="true" />;
    }
    if (node.type === "step") {
      return <Check className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />;
    }

    return <Command className="size-3.5 text-muted-foreground/80 shrink-0" aria-hidden="true" />;
  };

  return (
    <div className="flex flex-col my-0.5" data-part-key={node.id} data-part-type="toolCall" data-tool-name={node.toolName} data-tool-status={node.status} style={{ animation: "agent-fade 280ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <button
        type="button"
        disabled={!hasDetails}
        aria-expanded={open}
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={cn(
          "group/row relative flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px] transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          hasDetails ? "hover:bg-muted/60 cursor-pointer active:scale-[0.98]" : "cursor-default"
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <span
            className={cn(
              "transition-opacity duration-150 flex items-center justify-center",
              hasDetails && "group-hover/row:opacity-0",
              open && "opacity-0"
            )}
          >
            {renderIcon()}
          </span>
          {hasDetails && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "absolute size-3.5 transition-transform duration-200 opacity-0",
                "group-hover/row:opacity-100",
                open ? "opacity-100 rotate-0" : "-rotate-90"
              )}
            />
          )}
        </span>

        <span className="shrink-0 text-[12px] font-medium text-foreground tracking-tight">
          {primaryText}
        </span>

        {secondaryText && (
          <span
            className={cn(
              "inline-flex h-5 min-w-0 max-w-[65%] items-center truncate rounded-md bg-muted/80 px-1.5 text-[11px] text-muted-foreground border border-border/40 transition-colors group-hover/row:border-border/80 group-hover/row:text-foreground",
              isMono ? "font-mono" : "font-sans"
            )}
          >
            <span className="truncate">{secondaryText}</span>
          </span>
        )}

        {(node.add !== undefined || node.del !== undefined) && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[11px] tabular-nums shrink-0">
            {node.add !== undefined && node.add > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{node.add}</span>
            )}
            {node.del !== undefined && node.del > 0 && (
              <span className="text-rose-600 dark:text-rose-400 font-medium">−{node.del}</span>
            )}
          </span>
        )}
      </button>

      {hasDetails && (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-1 mb-1.5 ml-2.5 flex flex-col gap-1.5 border-l border-border/70 py-0.5 pl-2.5">
              {/* Custom Viewport Renderers */}
              {node.renderContent ? (
                node.renderContent()
              ) : toolDef?.renderCustomContent ? (
                toolDef.renderCustomContent({
                  args: node.args,
                  result: node.result,
                  node,
                })
              ) : null}

              {/* Dedicated Terminal Execution Format */}
              {isCommandNode && node.command && (
                <TerminalCommand
                  command={node.command}
                  output={node.output}
                  exitCode={node.exitCode ?? 0}
                  durationMs={node.durationMs}
                  isRunning={isActive}
                />
              )}

              {/* Real Embedded FileDiff Component */}
              {node.diffRows && (
                <FileDiff
                  file={node.diffFile || (typeof node.secondary === "string" ? node.secondary : "patch.ts")}
                  rows={node.diffRows}
                />
              )}

              {/* Structured Line Details */}
              {!isCommandNode && node.details && node.details.length > 0 && (
                <div className="flex flex-col gap-1">
                  {node.details.map((line, lIdx) => (
                    <span
                      key={lIdx}
                      className={cn(
                        "text-[11.5px] leading-relaxed",
                        line.tone === "add" && "text-emerald-600 dark:text-emerald-400 font-mono",
                        line.tone === "del" && "text-rose-600 dark:text-rose-400 font-mono",
                        line.tone === "ctx" && "text-muted-foreground font-mono",
                        line.tone === "error" && "text-rose-600 dark:text-rose-400 font-medium",
                        (!line.tone || line.tone === "muted") && "text-muted-foreground"
                      )}
                    >
                      {line.text}
                    </span>
                  ))}
                </div>
              )}

              {/* Code Snippet Fallback */}
              {!isCommandNode && !node.diffRows && node.codeSnippet && (
                <div className="rounded-lg border border-border/70 bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground overflow-x-auto">
                  <pre className="whitespace-pre">{node.codeSnippet}</pre>
                </div>
              )}

              {/* Sources */}
              {node.sources && node.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {node.sources.map((src, sIdx) => (
                    <a
                      key={sIdx}
                      href={src.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground hover:border-border hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Globe className="size-2.5 opacity-70" aria-hidden="true" />
                      <span>{src.name}</span>
                      <ExternalLink className="size-2.5 opacity-50" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * THINKING STATE (Unboxed Seamless Trigger)
 * ───────────────────────────────────────────────────────── */
export interface ThinkingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  nodes?: TraceNode[];
  tools?: Record<string, ToolDefinition>;
  autoPlay?: boolean;
  defaultExpanded?: boolean;
  workingLabel?: string;
  onSettled?: () => void;
  working?: boolean;
  elapsedSeconds?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export const ThinkingState = React.forwardRef<HTMLDivElement, ThinkingStateProps>(
  (
    {
      nodes = [],
      tools = DEFAULT_TOOL_REGISTRY,
      autoPlay = true,
      defaultExpanded,
      workingLabel = "Working...",
      onSettled,
      working: workingProp,
      elapsedSeconds: elapsedSecondsProp,
      expanded: expandedProp,
      onExpandedChange,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const totalNodes = nodes.length;
    const [activeIndex, setActiveIndex] = React.useState(autoPlay ? 0 : totalNodes);
    const [isWorking, setIsWorking] = React.useState(autoPlay);
    const [manualExpanded, setManualExpanded] = React.useState<boolean | null>(
      defaultExpanded !== undefined ? defaultExpanded : null
    );

    React.useEffect(() => {
      setManualExpanded(defaultExpanded !== undefined ? defaultExpanded : null);
    }, [defaultExpanded]);

    const startTimeRef = React.useRef<number>(Date.now());
    const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(0);
    const isWorkingRef = React.useRef(isWorking);
    isWorkingRef.current = isWorking;

    const onSettledRef = React.useRef(onSettled);
    onSettledRef.current = onSettled;
    const controlled = workingProp !== undefined;
    const effectiveWorking = workingProp ?? isWorking;
    const effectiveElapsedSeconds = elapsedSecondsProp ?? elapsedSeconds;

    React.useEffect(() => {
      if (!autoPlay) return;
      startTimeRef.current = Date.now();

      const timer = setInterval(() => {
        if (!isWorkingRef.current) {
          clearInterval(timer);
          return;
        }
        const diff = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        setElapsedSeconds(diff);
      }, 250);

      return () => clearInterval(timer);
    }, [autoPlay]);

    const advanceStep = React.useCallback(() => {
      setActiveIndex((prev) => {
        const next = prev + 1;
        if (next >= totalNodes) {
          setIsWorking(false);
          const finalDuration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          setElapsedSeconds(finalDuration);
        }
        return next;
      });
    }, [totalNodes]);

    React.useEffect(() => {
      if (!autoPlay || !isWorking || activeIndex >= totalNodes) return;

      const currentNode = nodes[activeIndex];
      if (currentNode?.type === "reasoning") return;

      const delay =
        currentNode?.type === "tool" || currentNode?.type === "terminal"
          ? 2200
          : currentNode?.type === "search"
          ? 2400
          : 1700;

      const timer = setTimeout(() => {
        advanceStep();
      }, delay);

      return () => clearTimeout(timer);
    }, [activeIndex, autoPlay, isWorking, totalNodes, nodes, advanceStep]);

    React.useEffect(() => {
      if (!isWorking && autoPlay) {
        onSettledRef.current?.();
      }
    }, [isWorking, autoPlay]);

    const isGlobalExpanded = expandedProp ?? (manualExpanded !== null ? manualExpanded : effectiveWorking);
    const visibleNodes = controlled ? nodes : nodes.slice(0, activeIndex + 1);

    return (
      <div
        ref={ref}
        className={cn("flex w-full flex-col font-sans select-none text-foreground", className)}
        style={style}
        {...props}
      >
        {/* Master Header Trigger (Seamless unboxed prose integration) */}
        <button
          type="button"
          aria-expanded={isGlobalExpanded}
          onClick={() => {
            const next = !isGlobalExpanded;
            onExpandedChange?.(next);
            if (expandedProp === undefined) setManualExpanded(next);
          }}
          className={cn(
            "group flex w-fit items-center gap-1.5 p-0 bg-transparent text-left transition-colors duration-150 cursor-pointer",
            "text-muted-foreground/75 hover:text-foreground font-normal text-[13.5px] leading-relaxed",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-xs"
          )}
        >
          {effectiveWorking && <PixelDotsLoader />}

          <span className="text-[13.5px] font-normal transition-colors">
            {effectiveWorking ? (
              <span
                className="bg-clip-text text-transparent font-medium"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, var(--color-muted-foreground, oklch(0.55 0 0)) 35%, var(--color-foreground, oklch(0.95 0 0)) 50%, var(--color-muted-foreground, oklch(0.55 0 0)) 65%)",
                  backgroundSize: "200% 100%",
                  animation: "agent-shimmer 1.5s linear infinite",
                }}
              >
                {workingLabel}
              </span>
            ) : (
              <span>
                Worked for <span className="tabular-nums font-mono text-[12px]">{effectiveElapsedSeconds}</span> {effectiveElapsedSeconds === 1 ? "second" : "seconds"}
              </span>
            )}
          </span>

          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-3 opacity-30 transition-transform duration-300 group-hover:opacity-80",
              isGlobalExpanded ? "rotate-180" : "rotate-0"
            )}
          />
        </button>

        {/* Master Collapsible Timeline Channel */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
            isGlobalExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0 pointer-events-none"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-1 ml-2 border-l border-border/60 py-0.5 pl-2 flex flex-col gap-0.5">
              {visibleNodes.map((node, idx) => {
                const isNodeActive = controlled
                  ? effectiveWorking && (node.status === "running" || (!nodes.some((item) => item.status === "running") && idx === visibleNodes.length - 1))
                  : idx === activeIndex && isWorking;
                const isNodeFinished = controlled ? !isNodeActive : idx < activeIndex || !isWorking;

                if (node.type === "reasoning" && node.sentences) {
                  return (
                    <NestedReasoningBlock
                      key={node.id ?? idx}
                      id={node.id}
                      sentences={node.sentences}
                      durationSeconds={node.durationSeconds}
                      isActive={isNodeActive}
                      isFinished={isNodeFinished}
                      onFinished={advanceStep}
                      controlled={controlled}
                    />
                  );
                }

                return (
                  <TracePillRow
                    key={node.id ?? idx}
                    node={node}
                    isActive={isNodeActive}
                    isFinished={isNodeFinished}
                    toolRegistry={tools}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
ThinkingState.displayName = "ThinkingState";

/* ─────────────────────────────────────────────────────────
 * MULTI-PHASE AGENT WORKFLOW ORCHESTRATOR
 * ───────────────────────────────────────────────────────── */
export interface AgentWorkflowProps extends React.HTMLAttributes<HTMLDivElement> {
  phases: AgentPhase[];
  tools?: Record<string, ToolDefinition>;
  workingLabel?: string;
  onComplete?: () => void;
  active?: boolean;
  elapsedSeconds?: number;
  defaultExpanded?: boolean;
  renderMessage?: (message: string, phaseIndex: number, streaming: boolean) => React.ReactNode;
}

export function AgentWorkflow({
  phases = [],
  tools,
  workingLabel = "Working...",
  onComplete,
  active,
  elapsedSeconds,
  defaultExpanded,
  renderMessage,
  className,
  ...props
}: AgentWorkflowProps) {
  const [currentPhaseIdx, setCurrentPhaseIdx] = React.useState(0);
  const [phaseStatus, setPhaseStatus] = React.useState<"trace" | "message">("trace");
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;
  const controlled = active !== undefined;
  const visiblePhaseIndex = controlled ? Math.max(0, phases.length - 1) : currentPhaseIdx;

  const handleTraceSettled = React.useCallback((idx: number) => {
    if (idx === currentPhaseIdx) {
      if (phases[idx]?.message) {
        setPhaseStatus("message");
      } else if (idx < phases.length - 1) {
        setCurrentPhaseIdx((prev) => prev + 1);
        setPhaseStatus("trace");
      } else {
        onCompleteRef.current?.();
      }
    }
  }, [currentPhaseIdx, phases]);

  const handleMessageCompleted = React.useCallback((idx: number) => {
    if (idx === currentPhaseIdx) {
      if (idx < phases.length - 1) {
        setCurrentPhaseIdx((prev) => prev + 1);
        setPhaseStatus("trace");
      } else {
        onCompleteRef.current?.();
      }
    }
  }, [currentPhaseIdx, phases]);

  return (
    <div className={cn("flex flex-col gap-4 w-full", className)} {...props}>
      {phases.map((phase, idx) => {
        if (idx > visiblePhaseIndex) return null;

        const isCurrentPhase = idx === visiblePhaseIndex;
        const shouldShowTrace = true;
        const shouldPlayTrace = isCurrentPhase && phaseStatus === "trace";
        const isTraceFinished = !isCurrentPhase || phaseStatus === "message";

        const shouldShowMessage = isTraceFinished && !!phase.message;
        const shouldStreamMessage = isCurrentPhase && phaseStatus === "message";

        return (
          <div key={idx} className="flex flex-col gap-1">
            {shouldShowTrace && phase.trace.length > 0 && (
              <ThinkingState
                nodes={phase.trace}
                tools={tools}
                autoPlay={controlled ? false : shouldPlayTrace}
                working={controlled ? Boolean(active && isCurrentPhase) : undefined}
                elapsedSeconds={controlled ? elapsedSeconds : undefined}
                defaultExpanded={controlled ? Boolean(active && isCurrentPhase) : defaultExpanded}
                workingLabel={workingLabel}
                onSettled={() => handleTraceSettled(idx)}
              />
            )}

            {(controlled ? Boolean(phase.message) : shouldShowMessage) && phase.message && (
              <div className="pt-0 animate-[agent-fade_300ms_ease-out_both]">
                {renderMessage ? (
                  renderMessage(phase.message, idx, Boolean(controlled ? active && isCurrentPhase : shouldStreamMessage))
                ) : shouldStreamMessage ? (
                  <StreamingText
                    text={phase.message}
                    speed={18}
                    chunkSize={2}
                    onComplete={() => handleMessageCompleted(idx)}
                  />
                ) : (
                  <div className="font-sans text-[14.5px] leading-relaxed text-foreground/90 select-text whitespace-pre-line text-pretty">
                    {phase.message}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
