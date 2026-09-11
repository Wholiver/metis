import React, { useLayoutEffect, useRef, useState } from 'react';
import { PendingUserInput, UserInputAnswer, UserInputResponse } from '../../types';
import { WorkProgressIndicator } from './WorkProgressIndicator';
import { WorkProgressState } from '../../lib/work-progress';
import { useI18n } from '../../i18n';
import ApprovalCard, { type ApprovalQuestion, type ApprovalSubmittedAnswer } from '../primitives/ApprovalCard';

interface UserInputCardProps {
  request: PendingUserInput;
  onRespond: (requestId: string, response: UserInputResponse) => boolean | Promise<boolean>;
  progress?: WorkProgressState;
  idle?: boolean;
}

export const UserInputCard: React.FC<UserInputCardProps> = ({ request, onRespond, progress, idle = false }) => {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);

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

  const questions: ApprovalQuestion[] = request.questions.map((question) => ({
    id: question.id,
    q: question.question,
    header: question.header,
    type: 'radio',
    options: (question.options ?? []).map((option) => ({
      label: option.label,
      description: option.description,
      recommended: option.recommended,
    })),
  }));

  const submitAnswers = async (answers: ApprovalSubmittedAnswer[]) => {
    setIsSubmitting(true);
    setError('');
    const mapped: UserInputAnswer[] = request.questions.map((question, index) => {
      const answer = answers[index];
      return {
        id: question.id,
        value: answer?.value || '',
        ...(answer?.selectedLabels[0] ? { selectedLabel: answer.selectedLabels[0] } : {}),
      };
    });
    const didSubmit = await onRespond(request.requestId, {
      cancelled: false,
      answers: mapped,
    });
    if (!didSubmit) {
      setIsSubmitting(false);
      setError(t('askUserSubmitError'));
      return false;
    }
    return true;
  };

  const cancel = async () => {
    if (isSubmitting) return false;
    setIsSubmitting(true);
    setError('');
    const didCancel = await onRespond(request.requestId, { cancelled: true, answers: [] });
    if (!didCancel) {
      setIsSubmitting(false);
      setError(t('askUserCancelError'));
      return false;
    }
    return true;
  };

  return (
    <div
      ref={shellRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex w-full flex-col items-center bg-transparent p-4 pt-1"
      data-user-input-shell=""
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -top-7 -z-10 bg-gradient-to-t from-[var(--page)] from-75% via-[color-mix(in_srgb,var(--page)_95%,transparent)] to-transparent"
        data-composer-fade-mask=""
      />
      <div className="w-full max-w-[620px] flex flex-col items-start">
        {progress && (
          <div className="pointer-events-auto mb-2 flex items-center px-1" data-composer-progress-slot="">
            <WorkProgressIndicator progress={progress} idle={idle} />
          </div>
        )}
        <div className="pointer-events-auto w-full max-w-[620px]">
          <ApprovalCard
            requestId={request.requestId}
            questions={questions}
            busy={isSubmitting}
            error={error}
            title={t('askUserTitle')}
            labels={{
              skip: t('askUserCancelLabel') || 'Cancel',
              continue: t('askUserContinue') || 'Continue',
              send: t('askUserSubmit') || 'Submit',
              customPlaceholder: t('askUserFreePlaceholder') || 'Something else…',
              sentMessage: t('askUserSubmitting') || 'Answers sent',
              recommended: t('askUserRecommended') || 'Recommended',
              dismiss: t('askUserDismiss'),
              openApproval: t('askUserOpenApproval'),
              startOver: t('askUserStartOver'),
              customAnswer: t('askUserCustomAnswer'),
              previousQuestion: t('askUserPreviousQuestion'),
              nextQuestion: t('askUserNextQuestion'),
            }}
            onSubmitted={submitAnswers}
            onCancel={cancel}
            resettable={false}
            autoAdvanceRadio={false}
          />
        </div>
      </div>
    </div>
  );
};
