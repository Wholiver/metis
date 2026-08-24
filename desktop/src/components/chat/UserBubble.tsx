import React from 'react';
import { FileText, Video } from 'lucide-react';
import { Message } from '../../types';

interface UserBubbleProps {
  message: Message;
}

export const UserBubble: React.FC<UserBubbleProps> = ({ message }) => {
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
                className="max-h-[240px] max-w-[320px] rounded-2xl object-contain outline outline-1 outline-black/10"
                data-message-attachment="image"
              />
            ) : (
              <div
                key={attachment.id}
                className="flex h-12 max-w-[280px] items-center gap-2.5 rounded-xl border border-slate-200/90 bg-white px-3 text-left shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
                data-message-attachment={attachment.kind}
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500">
                  {attachment.kind === 'video' ? (
                    <Video className="h-4 w-4 stroke-[1.8]" />
                  ) : (
                    <FileText className="h-4 w-4 stroke-[1.8]" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-slate-700">{attachment.name}</span>
                  <span className="block text-[10.5px] text-slate-400 tabular-nums">{attachment.sizeText}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {(message.content || message.failed) && (
          <div className="border border-slate-900 bg-white text-slate-900 px-5 py-3 rounded-[18px] rounded-br-[4px] max-w-full text-[14px] leading-relaxed shadow-xs font-normal text-left whitespace-pre-wrap break-words text-pretty">
            {message.content}
            {message.failed && (
              <span className="block mt-1.5 text-[11px] text-rose-600" role="status">Not sent</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
