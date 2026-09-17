/**
 * Desktop confirmation dialog — matches Settings / Add Model surface language.
 */
import { useEffect, useId, useRef, useState } from 'react';
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
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    setValue('');
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
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
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="w-full max-w-[400px] overflow-hidden rounded-window bg-surface shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        data-approval-dialog=""
      >
        <div className="px-5 pt-5 pb-4">
          <h2
            id={titleId}
            className="text-balance text-[16px] font-semibold tracking-[-0.015em] leading-6 text-ink"
          >
            {title}
          </h2>
          <p
            id={messageId}
            className="mt-1.5 text-pretty whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2"
          >
            {message}
          </p>
          {inputLabel ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-2">{inputLabel}</span>
              <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canConfirm) onConfirm(value.trim());
                }}
                className="h-9 w-full rounded-control border border-line-strong bg-field px-3 text-[13px] text-ink shadow-inset-field outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--focus)]"
              />
            </label>
          ) : null}
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="quiet" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={danger ? 'danger' : 'primary'}
              disabled={!canConfirm}
              onClick={() => onConfirm(value.trim())}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
