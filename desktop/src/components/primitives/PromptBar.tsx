/**
 * Source: https://www.beautifului.dev/r/prompt-bar.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: Beautiful UI PromptBar wired to backend models, skills, attachments, and streaming.
 */
"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { createShader, playSweep, accentChain, ACCENTS } from "glimm";
import { CollaborationMode, ModelOption } from "../../types";
import { SkillCommand } from "../chat/SkillPicker";
import { MessageAttachment } from "../../types";
import { useI18n } from "../../i18n";

/* The built-in "prism" palette is only cyan→indigo→magenta, so a sweep
 * reads as blue/purple. Build a true full-spectrum rainbow instead. */
const RAINBOW = accentChain([
  ACCENTS.red,
  ACCENTS.orange,
  ACCENTS.yellow,
  ACCENTS.green,
  ACCENTS.cyan,
  ACCENTS.blue,
  ACCENTS.purple,
]);

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR
 * A composer with real controls: attach, @ data sources,
 * / commands, a model picker, dictation, and send.
 * Type @ or / to open the menus; ↑↓ + Enter to pick.
 * Variants: Rounded (card radius) · Pill (full radius).
 * ───────────────────────────────────────────────────────── */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: React.ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const GLYPHS: Record<string, React.ReactNode> = {
  clip: <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  plan: <g><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></g>,
  build: <g><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" /></g>,
};

type Source = {
  key: string;
  name: string;
  desc: string;
  glyph?: string;
  attach?: boolean;
  mode?: CollaborationMode;
};


/* the last @word or /word being typed, if any */
export function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

export type PromptBarProps = {
  variant?: "Rounded" | "Pill" | string;
  tall?: boolean;
  className?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void | boolean | Promise<void | boolean>;
  onSend?: (text: string) => void;
  onStop?: () => void | Promise<void>;
  isStreaming?: boolean;
  canSubmit?: boolean;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  inputProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "disabled" | "placeholder">;
  demo?: boolean;
  models?: ModelOption[];
  activeModel?: ModelOption;
  onSelectModel?: (model: ModelOption) => void | Promise<void>;
  skills?: SkillCommand[];
  onSelectSkill?: (skill: SkillCommand) => void;
  collaborationMode?: CollaborationMode;
  onSelectCollaborationMode?: (mode: CollaborationMode) => boolean | void | Promise<boolean | void>;
  isChangingCollaborationMode?: boolean;
  attachments?: MessageAttachment[];
  onRemoveAttachment?: (id: string) => void;
  onSelectFiles?: () => void;
  dropOverlay?: ReactNode;
  isDraggingFiles?: boolean;
  trailingSlot?: ReactNode;
  leadingSlot?: ReactNode;
  menuSlot?: ReactNode;
  attachmentsSlot?: ReactNode;
  expandSlot?: ReactNode;
  sendLabel?: string;
  stopLabel?: string;
  onFormSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onDragEnter?: (event: DragEvent<HTMLFormElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLFormElement>) => void;
  onDragOver?: (event: DragEvent<HTMLFormElement>) => void;
  onDrop?: (event: DragEvent<HTMLFormElement>) => void;
};

