import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  cancelExtensionUiRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
  submitExtensionUiRequest,
} from '../lib/extension-ui';

interface ExtensionUiDialogProps {
  request?: ExtensionUiRequest;
  busy?: boolean;
  onRespond: (response: ExtensionUiResponse) => Promise<boolean | void>;
}

export function ExtensionUiDialog({ request, busy = false, onRespond }: ExtensionUiDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!request) return;
    setValue(request.method === 'select' ? request.options[0] || '' : request.prefill || '');
    const frame = window.requestAnimationFrame(() => (
      request.method === 'confirm' ? submitButtonRef.current : inputRef.current
    )?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [request]);

  if (!request) return null;

  const isConfirm = request.method === 'confirm';
  const isSelect = request.method === 'select';
  const isEditor = request.method === 'editor';
  const title = request.title || (isConfirm ? t('confirm') : isSelect ? t('choose') : t('continueOperation'));
  const description = request.message || '';
  const fieldLabel = isSelect ? t('choose') : t('enterValue');
  const submitDisabled = busy || (isSelect && request.options.length === 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitDisabled) return;
    void onRespond(submitExtensionUiRequest(request, value));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      void onRespond(cancelExtensionUiRequest(request));
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    ) || [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-ink/30 p-5 backdrop-blur-[3px]">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${description ? `${descriptionId} ` : ''}${hintId}`}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-surface p-5 shadow-overlay"
      >
        <form onSubmit={submit}>
          <header className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-hover-2 text-ink-2">
              <ExternalLink aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{t('providerAuthorization')}</p>
              <h2 id={titleId} className="text-balance text-[16px] font-semibold leading-6 text-ink">{title}</h2>
            </div>
          </header>

          {description && <p id={descriptionId} className="mt-4 text-pretty text-[14px] leading-5 text-ink-2">{description}</p>}

          {!isConfirm && (
            <label className="mt-4 block text-[12px] font-medium text-ink-2">
              <span className="mb-1.5 block">{fieldLabel}</span>
              {isSelect ? (
                <select
                  ref={inputRef as React.RefObject<HTMLSelectElement>}
                  value={value}
                  disabled={busy || request.options.length === 0}
                  onChange={(event) => setValue(event.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:bg-inset dark:disabled:bg-inset disabled:text-ink-3"
                >
                  {request.options.map((option, index) => <option key={`${index}:${option}`} value={option}>{option}</option>)}
                </select>
              ) : isEditor ? (
                <textarea
                  ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                  value={value}
                  placeholder={request.placeholder}
                  disabled={busy}
                  rows={6}
                  onChange={(event) => setValue(event.target.value)}
                  className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] leading-5 text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:bg-inset dark:disabled:bg-inset"
                />
              ) : (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  value={value}
                  placeholder={request.placeholder}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setValue(event.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-line-strong dark:focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:bg-inset dark:disabled:bg-inset"
                />
              )}
            </label>
          )}

          <p id={hintId} className="mt-3 text-pretty text-[11.5px] leading-4 text-ink-3">{t('completeToContinue')}</p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRespond(cancelExtensionUiRequest(request))}
              className="h-10 rounded-xl px-4 text-[12.5px] font-semibold text-ink-2 transition-[background-color,color,transform] hover:bg-hover-2 dark:hover:bg-hover hover:text-ink active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('cancel')}
            </button>
            <button
              ref={submitButtonRef}
              type="submit"
              disabled={submitDisabled}
              className="h-10 rounded-control bg-accent px-4 text-[12.5px] font-semibold text-white shadow-btn transition-[background-color,transform] hover:bg-accent-ink active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('confirm')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
