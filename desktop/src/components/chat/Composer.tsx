import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, ArrowUp, File as FileIcon, FileText, LoaderCircle, Maximize2, Minimize2, Video, X } from 'lucide-react';
import { Agent, CollaborationMode, MessageAttachment, ModelOption, SendMessageOptions } from '../../types';
import { composerTextareaHeight, hasComposerLineBreak } from '../../lib/composer';
import {
  classifyAttachment,
  composeAttachmentPayload,
  filesFromTransfer,
  formatFileSize,
  imageMimeType,
  MAX_BUFFERED_ATTACHMENT_BYTES,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_TEXT_BYTES,
  transferHasFiles,
} from '../../lib/attachments';
import { ModelSwitcher } from './ModelSwitcher';
import { ModeSwitcher } from './ModeSwitcher';
import { filterSkills, SkillCommand, SkillPicker } from './SkillPicker';

interface ComposerProps {
  agent: Agent;
  onSendMessage: (text: string, options?: SendMessageOptions) => boolean | void | Promise<boolean | void>;
  models: ModelOption[];
  activeModel?: ModelOption;
  onSelectModel: (model: ModelOption) => void | Promise<void>;
  isChangingModel?: boolean;
  thinkingLevel?: string;
  thinkingLevels?: string[];
  supportsThinking?: boolean;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  isChangingThinking?: boolean;
  collaborationMode: CollaborationMode;
  onSelectCollaborationMode: (mode: CollaborationMode) => boolean | void | Promise<boolean | void>;
  isChangingCollaborationMode?: boolean;
  skills?: SkillCommand[];
  disabled?: boolean;
}

function readFile(file: File, method: 'readAsDataURL' | 'readAsText'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true });
    reader.addEventListener('error', () => reject(reader.error || new Error(`Unable to read ${file.name}`)), { once: true });
    reader[method](file);
  });
}

async function resolveAttachmentPath(file: File): Promise<string> {
  const desktop = (window as any).metisDesktop;
  try {
    const nativePath = desktop?.attachments?.pathForFile?.(file);
    if (nativePath) return nativePath;
  } catch {}
  if (file.size > MAX_BUFFERED_ATTACHMENT_BYTES) throw new Error(`${file.name} is too large to attach`);
  const dataUrl = await readFile(file, 'readAsDataURL');
  const savedPath = await desktop?.attachments?.save?.({
    name: file.name,
    mimeType: file.type,
    data: dataUrl.split(',')[1] || '',
  });
  if (!savedPath) throw new Error(`Unable to save ${file.name}`);
  return savedPath;
}

async function prepareAttachment(file: File): Promise<MessageAttachment> {
  const kind = classifyAttachment(file);
  const base = {
    id: crypto.randomUUID(),
    kind,
    name: file.name || 'attachment',
    sizeText: formatFileSize(file.size),
  } satisfies MessageAttachment;
  if (kind === 'image') {
    if (file.size > MAX_INLINE_IMAGE_BYTES) throw new Error(`${file.name} exceeds the 7 MB image limit`);
    const previewUrl = await readFile(file, 'readAsDataURL');
    return {
      ...base,
      mimeType: imageMimeType(file),
      data: previewUrl.split(',')[1] || '',
      previewUrl,
    };
  }
  if (kind === 'text' && file.size <= MAX_INLINE_TEXT_BYTES) {
    return { ...base, content: await readFile(file, 'readAsText') };
  }
  return {
    ...base,
    kind: kind === 'text' ? 'file' : kind,
    path: await resolveAttachmentPath(file),
  };
}

function bufferedAttachmentBytes(attachment: MessageAttachment): number {
  if (attachment.kind === 'image' && attachment.data) return Math.ceil(attachment.data.length * 3 / 4);
  if (attachment.kind === 'text' && attachment.content) return new TextEncoder().encode(attachment.content).byteLength;
  return 0;
}

