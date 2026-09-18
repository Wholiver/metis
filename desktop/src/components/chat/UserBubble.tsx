import React, { useMemo, useState } from 'react';
import { Check, Copy, FileText, Video } from 'lucide-react';
import { Message } from '../../types';
import { normalizeUserMessageForDisplay } from '../../lib/attachments';
import { useI18n } from '../../i18n';

interface UserBubbleProps {
  message: Message;
}

export function resolveUserPromptCopyText(message: Pick<Message, 'content' | 'attachments'>): string {
  return normalizeUserMessageForDisplay(message.content || '', message.attachments).text.trim();
}

export const UserBubble = React.memo<UserBubbleProps>(({ message }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { text, attachments } = useMemo(
    () => normalizeUserMessageForDisplay(message.content || '', message.attachments),
    [message.content, message.attachments],
  );
  const copyText = text.trim();

  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const copyLabel = copied
    ? (t('logCopied') || 'Copied')
    : (t('copyPrompt') || t('copy') || 'Copy prompt');

  return (
    <div
      className="my-2 flex w-full min-w-0 max-w-full justify-end"
      data-message-id={message.id}
      data-message-role="user"
      data-i18n-skip=""
      data-failed={message.failed ? 'true' : undefined}
    >
      <div className="flex max-w-[500px] flex-col items-end gap-1.5">
        {attachments.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-end gap-1.5" data-message-attachments="">
            {attachments.map((attachment) => attachment.kind === 'image' && attachment.previewUrl ? (
              <img
                key={attachment.id}
                src={attachment.previewUrl}
                alt={attachment.name}
                className="max-h-[240px] max-w-[320px] rounded-card object-contain shadow-hairline"
                data-message-attachment="image"
              />
            ) : (
              <div
                key={attachment.id}
                className="flex h-12 max-w-[280px] items-center gap-2.5 rounded-[12px] border border-line bg-surface px-3 text-left shadow-hairline"
                data-message-attachment={attachment.kind}
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-field text-ink-3">
                  {attachment.kind === 'video' ? (
                    <Video className="h-4 w-4 stroke-[1.8]" />
                  ) : (
                    <FileText className="h-4 w-4 stroke-[1.8]" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-ink">{attachment.name}</span>
                  <span className="block text-[10.5px] text-ink-3 tabular-nums">{attachment.sizeText}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {(text || message.failed) && (
          <div
            className="max-w-full rounded-[10px] border border-line bg-surface px-3.5 py-2 text-left text-[14px] font-normal leading-[1.5] text-ink whitespace-pre-wrap break-words text-pretty shadow-hairline"
            data-user-bubble=""
          >
            {text}
            {message.failed && (
              <span className="mt-1.5 block text-[11px] text-red" role="status">Not sent</span>
            )}
          </div>
        )}
        {copyText ? (
          <div
            className="flex min-h-6 items-center justify-end"
            data-slot="user-prompt-copy-wrapper"
            data-user-prompt-copy-wrapper=""
          >
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { void handleCopy(); }}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
              title={copyLabel}
              aria-label={copyLabel}
              data-user-prompt-copy=""
            >
              {copied
                ? <Check className="h-3.5 w-3.5 stroke-[2.2] text-green" aria-hidden="true" />
                : <Copy className="h-3.5 w-3.5 stroke-[1.8]" aria-hidden="true" />}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

UserBubble.displayName = 'UserBubble';
