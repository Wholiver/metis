/**
 * Derived from Beautiful UI Approval Card.
 * Source: https://www.beautifului.dev/r/approval-card.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button';

type ApprovalDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  inputLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

export default function ApprovalDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  inputLabel,
  danger = false,
  onCancel,
  onConfirm,
}: ApprovalDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;
  const canConfirm = !inputLabel || Boolean(value.trim());

  return (
    <div
      className="fixed inset-0 z-[140] grid place-items-center bg-ink/30 p-5 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <section
        className="w-full max-w-[420px] overflow-hidden rounded-window bg-surface shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-dialog-title"
        data-approval-dialog=""
      >
        <div className="primitive-card-pad">
          <div className="mb-3 flex items-center gap-2" aria-hidden="true">
            <span aria-hidden className={`size-1.5 rounded-full ${danger ? 'bg-red' : 'bg-accent'}`} />
          </div>
          <h2 id="approval-dialog-title" className="text-[16px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{message}</p>
          {inputLabel && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">{inputLabel}</span>
              <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && canConfirm) onConfirm(value.trim()); }}
                className="h-9 w-full rounded-control border border-line-strong bg-field px-3 text-[13px] text-ink shadow-inset-field outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--focus)]"
              />
            </label>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-3 py-2.5">
          <Button size="sm" variant="quiet" onClick={onCancel}>{cancelLabel}</Button>
          <Button size="sm" variant={danger ? 'danger' : 'accent'} disabled={!canConfirm} onClick={() => onConfirm(value.trim())}>{confirmLabel}</Button>
        </footer>
      </section>
    </div>
  );
}
