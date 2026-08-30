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
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/30 p-5 backdrop-blur-[3px]">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${description ? `${descriptionId} ` : ''}${hintId}`}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white p-5 shadow-[0_24px_70px_rgb(15_23_42_/_0.22),0_0_0_1px_rgb(15_23_42_/_0.08)]"
      >
        <form onSubmit={submit}>
          <header className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <ExternalLink aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t('providerAuthorization')}</p>
              <h2 id={titleId} className="text-balance text-[16px] font-semibold leading-6 text-slate-900">{title}</h2>
            </div>
          </header>

          {description && <p id={descriptionId} className="mt-4 text-pretty text-[13px] leading-5 text-slate-600">{description}</p>}

          {!isConfirm && (
            <label className="mt-4 block text-[12px] font-medium text-slate-700">
              <span className="mb-1.5 block">{fieldLabel}</span>
              {isSelect ? (
                <select
                  ref={inputRef as React.RefObject<HTMLSelectElement>}
                  value={value}
                  disabled={busy || request.options.length === 0}
                  onChange={(event) => setValue(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 outline-none transition-[border-color,box-shadow] focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
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
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] leading-5 text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50"
                />
              ) : (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  value={value}
                  placeholder={request.placeholder}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setValue(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50"
                />
              )}
            </label>
          )}

          <p id={hintId} className="mt-3 text-pretty text-[11.5px] leading-4 text-slate-500">{t('completeToContinue')}</p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRespond(cancelExtensionUiRequest(request))}
              className="h-10 rounded-xl px-4 text-[12.5px] font-semibold text-slate-600 transition-[background-color,color,transform] hover:bg-slate-100 hover:text-slate-900 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('cancel')}
            </button>
            <button
              ref={submitButtonRef}
              type="submit"
              disabled={submitDisabled}
              className="h-10 rounded-xl bg-slate-900 px-4 text-[12.5px] font-semibold text-white shadow-sm transition-[background-color,transform] hover:bg-slate-800 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('confirm')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
