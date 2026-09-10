/**
 * Source: https://www.beautifului.dev/r/approval-card.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: controlled Ask / HITL card — no ice-cream demo questions.
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "../atoms/Button";
import GlideMenu from "./GlideMenu";
import { cn } from "../../lib/utils";

export type ApprovalOption = {
  label: string;
  description?: string;
  recommended?: boolean;
};

export type ApprovalQuestion = {
  id?: string;
  q: string;
  header?: string;
  type?: "radio" | "check";
  options: Array<string | ApprovalOption>;
};

export type ApprovalLabels = {
  skip: string;
  continue: string;
  send: string;
  customPlaceholder: string;
  sentMessage: string;
  recommended?: string;
  dismiss?: string;
  openApproval?: string;
  startOver?: string;
  customAnswer?: string;
  previousQuestion?: string;
  nextQuestion?: string;
};

const DEFAULT_LABELS: ApprovalLabels = {
  skip: "Skip",
  continue: "Continue",
  send: "Send",
  customPlaceholder: "Something else…",
  sentMessage: "Answers sent",
  recommended: "Recommended",
  dismiss: "Dismiss",
  openApproval: "Open approval",
  startOver: "Start over",
  customAnswer: "Custom answer",
  previousQuestion: "Previous question",
  nextQuestion: "Next question",
};

const ROLL_MS = 400;
const SLIDE = "360ms cubic-bezier(0.22, 1, 0.36, 1)";

function normalizeOption(option: string | ApprovalOption): ApprovalOption {
  return typeof option === "string" ? { label: option } : option;
}

function RollingDigits({ value }: { value: string }) {
  const prevRef = useRef(value);
  const [oldVal, setOldVal] = useState(value);
  const [newVal, setNewVal] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [dir, setDir] = useState<"up" | "down">("up");

  useEffect(() => {
    if (prevRef.current === value) return;
    const from = prevRef.current;
    prevRef.current = value;
    const fromN = parseInt(from, 10);
    const toN = parseInt(value, 10);
    setDir(Number.isFinite(fromN) && Number.isFinite(toN) && toN < fromN ? "down" : "up");
    setOldVal(from);
    setNewVal(value);
    setRolling(true);
    setShifted(false);

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShifted(true));
    });
    const done = setTimeout(() => {
      setRolling(false);
      setOldVal(value);
      setShifted(false);
    }, ROLL_MS);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(done);
    };
  }, [value]);

  const chars = rolling ? newVal : oldVal;

  return (
    <>
      {Array.from({ length: chars.length }, (_, i) => {
        const o = oldVal[i] ?? "";
        const n = chars[i] ?? "";
        if (!rolling || o === n) {
          return <span key={`${i}-${n}`}>{n}</span>;
        }
        const top = dir === "down" ? n : o;
        const bottom = dir === "down" ? o : n;
        const restY = dir === "down" ? "0" : "-1em";
        const startY = dir === "down" ? "-1em" : "0";
        return (
          <span
            key={`${i}-${o}-${n}-${dir}`}
            style={{ display: "inline-block", position: "relative", overflow: "hidden", height: "1em", lineHeight: "1em", verticalAlign: "-0.05em" }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
                transform: `translateY(${shifted ? restY : startY})`,
              }}
            >
              <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
              <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

function Ico({ path, size = 14, sw = 2 }: { path: React.ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}

export type ApprovalSubmittedAnswer = {
  questionIndex: number;
  questionId?: string;
  selectedIndexes: number[];
  selectedLabels: string[];
  custom?: string;
  value: string;
};

export type ApprovalCardProps = {
  questions?: ApprovalQuestion[];
  labels?: Partial<ApprovalLabels>;
  onSubmitted?: (answers: ApprovalSubmittedAnswer[]) => void | boolean | Promise<void | boolean>;
  onCancel?: () => void | boolean | Promise<void | boolean>;
  onAnswerChange?: (questionIndex: number, answer: number[]) => void;
  resettable?: boolean;
  variant?: string;
  className?: string;
  title?: ReactNode;
  requestId?: string;
  busy?: boolean;
  error?: string;
  autoAdvanceRadio?: boolean;
};

export default function ApprovalCard({
  questions = [],
  labels,
  onSubmitted,
  onCancel,
  onAnswerChange,
  resettable = false,
  className,
  title,
  requestId,
  busy = false,
  error,
  autoAdvanceRadio = false,
}: ApprovalCardProps) {
  const t = { ...DEFAULT_LABELS, ...labels };
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(true);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const measured = useRef(false);
  const [viewportH, setViewportH] = useState<number | undefined>(undefined);
  const [trackY, setTrackY] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setQi(0);
    setAnswers({});
    setCustom({});
    setSent(false);
    setOpen(true);
    measured.current = false;
  }, [requestId, questions.length]);

  const last = qi === questions.length - 1;
  const selected = answers[qi] ?? [];
  const hasAnswer = selected.length > 0 || Boolean(custom[qi]?.trim());

  const sync = (withAnim: boolean) => {
    const item = questionRefs.current[qi];
    if (!item) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setViewportH(item.offsetHeight);
    setTrackY(item.offsetTop);
    setAnimate(withAnim && !reduce);
  };

  useLayoutEffect(() => {
    const withAnim = measured.current;
    measured.current = true;
    sync(withAnim);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi, answers, custom, open, sent, busy, error]);

  useEffect(() => {
    const id = requestAnimationFrame(() => sync(measured.current));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi]);

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const goTo = (next: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setQi(Math.min(Math.max(next, 0), Math.max(0, questions.length - 1)));
  };

  const buildPayload = (): ApprovalSubmittedAnswer[] =>
    questions.map((question, index) => {
      const indexes = answers[index] ?? [];
      const opts = (question.options ?? []).map(normalizeOption);
      const selectedLabels = indexes.map((i) => opts[i]?.label).filter(Boolean) as string[];
      const customText = custom[index]?.trim() ?? "";
      const value = customText || selectedLabels[0] || "";
      return {
        questionIndex: index,
        questionId: question.id,
        selectedIndexes: indexes,
        selectedLabels,
        custom: customText || undefined,
        value,
      };
    });

  const send = async () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const result = await onSubmitted?.(buildPayload());
    if (result === false) return;
    setSent(true);
  };

  const advance = () => {
    if (last) void send();
    else goTo(qi + 1);
  };

  const toggle = (index: number) => {
    const type = questions[qi]?.type ?? "radio";
    setAnswers((current) => {
      const picked = current[qi] ?? [];
      const next = type === "radio"
        ? [index]
        : picked.includes(index)
          ? picked.filter((item) => item !== index)
          : [...picked, index];
      onAnswerChange?.(qi, next);
      return { ...current, [qi]: next };
    });
    if (type === "radio") {
      setCustom((current) => ({ ...current, [qi]: "" }));
      if (autoAdvanceRadio) {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(() => {
          if (last) void send();
          else setQi((current) => Math.min(questions.length - 1, current + 1));
        }, 480);
      }
    }
  };

  const reset = () => {
    setQi(0);
    setAnswers({});
    setCustom({});
    setSent(false);
    setOpen(true);
    measured.current = false;
  };

  if (!questions.length) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-control bg-surface px-3 py-2 text-[12.5px] font-medium text-ink shadow-btn transition-colors duration-150 hover:bg-hover">
        {t.openApproval}
      </button>
    );
  }

  if (sent) {
    return (
      <div className={cn("flex w-full max-w-full items-center gap-3", className)} style={{ animation: "pop-in 260ms cubic-bezier(0.23,1,0.32,1) both" }}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-tint py-1 pr-2.5 pl-1 text-[12.5px] font-medium text-green">
          <span className="flex size-4.5 items-center justify-center rounded-full bg-green text-white">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
          </span>
          {t.sentMessage}
        </span>
        {resettable && (
          <button type="button" onClick={reset} className="text-[12px] font-medium text-ink-3 transition-colors duration-150 hover:text-ink">
            {t.startOver}
          </button>
        )}
      </div>
    );
  }

  const activeQuestion = questions[qi];
  const questionId = activeQuestion?.id;

  return (
    <div
      className={cn("w-full max-w-full", className)}
      data-user-input-request-id={requestId}
      data-question-id={questionId}
    >
      <div className="relative overflow-hidden rounded-card bg-surface shadow-card" style={{ animation: "fade-up 380ms cubic-bezier(0.23,1,0.32,1) both" }}>
        <button
          type="button"
          aria-label={t.dismiss}
          disabled={busy}
          onClick={() => {
            if (onCancel) void onCancel();
            else setOpen(false);
          }}
          className="primitive-icon-button absolute right-2.5 top-2.5 z-10 text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-50"
        >
          <Ico size={14} sw={2.2} path={<path d="M18 6L6 18M6 6l12 12" />} />
        </button>
        <div className="primitive-card-pad">
          {title && <div className="mb-2 pr-7 text-[12.5px] font-semibold text-ink-2">{title}</div>}
          {activeQuestion?.header && (
            <p className="mb-1 pr-7 text-[11.5px] font-medium text-ink-3">{activeQuestion.header}</p>
          )}
          <div
            className="overflow-hidden"
            style={{ height: viewportH, transition: animate ? `height ${SLIDE}` : undefined }}
            aria-live="polite"
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 26,
                transform: `translate3d(0, ${-trackY}px, 0)`,
                transition: animate ? `transform ${SLIDE}` : undefined,
                willChange: "transform",
              }}
            >
              {questions.map((question, qIdx) => {
                const active = qIdx === qi;
                if (!ready && !active) return null;
                const picked = answers[qIdx] ?? [];
                const opts = (question.options ?? []).map(normalizeOption);
                const type = question.type ?? "radio";
                const questionStyle: CSSProperties = {
                  opacity: active ? 1 : 0,
                  transition: animate ? `opacity ${SLIDE}` : undefined,
                  pointerEvents: active ? undefined : "none",
                };
                return (
                  <div
                    key={question.id ?? qIdx}
                    ref={(el) => { questionRefs.current[qIdx] = el; }}
                    aria-hidden={active ? undefined : true}
                    style={questionStyle}
                  >
                    <div className="pr-7 text-[14px] font-medium text-ink">{question.q}</div>
                    <div data-user-input-options="">
                    <GlideMenu className="mt-2.5 flex flex-col gap-1" highlightClassName="inset-x-0 rounded-control bg-hover">
                      {opts.map((option, i) => {
                        const on = picked.includes(i);
                        return (
                          <button
                            key={option.label}
                            type="button"
                            data-menu-row
                            aria-pressed={on}
                            tabIndex={active ? 0 : -1}
                            disabled={busy}
                            onClick={() => { if (active) toggle(i); }}
                            className="relative z-10 flex items-start gap-1.5 rounded-control pl-1 pr-2 py-1.5 text-left transition-colors duration-100"
                          >
                            <span
                              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center transition-colors duration-200
                                ${type === "radio" ? "rounded-full" : "rounded-[5px]"}
                                ${on ? "bg-ink text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)] text-transparent"}`}
                            >
                              {type === "radio" ? (
                                <span className="size-1.5 rounded-full bg-canvas transition-transform duration-200" style={{ transform: on ? "scale(1)" : "scale(0)" }} />
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`flex flex-wrap items-center gap-1.5 text-[13px] leading-none transition-colors duration-200 ${on ? "text-ink" : "text-ink-2"}`}>
                                {option.label}
                                {option.recommended && (
                                  <span className="rounded-full bg-green-tint px-1.5 py-0.5 text-[9.5px] font-semibold text-green">
                                    {t.recommended}
                                  </span>
                                )}
                              </span>
                              {option.description && (
                                <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-3">{option.description}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                      <label data-menu-row className="relative z-10 flex items-center gap-1.5 rounded-control pl-1 pr-2 py-1 transition-colors duration-100">
                        <input
                          value={custom[qIdx] ?? ""}
                          tabIndex={active ? 0 : -1}
                          disabled={busy}
                          onChange={(event) => {
                            if (!active) return;
                            setCustom((current) => ({ ...current, [qIdx]: event.target.value }));
                            if (type === "radio") setAnswers((current) => ({ ...current, [qIdx]: [] }));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.nativeEvent.isComposing && hasAnswer) {
                              event.preventDefault();
                              advance();
                            }
                          }}
                          placeholder={t.customPlaceholder}
                          aria-label={t.customAnswer}
                          className="min-w-0 flex-1 bg-transparent pl-1.5 text-[13px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
                        />
                      </label>
                    </GlideMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {error && (
            <p className="mt-2 text-[11.5px] font-medium text-red" role="alert">{error}</p>
          )}
        </div>

        <div className="primitive-card-footer flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-ink-3" data-user-input-progress="">
            <button
              type="button"
              aria-label={t.previousQuestion}
              disabled={qi <= 0 || busy}
              onClick={() => goTo(qi - 1)}
              className="flex size-[18px] items-center justify-center rounded-[5px] transition-colors duration-100 enabled:hover:text-ink disabled:opacity-30"
            >
              <Ico size={14} path={<path d="M18 15l-6-6-6 6" />} />
            </button>
            <span className="inline-flex items-center text-[12px] font-medium tabular-nums text-ink-3" style={{ letterSpacing: "-0.1px", lineHeight: 1 }}>
              <RollingDigits value={`${qi + 1} / ${questions.length}`} />
            </span>
            <button
              type="button"
              aria-label={t.nextQuestion}
              disabled={last || busy}
              onClick={() => goTo(qi + 1)}
              className="flex size-[18px] items-center justify-center rounded-[5px] transition-colors duration-100 enabled:hover:text-ink disabled:opacity-30"
            >
              <Ico size={14} path={<path d="M6 9l6 6 6-6" />} />
            </button>
          </div>

          <div className="-mr-0.5 flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (onCancel) void onCancel();
                else if (last) setOpen(false);
                else goTo(qi + 1);
              }}
            >
              {t.skip}
            </Button>
            <Button
              variant="accent"
              size="sm"
              disabled={!hasAnswer || busy}
              onClick={advance}
              data-user-input-confirm=""
            >
              {last ? t.send : t.continue}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
