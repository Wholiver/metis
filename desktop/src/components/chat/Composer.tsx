import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, ArrowUp, Square, File as FileIcon, FileText, FileUp, ListTree, LoaderCircle, Maximize2, Minimize2, Video, X } from 'lucide-react';
import { Agent, CollaborationMode, MessageAttachment, ModelOption, SendMessageOptions, ThinkingOption } from '../../types';
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
import { useI18n } from '../../i18n';

interface ComposerProps {
  agent: Agent;
  onSendMessage: (text: string, options?: SendMessageOptions) => boolean | void | Promise<boolean | void>;
  onAbort?: () => void | Promise<void>;
  models: ModelOption[];
  activeModel?: ModelOption;
  onSelectModel: (model: ModelOption) => void | Promise<void>;
  isChangingModel?: boolean;
  thinkingLevel?: string;
  thinkingLevels?: string[];
  thinkingOptions?: ThinkingOption[];
  supportsThinking?: boolean;
  onSelectThinkingLevel?: (level: string) => void | Promise<void>;
  isChangingThinking?: boolean;
  collaborationMode: CollaborationMode;
  onSelectCollaborationMode: (mode: CollaborationMode) => boolean | void | Promise<boolean | void>;
  isChangingCollaborationMode?: boolean;
  skills?: SkillCommand[];
  disabled?: boolean;
  isStreaming?: boolean;
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
  onAbort,
  models,
  activeModel,
  onSelectModel,
  isChangingModel = false,
  thinkingLevel,
  thinkingLevels,
  thinkingOptions,
  supportsThinking = false,
  onSelectThinkingLevel,
  isChangingThinking = false,
  collaborationMode,
  onSelectCollaborationMode,
  isChangingCollaborationMode = false,
  skills = [],
  disabled = false,
  isStreaming = false,
}) => {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(24);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const isMultiline = true;
  const skillQuery = text.startsWith('/') ? text.slice(1) : '';
  const matchingSkills = filterSkills(skills, skillQuery);

  const chooseSkill = (skill: SkillCommand) => {
    setText(`/${skill.name} `);
    setSkillMenuOpen(false);
    setPlusMenuOpen(false);
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
    input.style.height = 'auto';
    const nextHeight = composerTextareaHeight(input.scrollHeight, isExpanded);
    input.style.height = `${nextHeight}px`;
    setTextareaHeight(nextHeight);
  }, [isExpanded, text]);

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

  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (event: DragEvent) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragCounter += 1;
      setIsDraggingFiles(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setIsDraggingFiles(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setIsDraggingFiles(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!transferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragCounter = 0;
      setIsDraggingFiles(false);
      const files = filesFromTransfer(event.dataTransfer);
      if (files.length > 0) {
        void addAttachments(files);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [disabled, isAttaching]);

  const attachmentsHeight = attachments.length > 0 ? 56 : 0;
  const composerHeight = Math.max(isExpanded ? 276 : (108 + attachmentsHeight), textareaHeight + 54 + attachmentsHeight);

  const isAttachingRef = useRef(false);

  const addAttachments = async (files: File[]) => {
    if (files.length === 0 || disabled || isAttaching || isAttachingRef.current) return;
    isAttachingRef.current = true;
    setIsAttaching(true);
    setAttachmentError('');
    try {
      const prepared: MessageAttachment[] = [];
      const errors: string[] = [];
      let bufferedBytes = attachments.reduce((total, attachment) => total + bufferedAttachmentBytes(attachment), 0);

      // Filter out files that already exist in current attachments or incoming batch
      const seenNames = new Set(attachments.map((a) => `${a.name}-${a.sizeText}`));
      const uniqueFiles = files.filter((f) => {
        const key = `${f.name}-${formatFileSize(f.size)}`;
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

      for (const file of uniqueFiles) {
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
    } finally {
      setIsAttaching(false);
      isAttachingRef.current = false;
      if (fileInputRef.current) fileInputRef.current.value = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
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

      {attachmentError && (
        <p className="pointer-events-auto mb-2 w-full max-w-[620px] px-3 text-[11px] text-red-600" role="alert" data-attachment-error="">
          {attachmentError}
        </p>
      )}

      <div className="w-full max-w-[620px] flex flex-col items-start">
        <div className="mb-2 hidden w-full max-w-[620px] justify-start" data-mode-switcher-row="">
          <ModeSwitcher
            mode={collaborationMode}
            onSelectMode={onSelectCollaborationMode}
            disabled={disabled}
            loading={isChangingCollaborationMode}
          />
        </div>

        <div className="relative w-full max-w-[620px]">
          {(plusMenuOpen || skillMenuOpen) && (
            <div className="absolute bottom-full mb-2.5 inset-x-0 z-30 pointer-events-auto">
              <SkillPicker
                skills={skills}
                query={skillQuery}
                activeIndex={activeSkillIndex}
                collaborationMode={collaborationMode}
                onSelectMode={(mode) => void onSelectCollaborationMode(mode)}
                onSelectSkill={chooseSkill}
                onSelect={chooseSkill}
                onSelectFiles={() => fileInputRef.current?.click()}
                onClose={() => {
                  setPlusMenuOpen(false);
                  setSkillMenuOpen(false);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                isChangingMode={isChangingCollaborationMode}
              />
            </div>
          )}

          <form
        onSubmit={handleSubmit}
        data-composer=""
        data-composer-multiline="true"
        style={{ height: composerHeight }}
        aria-busy={isAttaching}
        className={`pointer-events-auto relative w-full max-w-[620px] overflow-hidden bg-white border grid grid-cols-[30px_minmax(0,1fr)_auto_30px] grid-rows-[minmax(44px,auto)_30px] gap-y-1.5 gap-x-2 items-center rounded-[22px] px-3 pt-2.5 pb-2.5 transition-[height,border-radius,border-color] duration-200 ease-out motion-reduce:transition-none focus-within:border-slate-300 ${
          isDraggingFiles ? 'border-slate-500' : 'border-slate-200/90'
        }`}
      >
        {isDraggingFiles && (
          <div
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[22px] bg-slate-900/[0.03] backdrop-blur-[2px] border-2 border-dashed border-slate-400 text-slate-700 font-medium text-[13px] gap-2 animate-in fade-in duration-150"
            data-composer-drop-overlay=""
          >
            <FileUp className="w-4 h-4 stroke-[2] text-slate-600" />
            <span>Drop files here to attach</span>
          </div>
        )}
        <button
          type="button"
          aria-label="Add attachment, mode, or skill"
          aria-expanded={plusMenuOpen}
          disabled={disabled || isAttaching}
          onClick={() => {
            setPlusMenuOpen((current) => !current);
          }}
          className={`col-start-1 row-start-2 self-end w-[30px] h-[30px] rounded-full flex items-center justify-center active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 ${
            plusMenuOpen
              ? 'bg-slate-200 text-slate-900'
              : 'bg-slate-100/90 hover:bg-slate-200/80 text-[#64748b] hover:text-[#0f172a]'
          }`}
          title="Add attachment, mode, or skill"
        >
          {isAttaching ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin stroke-2" />
          ) : (
            <Plus className="w-3.5 h-3.5 stroke-[2]" />
          )}
        </button>

        <div className="col-span-4 row-start-1 flex flex-col gap-1.5 min-w-0">
          {attachments.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 pt-0.5 pb-0.5 overflow-x-auto"
              data-composer-attachments=""
              aria-label="Attachments"
            >
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group relative flex-none"
                  data-attachment-preview={attachment.kind}
                >
                  {attachment.kind === 'image' && attachment.previewUrl ? (
                    <div className="relative h-[46px] w-[46px] rounded-[14px] overflow-hidden border border-slate-200/90 shadow-[0_1px_3px_rgba(0,0,0,0.04)] bg-slate-100">
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                        className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-black/60 hover:bg-black text-white transition-[background-color] opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <X className="h-2.5 w-2.5 stroke-[2.5]" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-[46px] max-w-[240px] items-center gap-2.5 rounded-[14px] border border-slate-200/90 bg-white px-2.5 py-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-slate-100/90 text-slate-500">
                        {attachment.kind === 'video' ? (
                          <Video className="h-4 w-4 stroke-[1.7]" />
                        ) : attachment.kind === 'text' ? (
                          <FileText className="h-4 w-4 stroke-[1.7]" />
                        ) : (
                          <FileIcon className="h-4 w-4 stroke-[1.7]" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 pr-0.5">
                        <span className="block truncate text-[12.5px] font-medium text-slate-800 leading-snug">{attachment.name}</span>
                        <span className="block text-[11px] text-slate-400 tabular-nums leading-none mt-0.5">{attachment.sizeText}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                        className="grid h-5 w-5 flex-none place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-95 transition-colors"
                      >
                        <X className="h-3.5 w-3.5 stroke-[2]" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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
            }}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              if (!transferHasFiles(event.clipboardData)) return;
              event.preventDefault();
              void addAttachments(filesFromTransfer(event.clipboardData));
            }}
            placeholder={collaborationMode === 'plan' ? 'Plan changes...' : `Message ${agent.name}`}
            disabled={disabled}
            aria-label={collaborationMode === 'plan' ? 'Plan changes...' : `Message ${agent.name}`}
            data-composer-input=""
            className="mt-0.5 overflow-y-auto pl-1 pr-9 py-0 min-w-0 w-full resize-none bg-transparent text-[14px] leading-5 text-[#1e293b] placeholder-[#9ca3af] outline-none disabled:cursor-not-allowed"
          />
        </div>

        {collaborationMode === 'plan' && (
          <span
            className="col-start-2 row-start-2 self-end inline-flex h-[30px] items-center gap-2 rounded-full bg-[#f8ede2] pl-3 pr-2 text-[13px] font-medium text-[#925712] select-none transition-colors justify-self-start"
            data-plan-badge=""
          >
            <ListTree className="h-4 w-4 stroke-[2] text-[#b8782a]" />
            <span>Plan</span>
            <button
              type="button"
              aria-label="Exit Plan mode"
              onClick={(e) => {
                e.stopPropagation();
                void onSelectCollaborationMode('build');
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="grid h-4 w-4 place-items-center rounded-full text-[#925712]/70 hover:bg-[#925712]/15 hover:text-[#925712] active:scale-95 transition-[color,background-color,transform] focus:outline-none"
            >
              <X className="h-3 w-3 stroke-[2.5]" />
            </button>
          </span>
        )}

        <button
          type="button"
          aria-label={isExpanded ? 'Collapse composer' : 'Expand composer'}
          aria-expanded={isExpanded}
          onClick={() => {
            setIsExpanded((current) => !current);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="absolute right-2.5 top-2.5 w-[30px] h-[30px] rounded-full grid place-items-center text-[#94a3b8] hover:text-[#475569] hover:bg-black/[0.035] active:scale-[0.96] transition-[color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
          title={isExpanded ? 'Collapse composer' : 'Expand composer'}
        >
          {isExpanded ? (
            <Minimize2 className="w-3.5 h-3.5 stroke-[1.8]" />
          ) : (
            <Maximize2 className="w-3.5 h-3.5 stroke-[1.8]" />
          )}
        </button>

        <ModelSwitcher
          models={models}
          activeModel={activeModel}
          onSelectModel={onSelectModel}
          disabled={disabled}
          loading={isChangingModel}
          thinkingLevel={thinkingLevel}
          thinkingLevels={thinkingLevels}
          thinkingOptions={thinkingOptions}
          supportsThinking={supportsThinking}
          onSelectThinkingLevel={onSelectThinkingLevel}
          thinkingLoading={isChangingThinking}
          className="col-start-3 row-start-2 self-end justify-self-end"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void onAbort?.();
            }}
            aria-label={t('stopGeneration') || 'Stop'}
            className="col-start-4 row-start-2 self-end w-[30px] h-[30px] rounded-full bg-[#0d0e11] text-white flex items-center justify-center hover:bg-black active:scale-[0.96] transition-[background-color,opacity,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 cursor-pointer"
            title={t('stopGeneration') || 'Stop'}
            data-stop-button=""
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || isAttaching || (!text.trim() && attachments.length === 0)}
            aria-label="Send message"
            className="col-start-4 row-start-2 self-end w-[30px] h-[30px] rounded-full bg-[#0d0e11] text-white flex items-center justify-center hover:bg-black active:scale-[0.96] transition-[background-color,opacity,transform] disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
            title="Send"
          >
            <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" data-send-icon="" />
          </button>
        )}
      </form>
        </div>
      </div>
    </div>
  );
};
