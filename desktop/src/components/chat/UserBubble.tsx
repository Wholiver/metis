import React from 'react';
import { FileText, Video } from 'lucide-react';
import { Message } from '../../types';

interface UserBubbleProps {
  message: Message;
}

export const UserBubble = React.memo<UserBubbleProps>(({ message }) => {
  return (
    <div
      className="my-2 flex w-full min-w-0 max-w-full justify-end"
      data-message-id={message.id}
      data-message-role="user"
      data-failed={message.failed ? 'true' : undefined}
    >
      <div className="flex max-w-[500px] flex-col items-end gap-1.5">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-end gap-1.5" data-message-attachments="">
            {message.attachments.map((attachment) => attachment.kind === 'image' && attachment.previewUrl ? (
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
        {(message.content || message.failed) && (
          <div
            className="max-w-full rounded-[10px] border border-line bg-surface px-3.5 py-2 text-left text-[14px] font-normal leading-[1.5] text-ink whitespace-pre-wrap break-words text-pretty shadow-hairline"
            data-user-bubble=""
          >
            {message.content}
            {message.failed && (
              <span className="mt-1.5 block text-[11px] text-red" role="status">Not sent</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

UserBubble.displayName = 'UserBubble';
