import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, HelpCircle, LoaderCircle, X } from 'lucide-react';
import { PendingUserInput, UserInputAnswer, UserInputResponse } from '../../types';
import { useI18n } from '../../i18n';

interface UserInputCardProps {
  request: PendingUserInput;
  onRespond: (requestId: string, response: UserInputResponse) => boolean | Promise<boolean>;
}

export const UserInputCard: React.FC<UserInputCardProps> = ({ request, onRespond }) => {
  const { t } = useI18n();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, UserInputAnswer>>({});
  const [selectedLabel, setSelectedLabel] = useState('');
  const [freeform, setFreeform] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);
  const freeformRef = useRef<HTMLInputElement>(null);
  const question = request.questions[questionIndex];
  const isLastQuestion = questionIndex === request.questions.length - 1;

  useEffect(() => {
    setQuestionIndex(0);
    setAnswers({});
    setSelectedLabel('');
    setFreeform('');
    setError('');
  }, [request.requestId]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const main = shell?.closest<HTMLElement>('[data-purpose="main-chat"]');
    if (!shell || !main) return;
    const updateOverlayHeight = () => {
      main.style.setProperty('--composer-overlay-height', `${Math.ceil(shell.getBoundingClientRect().height)}px`);
    };
    updateOverlayHeight();
    const observer = new ResizeObserver(updateOverlayHeight);
    observer.observe(shell);
    return () => {
      observer.disconnect();
      main.style.removeProperty('--composer-overlay-height');
    };
  }, []);

  if (!question) return null;

  const chooseOption = (label: string) => {
    setSelectedLabel(label);
    setFreeform('');
    setError('');
  };

  const currentAnswer = (): UserInputAnswer | undefined => {
    const value = freeform.trim() || selectedLabel;
    if (!value) return undefined;
    return { id: question.id, value, ...(selectedLabel ? { selectedLabel } : {}) };
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const answer = currentAnswer();
    if (!answer) {
      setError(t('askUserRequired'));
      freeformRef.current?.focus();
      return;
    }
    const nextAnswers = { ...answers, [question.id]: answer };
    if (!isLastQuestion) {
      setAnswers(nextAnswers);
      setQuestionIndex((current) => current + 1);
      setSelectedLabel('');
      setFreeform('');
      setError('');
      return;
    }
    setIsSubmitting(true);
    const didSubmit = await onRespond(request.requestId, {
      cancelled: false,
      answers: request.questions.map((item) => nextAnswers[item.id]),
    });
    if (!didSubmit) {
      setIsSubmitting(false);
      setError(t('askUserSubmitError'));
    }
  };

  const cancel = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const didCancel = await onRespond(request.requestId, { cancelled: true, answers: [] });
    if (!didCancel) {
      setIsSubmitting(false);
      setError(t('askUserCancelError'));
    }
  };

  return (
    <div
      ref={shellRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex w-full flex-col items-center bg-transparent p-4 pt-1"
      data-user-input-shell=""
    >
      <form
        onSubmit={submit}
        aria-labelledby={`ask-title-${request.requestId}`}
        aria-busy={isSubmitting}
        className="pointer-events-auto w-full max-w-[620px] rounded-[24px] border-[0.5px] border-slate-200/80 bg-white/95 backdrop-blur-md p-3.5 shadow-none"
        data-user-input-request-id={request.requestId}
        data-question-id={question.id}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-slate-100 text-slate-700">
            <HelpCircle className="h-4 w-4 stroke-[2]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`ask-title-${request.requestId}`} className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#172033] text-balance">
                {t('askUserTitle')}
              </h2>
              {request.questions.length > 1 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-500 tabular-nums border border-slate-200/50" data-user-input-progress="">
                  {t('askUserProgress', { current: questionIndex + 1, total: request.questions.length })}
                </span>
              )}
            </div>
            {question.header && (
              <p className="mt-0.5 text-[11.5px] font-medium text-slate-500">{question.header}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={isSubmitting}
            aria-label={t('askUserCancelLabel')}
            className="grid h-8 w-8 flex-none place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4 stroke-2" />
          </button>
        </div>

        <fieldset className="mt-3 min-w-0" disabled={isSubmitting}>
          <legend className="text-[14px] font-medium leading-relaxed text-[#1e293b] text-pretty">{question.question}</legend>
          {question.options?.length ? (
            <div className="mt-3 grid gap-2" data-user-input-options="">
              {question.options.map((option) => {
                const selected = selectedLabel === option.label;
                return (
                  <label
                    key={option.label}
                    className={`group flex min-h-12 cursor-pointer items-start gap-3 rounded-[12px] px-3 py-2.5 transition-[color,background-color,border-color,box-shadow,transform] active:scale-[0.99] border ${
                      selected
                        ? 'border-slate-800 bg-slate-50/90 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-slate-800/10'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/60 shadow-[0_0_0_1px_rgba(148,163,184,0.1)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`ask-${request.requestId}-${question.id}`}
                      value={option.label}
                      checked={selected}
                      onChange={() => chooseOption(option.label)}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full border transition-[border-color,background-color,color] ${
                        selected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-300 bg-white text-transparent group-hover:border-slate-400'
                      }`}
                    >
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                        {option.label}
                        {option.recommended && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-700 border border-emerald-200/60">
                            {t('askUserRecommended')}
                          </span>
                        )}
                      </span>
                      {option.description && (
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-500 text-pretty">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
          <input
            ref={freeformRef}
            value={freeform}
            onChange={(event) => {
              setFreeform(event.target.value);
              setSelectedLabel('');
              setError('');
            }}
            placeholder={t('askUserFreePlaceholder')}
            aria-label={t('askUserOtherAnswerLabel')}
            className="mt-2.5 h-10 w-full rounded-[12px] border border-slate-200/80 bg-slate-50/70 px-3.5 text-[12.5px] text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 transition-[border-color,background-color,box-shadow]"
          />
        </fieldset>

        <div className="mt-3 flex min-h-9 items-center gap-3">
          <p className="min-w-0 flex-1 text-[11.5px] font-medium text-red-600" role={error ? 'alert' : undefined}>{error}</p>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-label={isLastQuestion ? t('askUserSubmit') : t('askUserContinue')}
            className="flex h-9 items-center gap-1.5 rounded-[12px] bg-[#172033] px-4 text-[12px] font-semibold text-white hover:bg-[#263247] active:scale-[0.96] transition-[background-color,transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-55 shadow-sm"
            data-user-input-confirm=""
          >
            {isSubmitting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin stroke-2" /> : <ArrowRight className="h-3.5 w-3.5 stroke-2" />}
            {isSubmitting ? t('askUserSubmitting') : isLastQuestion ? t('askUserSubmit') : t('askUserContinue')}
          </button>
        </div>
      </form>
    </div>
  );
};