export const Composer: React.FC<ComposerProps> = ({
  agent,
  onSendMessage,
  models,
  activeModel,
  onSelectModel,
  isChangingModel = false,
  thinkingLevel,
  thinkingLevels,
  supportsThinking = false,
  onSelectThinkingLevel,
  isChangingThinking = false,
  collaborationMode,
  onSelectCollaborationMode,
  isChangingCollaborationMode = false,
  skills = [],
  disabled = false,
}) => {
  const [text, setText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(24);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const isMultiline = hasComposerLineBreak(text);
  const skillQuery = text.startsWith('/') ? text.slice(1) : '';
  const matchingSkills = filterSkills(skills, skillQuery);

  const chooseSkill = (skill: SkillCommand) => {
    setText(`/${skill.name} `);
    setSkillMenuOpen(false);
    setActiveSkillIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (disabled) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [disabled]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = isMultiline ? 'auto' : '24px';
    if (isMultiline) {
      const nextHeight = composerTextareaHeight(input.scrollHeight, isExpanded);
      input.style.height = `${nextHeight}px`;
      setTextareaHeight(nextHeight);
    } else {
      setTextareaHeight(24);
    }
  }, [isExpanded, isMultiline, text]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const main = shell?.closest<HTMLElement>('[data-purpose="main-chat"]');
    if (!shell || !main) return;
    let pendingScrollFrame = 0;

    const updateOverlayHeight = () => {
      const messageScroll = main.querySelector<HTMLElement>('[data-message-scroll]');
      const wasNearBottom = Boolean(
        messageScroll
        && messageScroll.scrollHeight - messageScroll.scrollTop - messageScroll.clientHeight < 32,
      );
      main.style.setProperty(
        '--composer-overlay-height',
        `${Math.ceil(shell.getBoundingClientRect().height)}px`,
      );
      if (wasNearBottom && messageScroll) {
        cancelAnimationFrame(pendingScrollFrame);
        pendingScrollFrame = requestAnimationFrame(() => {
          messageScroll.scrollTop = messageScroll.scrollHeight;
        });
      }
    };
    updateOverlayHeight();

    const observer = new ResizeObserver(updateOverlayHeight);
    observer.observe(shell);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pendingScrollFrame);
      main.style.removeProperty('--composer-overlay-height');
    };
  }, []);

  const composerHeight = isMultiline
    ? Math.max(isExpanded ? 276 : 128, textareaHeight + 61)
    : 48;

  const addAttachments = async (files: File[]) => {
    if (files.length === 0 || disabled || isAttaching) return;
    setIsAttaching(true);
    setAttachmentError('');
    const prepared: MessageAttachment[] = [];
    const errors: string[] = [];
    let bufferedBytes = attachments.reduce((total, attachment) => total + bufferedAttachmentBytes(attachment), 0);
    for (const file of files) {
      try {
        const attachment = await prepareAttachment(file);
        const nextBytes = bufferedBytes + bufferedAttachmentBytes(attachment);
        if (nextBytes > MAX_INLINE_IMAGE_BYTES) {
          throw new Error(`${file.name} would exceed the 7 MB combined attachment limit`);
        }
        bufferedBytes = nextBytes;
        prepared.push(attachment);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (prepared.length > 0) setAttachments((current) => [...current, ...prepared]);
    if (errors.length > 0) setAttachmentError(errors.join(' · '));
    setIsAttaching(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!text.trim() && attachments.length === 0) || disabled || isAttaching) return;
    const draftText = text;
    const draftAttachments = attachments;
    const payload = composeAttachmentPayload(draftText, draftAttachments);
    setText('');
    setAttachments([]);
    setAttachmentError('');
    setIsExpanded(false);
    const sent = await onSendMessage(payload.message, {
      ...(payload.images ? { images: payload.images } : {}),
      displayText: draftText.trim(),
      attachments: draftAttachments,
    });
    if (sent === false) {
      setText((current) => current || draftText);
      setAttachments((current) => [...draftAttachments, ...current]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (skillMenuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (matchingSkills.length > 0) setActiveSkillIndex((current) => (current + (e.key === 'ArrowDown' ? 1 : -1) + matchingSkills.length) % matchingSkills.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSkillMenuOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && matchingSkills.length > 0) {
        e.preventDefault();
        chooseSkill(matchingSkills[Math.min(activeSkillIndex, matchingSkills.length - 1)]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  };

  return (
    <div
      ref={shellRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 pt-1 flex flex-col items-center justify-center w-full bg-transparent"
      data-composer-shell=""
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        data-attachment-input=""
        onChange={(event) => void addAttachments(Array.from(event.target.files || []))}
      />

      {attachments.length > 0 && (
        <div
          className="pointer-events-auto mb-2 flex w-full max-w-[620px] gap-2 overflow-x-auto px-1 pb-0.5"
          data-composer-attachments=""
          aria-label="Attachments"
        >
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex h-12 max-w-[230px] flex-none items-center gap-2 rounded-xl border border-slate-200/90 bg-white p-1 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
              data-attachment-preview={attachment.kind}
            >
              {attachment.kind === 'image' && attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  className="h-10 w-10 rounded-lg object-cover outline outline-1 outline-black/10"
                />
              ) : (
                <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500">
                  {attachment.kind === 'video' ? (
                    <Video className="h-[18px] w-[18px] stroke-[1.8]" />
                  ) : attachment.kind === 'text' ? (
                    <FileText className="h-[18px] w-[18px] stroke-[1.8]" />
                  ) : (
                    <FileIcon className="h-[18px] w-[18px] stroke-[1.8]" />
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-slate-700">{attachment.name}</span>
                <span className="block text-[10.5px] text-slate-400 tabular-nums">{attachment.sizeText}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                className="grid h-10 w-10 flex-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
              >
                <X className="h-3.5 w-3.5 stroke-2" />
              </button>
            </div>
          ))}
        </div>
      )}

      {attachmentError && (
        <p className="pointer-events-auto mb-2 w-full max-w-[620px] px-3 text-[11px] text-red-600" role="alert" data-attachment-error="">
          {attachmentError}
        </p>
      )}

      {skillMenuOpen && <SkillPicker skills={skills} query={skillQuery} activeIndex={activeSkillIndex} onSelect={chooseSkill} />}

      <div className="mb-2 flex w-full max-w-[620px] justify-start" data-mode-switcher-row="">
        <ModeSwitcher
          mode={collaborationMode}
          onSelectMode={onSelectCollaborationMode}
          disabled={disabled}
          loading={isChangingCollaborationMode}
        />
      </div>

      <form
        onSubmit={handleSubmit}
        onDragEnter={(event) => {
          if (!transferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!transferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFiles(false);
        }}
        onDrop={(event) => {
          if (!transferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          setIsDraggingFiles(false);
          void addAttachments(filesFromTransfer(event.dataTransfer));
        }}
        data-composer=""
        data-composer-multiline={isMultiline ? 'true' : 'false'}
        style={{ height: composerHeight }}
        aria-busy={isAttaching}
        className={`pointer-events-auto relative w-full max-w-[620px] overflow-hidden bg-white border grid grid-cols-[40px_minmax(0,1fr)_auto_40px] items-center gap-x-1 transition-[height,border-radius,border-color] duration-200 ease-out motion-reduce:transition-none focus-within:border-slate-300 ${
          isDraggingFiles ? 'border-slate-500' : 'border-slate-200/90'
        } ${
          isMultiline
            ? 'grid-rows-[minmax(52px,auto)_40px] gap-y-1 rounded-t-[26px] rounded-b-[24px] px-1 pt-1 pb-[3px]'
            : 'grid-rows-1 rounded-[24px] px-1'
        }`}
      >
        <button
          type="button"
          aria-label="Add attachment"
          disabled={disabled || isAttaching}
          onClick={() => fileInputRef.current?.click()}
          className={`w-10 h-10 rounded-full hover:bg-black/[0.045] flex items-center justify-center text-[#64748b] hover:text-[#0f172a] active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
            isMultiline ? 'col-start-1 row-start-2 self-end' : 'col-start-1 row-start-1'
          }`}
          title="Add attachment"
        >
          {isAttaching ? (
            <LoaderCircle className="h-[18px] w-[18px] animate-spin stroke-2" />
          ) : (
            <Plus className="w-[18px] h-[18px] stroke-[2]" />
          )}
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => {
            const nextText = e.target.value;
            setText(nextText);
            const opensSkillMenu = nextText.startsWith('/') && skills.length > 0;
            setSkillMenuOpen(opensSkillMenu);
            if (opensSkillMenu) setActiveSkillIndex(0);
            if (!hasComposerLineBreak(nextText)) setIsExpanded(false);
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            if (!transferHasFiles(event.clipboardData)) return;
            event.preventDefault();
            void addAttachments(filesFromTransfer(event.clipboardData));
          }}
          placeholder={`Message ${agent.name}`}
          disabled={disabled}
          aria-label={`Message ${agent.name}`}
          data-composer-input=""
          className={`min-w-0 w-full resize-none bg-transparent text-[14px] leading-6 text-[#1e293b] placeholder-[#9ca3af] outline-none disabled:cursor-not-allowed ${
            isMultiline
              ? 'col-span-4 row-start-1 self-start mt-2.5 overflow-y-auto pl-2.5 pr-10 py-0'
              : 'col-start-2 row-start-1 h-6 overflow-hidden whitespace-nowrap px-2'
          }`}
        />

        {isMultiline && (
          <button
            type="button"
            aria-label={isExpanded ? 'Collapse composer' : 'Expand composer'}
            aria-expanded={isExpanded}
            onClick={() => {
              setIsExpanded((current) => !current);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="absolute right-2.5 top-2.5 w-10 h-10 rounded-full grid place-items-center text-[#94a3b8] hover:text-[#475569] hover:bg-black/[0.035] active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
            title={isExpanded ? 'Collapse composer' : 'Expand composer'}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4 stroke-[1.8]" />
            ) : (
              <Maximize2 className="w-4 h-4 stroke-[1.8]" />
            )}
          </button>
        )}

        <ModelSwitcher
          models={models}
          activeModel={activeModel}
          onSelectModel={onSelectModel}
          disabled={disabled}
          loading={isChangingModel}
          thinkingLevel={thinkingLevel}
          thinkingLevels={thinkingLevels}
          supportsThinking={supportsThinking}
          onSelectThinkingLevel={onSelectThinkingLevel}
          thinkingLoading={isChangingThinking}
          className={isMultiline ? 'col-start-3 row-start-2 self-end justify-self-end' : 'col-start-3 row-start-1 justify-self-end'}
        />

        <button
          type="submit"
          disabled={disabled || isAttaching || (!text.trim() && attachments.length === 0)}
          aria-label="Send message"
          className={`w-10 h-10 rounded-full bg-[#0d0e11] text-white flex items-center justify-center hover:bg-black active:scale-[0.96] transition-[background-color,opacity,transform] disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
            isMultiline ? 'col-start-4 row-start-2 self-end' : 'col-start-4 row-start-1'
          }`}
          title="Send"
        >
          <ArrowUp className="w-4 h-4 stroke-[2.5]" data-send-icon="" />
        </button>
      </form>
    </div>
  );
};