export default function PromptBar({
  variant = "Rounded",
  tall = false,
  className,
  value,
  onChange,
  onSubmit,
  onSend,
  onStop,
  isStreaming = false,
  canSubmit,
  disabled = false,
  busy = false,
  placeholder,
  inputRef,
  inputProps,
  demo = false,
  models,
  activeModel,
  onSelectModel,
  skills,
  onSelectSkill,
  collaborationMode,
  onSelectCollaborationMode,
  isChangingCollaborationMode = false,
  attachments: externalAttachments,
  onRemoveAttachment,
  onSelectFiles,
  dropOverlay,
  isDraggingFiles = false,
  trailingSlot,
  leadingSlot,
  menuSlot,
  attachmentsSlot,
  expandSlot,
  sendLabel = "Send message",
  stopLabel = "Stop",
  onFormSubmit,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: PromptBarProps) {
  const { t } = useI18n();
  const sources: Source[] = [
    { key: "plan", name: t("workflowPlanMode"), desc: t("workflowPlanDescription"), glyph: "plan", mode: "plan" },
    { key: "build", name: t("workflowBuildMode"), desc: t("workflowBuildDescription"), glyph: "build", mode: "build" },
    { key: "attach", name: t("files"), desc: t("reactUiAttachFilesImages"), glyph: "clip", attach: true },
  ];
  const pill = variant === "Pill";
  const [internalDraft, setInternalDraft] = useState("");
  const isControlled = value !== undefined;
  const draft = isControlled ? value : internalDraft;
  const setDraft = (text: string) => {
    if (isControlled) {
      onChange?.(text);
    } else {
      setInternalDraft(text);
    }
  };

  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const wide = expanded || tall;
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [modelBox, setModelBox] = useState<{ top: number; height: number } | null>(null);
  const [modelHovered, setModelHovered] = useState<number | null>(null);
  const [modelMenuLeft, setModelMenuLeft] = useState(0);
  const [modelMenuBottom, setModelMenuBottom] = useState(0);

  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLTextAreaElement>(null);
  const resolvedInputRef = inputRef ?? localInputRef;
  const measureRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const modelRowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const glimmRef = useRef<HTMLCanvasElement>(null);
  const shaderRef = useRef<ReturnType<typeof createShader> | null>(null);
  const sweepingRef = useRef(false);

  // Map Metis models to prompt bar model items
  const resolvedModels = models && models.length > 0
    ? models.map((m) => ({
        key: `${m.provider}:${m.id}`,
        name: m.name || m.id,
        tag: m.provider,
        raw: m,
      }))
    : [];

  const currentModelKey = activeModel
    ? `${activeModel.provider}:${activeModel.id}`
    : resolvedModels[0]?.key;

  const currentModelName = activeModel?.name || activeModel?.id || resolvedModels[0]?.name || "Model";

  const token = dismissed ? null : parseToken(draft);
  const menu: "at" | "slash" | null = plusOpen ? "at" : token?.kind ?? null;
  const query = plusOpen ? "" : token?.query ?? "";

  // Rows for @ and / menus
  const rows: { key: string; name: string; desc: string }[] =
    menu === "at"
      ? sources.filter((s) => `${s.name} ${s.desc}`.toLowerCase().includes(query))
      : menu === "slash"
        ? (skills && skills.length > 0
            ? skills
                .filter((s) => s.name.toLowerCase().includes(query) || (s.description && s.description.toLowerCase().includes(query)))
                .map((s) => ({ key: s.name, name: `/${s.name}`, desc: s.description || "" }))
            : [])
        : [];

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  /* a single highlight glides to the active row instead of each row
   * toggling its own background — matches the gliding pill in the nav */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, rows.length]);

  /* same gliding highlight in the model menu — floats to the hovered
   * row, falling back to the currently-selected model */
  const modelIndex = Math.max(0, resolvedModels.findIndex((m) => m.key === currentModelKey));
  useLayoutEffect(() => {
    if (!modelOpen) return;
    const target = modelRowRefs.current[modelHovered ?? modelIndex];
    if (target) setModelBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [modelOpen, modelHovered, modelIndex, resolvedModels.length]);

  /* The menu is outside the clipped composer, so align it to the model
   * trigger by measurement instead of pinning it to the far-right edge. */
  useLayoutEffect(() => {
    if (!modelOpen || !composerAnchorRef.current || !modelRef.current) return;
    const anchorRect = composerAnchorRef.current.getBoundingClientRect();
    const triggerRect = modelRef.current.getBoundingClientRect();
    setModelMenuLeft(Math.max(0, Math.min(triggerRect.left - anchorRect.left, anchorRect.width - 180)));
    setModelMenuBottom(anchorRect.bottom - triggerRect.top + 8);
  }, [modelOpen, wide, currentModelName]);

  useEffect(() => {
    if (!modelOpen) setModelHovered(null);
  }, [modelOpen]);

  /* Build the shader with a pinned hue phase. */
  const makeShader = () => {
    const canvas = glimmRef.current;
    if (!canvas) return null;
    const random = Math.random;
    Math.random = () => 0;
    try {
      return createShader({
        canvas,
        palette: RAINBOW,
        direction: "ltr",
        bandTight: 10,
        swellAmount: 0.85,
      });
    } finally {
      Math.random = random;
    }
  };

  /* Glimm shader lives inside the composer, invisible at rest. Selecting
   * a flagship model fires a one-shot rainbow sweep across the interior. */
  useEffect(() => {
    shaderRef.current = makeShader();
    return () => {
      shaderRef.current?.destroy();
      shaderRef.current = null;
    };
  }, []);

  const celebrate = () => {
    if (sweepingRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    shaderRef.current?.destroy();
    const shader = makeShader();
    shaderRef.current = shader;
    if (!shader) return;
    sweepingRef.current = true;
    const sweep = playSweep(shader, {
      palette: RAINBOW,
      direction: "ltr",
      sweepMs: 570,
      outroMs: 80,
      peakAlpha: 1.3,
      bandTight: 10,
      brightness: 1.4,
      swellAmount: 1,
      waveSpeed: 1.8,
      easing: "easeOutExpo",
    });
    sweep.done.finally(() => {
      sweepingRef.current = false;
    });
  };

  const selectModel = (next: (typeof resolvedModels)[number]) => {
    if ("raw" in next && next.raw) {
      void onSelectModel?.(next.raw);
    }
    setModelOpen(false);
    celebrate();
  };

  /* dictation resolves after a beat, or streams from Web Speech API */
  useEffect(() => {
    if (!listening) return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = (event: any) => {
          const transcript = event.results[0]?.[0]?.transcript;
          if (transcript) {
            setDraft(draft ? `${draft.trimEnd()} ${transcript}` : transcript);
          }
          setListening(false);
        };
        recognition.onerror = () => setListening(false);
        recognition.onend = () => setListening(false);
        recognition.start();
        return () => {
          try {
            recognition.abort();
          } catch {}
        };
      } catch {
        setListening(false);
      }
    } else setListening(false);
  }, [listening, draft]);

  /* Move wrapped text above the controls, then grow to a compact maximum.
   * `tall` reuses the same wide PromptBar chrome (screenshot 2-row layout);
   * it only forces that layout + a ~2-line textarea floor — no separate composer. */
  useLayoutEffect(() => {
    const input = resolvedInputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    const modelButton = modelRef.current;
    if (!input || !controls || !measure || controls.clientWidth <= 0) return;

    const fixedControlsWidth = 28 * 3 + (trailingRef.current?.offsetWidth || modelButton?.offsetWidth || 80);
    const inlineGaps = 4 * 4;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = tall || draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (!tall && needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }
    if (tall && !expanded) {
      setExpanded(true);
    }

    // ~2 lines at 14px / 1.8 leading when tall; otherwise single-line floor
    const minHeight = tall ? 50 : 28;
    const maxHeight = 100;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, expanded, resolvedInputRef, tall]);

  /* clicking anywhere outside the composer closes the open menus */
  useEffect(() => {
    if (!modelOpen && !plusOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) {
        setModelOpen(false);
        setPlusOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelOpen, plusOpen]);

  const closeMenus = () => {
    setPlusOpen(false);
    setModelOpen(false);
  };

  const pick = (row: { key: string; name: string; desc: string }) => {
    const source = sources.find((s) => s.key === row.key);
    if (source?.mode) {
      void onSelectCollaborationMode?.(source.mode);
      if (token) setDraft(draft.slice(0, token.start));
    } else if (source?.attach) {
      if (onSelectFiles) {
        onSelectFiles();
      }
      if (token) setDraft(draft.slice(0, token.start));
    } else if (menu === "at") {
      setDraft(`${token ? draft.slice(0, token.start) : draft}@${row.name} `);
    } else {
      if (skills && onSelectSkill) {
        const found = skills.find((s) => s.name === row.key);
        if (found) onSelectSkill(found);
      }
      setDraft(`${token ? draft.slice(0, token.start) : draft}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    resolvedInputRef.current?.focus();
  };

  const hasExternalAttachments = Boolean(externalAttachments && externalAttachments.length > 0);
  const resolvedAttachmentCount = hasExternalAttachments ? externalAttachments!.length : 0;
  const allowSubmit = canSubmit ?? (draft.trim().length > 0 || resolvedAttachmentCount > 0);

  const submit = () => {
    if (disabled || busy || !allowSubmit) return;
    if (onSubmit) {
      void onSubmit();
    } else {
      onSend?.(draft.trim());
      setDraft("");
    }
    closeMenus();
  };

  return (
    <div
      data-promptbar
      data-prompt-bar=""
      className={className ?? "relative w-full"}
    >
      {/* composer is the anchor — menus grow up from its top edge */}
      <div ref={composerAnchorRef} className="relative">
        {menuSlot}

        {/* ── @ / slash menu ─────────────────────────────── */}
        {menu && !menuSlot && (
          <div
            onMouseLeave={() => setEngaged(false)}
            className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
            data-skill-picker={menu === "slash" ? "" : undefined}
            data-plus-menu={menu === "at" ? "" : undefined}
            role="listbox"
            aria-label={menu === "slash" ? t("searchCommandsHint") : `${t("workflowPlanMode")}, ${t("workflowBuildMode")}, ${t("files")}`}
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
          >
            {/* single gliding highlight — appears once a row is hovered */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
                transition:
                  "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {rows.map((row, i) => {
              const source = menu === "at" ? sources.find((s) => s.key === row.key) : undefined;
              return (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-skill-option={menu === "slash" ? row.key : undefined}
                  data-composer-action={menu === "at" ? row.key : undefined}
                  disabled={Boolean(source?.mode && isChangingCollaborationMode)}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    setActive(i);
                    setEngaged(true);
                  }}
                  onClick={() => pick(row)}
                  className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
                >
                  {source && (
                    <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2">
                      <Icon size={15}>{GLYPHS[source.glyph ?? "clip"]}</Icon>
                    </span>
                  )}
                  <span className="shrink-0 text-[12px] font-medium text-ink">
                    {row.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
                  {source?.mode === collaborationMode && (
                    <span className="ml-auto shrink-0 text-ink">
                      <Icon size={13} strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></Icon>
                    </span>
                  )}
                </button>
              );
            })}
            {rows.length === 0 && (
              <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">
                {t("noMatchesFor", { query })}
              </div>
            )}
            <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
              {menu === "at" ? `${t("workflowPlanMode")} · ${t("workflowBuildMode")} · ${t("files")}` : t("searchCommandsHint")}
            </div>
          </div>
        )}

        {/* ── model menu ─────────────────────────────────── */}
        {modelOpen && (
          <div
            onMouseLeave={() => setModelHovered(null)}
            className="absolute z-20 w-44 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ left: modelMenuLeft, bottom: modelMenuBottom, animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom left" }}
          >
            {/* single gliding highlight — floats to the hovered / selected row */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: modelBox?.top ?? 0,
                height: modelBox?.height ?? 0,
                opacity: modelBox && modelHovered !== null ? 1 : 0,
                transition:
                  "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {resolvedModels.map((m, i) => (
              <button
                key={m.key}
                type="button"
                ref={(el) => {
                  modelRowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setModelHovered(i)}
                onClick={() => {
                  selectModel(m);
                  resolvedInputRef.current?.focus();
                }}
                className="relative z-10 flex h-7.5 w-full items-center gap-2 rounded-[6px] px-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{m.name}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{m.tag}</span>
                <span className={`shrink-0 text-ink ${m.key === currentModelKey ? "" : "invisible"}`}>
                  <Icon size={13} strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></Icon>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── composer ───────────────────────────────────── */}
        <form
          data-composer=""
          data-composer-multiline="true"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (onFormSubmit) onFormSubmit(event);
            else submit();
          }}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`relative isolate flex flex-col overflow-hidden border border-line bg-surface shadow-card transition-[border-color,border-radius] duration-150 focus-within:border-line-strong gap-1.5 p-1.5 ${
            pill ? (resolvedAttachmentCount > 0 || wide ? "rounded-[24px]" : "rounded-full") : "rounded-[14px]"
          } ${isDraggingFiles ? "border-line-strong" : ""}`}
        >
          {/* rainbow glimm sweep — plays across the interior on model change */}
          <canvas
            ref={glimmRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
            style={{ borderRadius: "inherit" }}
          />
          {dropOverlay}
          {expandSlot}

          <span
            ref={measureRef}
            aria-hidden="true"
            className={`pointer-events-none absolute invisible whitespace-pre text-[14px] font-normal ${
              wide || tall ? "leading-[1.8]" : "leading-7"
            }`}
          >
            {draft}
          </span>

          {/* Attachments */}
          {attachmentsSlot}
          {!attachmentsSlot && hasExternalAttachments && (
            <div className={`flex flex-wrap gap-1.5 pt-0.5 ${pill ? "px-1" : "px-0.5"}`} data-composer-attachments="" aria-label="Attachments">
              {externalAttachments!.map((att) => (
                <span
                  key={att.id}
                  data-attachment-preview={att.kind}
                  className={`flex h-6.5 items-center gap-1.5 bg-field py-1 pr-1 pl-1.5 text-[11.5px] text-ink-2 shadow-hairline ${
                    pill ? "rounded-full" : "rounded-chip"
                  }`}
                  style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}
                >
                  <Icon size={12}><g><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g></Icon>
                  <span className="max-w-36 truncate">{att.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${att.name}`}
                    onClick={() => onRemoveAttachment?.(att.id)}
                    className={`-my-1 flex size-6 items-center justify-center text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink ${
                      pill ? "rounded-full" : "rounded-[5px]"
                    }`}
                  >
                    <Icon size={10} strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12" /></Icon>
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            ref={controlsRef}
            className={`grid gap-x-1 gap-y-1.5 ${wide ? "items-end" : "items-center"} ${
              wide
                ? "grid-cols-[28px_auto_minmax(0,1fr)_28px_28px]"
                : "grid-cols-[28px_minmax(0,1fr)_auto_28px_28px]"
            }`}
          >
            {leadingSlot ? (
              <div className={`flex ${wide ? "items-end col-start-1 row-start-2" : "items-center col-start-1 row-start-1"}`}>
                {leadingSlot}
              </div>
            ) : (
              <button
                type="button"
                data-plus-button=""
                aria-label={t("addAttachmentsAndSources")}
                aria-expanded={plusOpen}
                disabled={disabled || busy}
                onClick={() => {
                  setModelOpen(false);
                  setPlusOpen((current) => !current);
                  resolvedInputRef.current?.focus();
                }}
                className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${
                  pill ? "rounded-full" : "rounded-[8px]"
                } ${plusOpen ? "bg-hover text-ink" : ""} ${wide ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
              >
                <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
              </button>
            )}

            <textarea
              {...inputProps}
              ref={resolvedInputRef}
              rows={1}
              value={draft}
              disabled={disabled}
              data-composer-input=""
              onChange={(event) => {
                setDraft(event.target.value);
                setDismissed(false);
                setPlusOpen(false);
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                inputProps?.onKeyDown?.(event);
                if (event.defaultPrevented) return;
                if (menu && rows.length > 0) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setEngaged(true);
                    setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                    return;
                  }
                  if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                    event.preventDefault();
                    pick(rows[active]);
                    return;
                  }
                }
                if (event.key === "Escape") {
                  setDismissed(true);
                  closeMenus();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={listening ? t("listeningPrompt") : (placeholder ?? t("writeMessagePlaceholder"))}
              aria-label={inputProps?.["aria-label"] ?? t("promptAria")}
              className={`${
                wide
                  ? `${tall ? "min-h-[50px]" : "min-h-7"} px-1 py-0 text-[14px] font-normal leading-[1.8]`
                  : "h-7 min-h-7 px-1 py-0 text-[14px] font-normal leading-7"
              } min-w-0 w-full resize-none bg-transparent text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 disabled:cursor-not-allowed ${
                wide ? "col-span-full col-start-1 row-start-1" : "col-start-2 row-start-1"
              } ${inputProps?.className ?? ""}`}
            />

            {/* model picker / trailing controls */}
            <div ref={trailingRef} className={`flex items-center gap-1 ${wide ? "col-start-3 row-start-2 justify-self-end" : "col-start-3 row-start-1"}`}>
              {trailingSlot}
              {!trailingSlot && (
                <button
                  ref={modelRef}
                  type="button"
                  aria-expanded={modelOpen}
                  aria-label={t("reactSettingsChooseModel")}
                  disabled={disabled}
                  onClick={() => {
                    setPlusOpen(false);
                    setModelOpen((current) => !current);
                  }}
                  className={`flex h-7 shrink-0 items-center gap-1 px-1.5 text-[13px] font-medium leading-7 text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink ${
                    pill ? "rounded-full" : "rounded-[8px]"
                  }`}
                >
                  {currentModelName}
                  <span className="text-ink-3">
                    <Icon size={11} strokeWidth={2.4}><path d="M6 9l6 6 6-6" /></Icon>
                  </span>
                </button>
              )}
            </div>

            {/* dictation */}
            <button
              type="button"
              aria-label={listening ? t("stopDictation") : t("startDictation")}
              aria-pressed={listening}
              disabled={disabled}
              onClick={() => setListening((current) => !current)}
              className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-150 active:scale-[0.94] ${
                pill ? "rounded-full" : "rounded-[8px]"
              } ${listening ? "bg-accent-tint text-accent-ink" : "text-ink-3 hover:bg-hover hover:text-ink"} ${wide ? "col-start-4 row-start-2" : "col-start-4 row-start-1"}`}
            >
              {listening ? (
                <span className="flex h-3.5 items-center gap-[2.5px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-[2.5px] rounded-full bg-current"
                      style={{ height: "100%", animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite` }}
                    />
                  ))}
                </span>
              ) : (
                <Icon size={15} strokeWidth={2}><g><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></g></Icon>
              )}
            </button>

            {/* send or stop button */}
            {isStreaming ? (
              <button
                type="button"
                aria-label={stopLabel}
                title={stopLabel}
                data-stop-button=""
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onStop?.();
                }}
                className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 active:scale-[0.94] ${
                  pill ? "rounded-full" : "rounded-[8px]"
                } ${wide ? "col-start-5 row-start-2" : "col-start-5 row-start-1"}`}
                style={{ background: "var(--ink)", color: "var(--surface)" }}
              >
                <Icon size={12} strokeWidth={0}>
                  <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
                </Icon>
              </button>
            ) : (
              <button
                type="submit"
                aria-label={sendLabel}
                title={sendLabel}
                disabled={disabled || busy || !allowSubmit}
                className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] disabled:opacity-35 ${
                  pill ? "rounded-full" : "rounded-[8px]"
                } ${wide ? "col-start-5 row-start-2" : "col-start-5 row-start-1"}`}
                style={{
                  background: allowSubmit && !disabled && !busy ? "var(--ink)" : "var(--line-strong)",
                  color: allowSubmit && !disabled && !busy ? "var(--surface)" : "var(--ink-2)",
                }}
              >
                <Icon size={16} strokeWidth={2.4}>
                  <path d="M12 19V5M5 12l7-7 7 7" data-send-icon="" />
                </Icon>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
