import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileUp, ListTree, X } from 'lucide-react';
import { Agent, CollaborationMode, ContextUsage, MessageAttachment, ModelOption, ProjectItem, SendMessageOptions, ThinkingOption, TokenBreakdown, WorkflowPlanState } from '../../types';
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
import { SkillCommand } from './SkillPicker';
import { WorkProgressIndicator } from './WorkProgressIndicator';
import { WorkflowPlanCard } from './WorkflowPlanCard';
import { WorkProgressState } from '../../lib/work-progress';
import { useI18n } from '../../i18n';
import { RateLimitWindow } from '../inspector/UsageQuotaCard';
import { ComposerUsageFooter } from './ComposerUsageFooter';
import { HomeProjectSwitcher } from './HomeProjectSwitcher';
import { MetisCloudMark } from './MetisCloudMark';
import PromptBar from '../primitives/PromptBar';

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
  isHomeEmpty?: boolean;
  projects?: ProjectItem[];
  activeProject?: ProjectItem;
  onSelectProject?: (id: string) => void | Promise<void>;
  workProgress?: WorkProgressState;
  isWorkIdle?: boolean;
  workflowPlan?: WorkflowPlanState;
  workflowPlanInterrupted?: boolean;
  contextUsage?: ContextUsage;
  tokenBreakdown?: TokenBreakdown;
  isOAuth?: boolean;
  totalCost?: number;
  totalTokens?: number;
  quota5h?: RateLimitWindow;
  quota7d?: RateLimitWindow;
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

export const Composer = React.memo<ComposerProps>(({
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
  isHomeEmpty = false,
  projects = [],
  activeProject,
  onSelectProject,
  workProgress,
  isWorkIdle = false,
  workflowPlan,
  workflowPlanInterrupted = false,
  contextUsage,
  tokenBreakdown,
  isOAuth = false,
  totalCost,
  totalTokens,
  quota5h,
  quota7d,
}) => {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const homeRectRef = useRef<DOMRect | null>(null);
  const prevIsHomeRef = useRef(isHomeEmpty);
  void agent;

  const chooseSkill = (skill: SkillCommand) => {
    setText(`/${skill.name} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (disabled) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [disabled]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const stack = stackRef.current;
    const main = shell?.closest<HTMLElement>('[data-purpose="main-chat"]');
    if (!shell || !main) return;
    let lastHeight = -1;
    let rafId: number | null = null;

    const applyHeight = () => {
      const nextHeight = isHomeEmpty
        ? 0
        : Math.ceil(shell.getBoundingClientRect().height);
      if (Math.abs(nextHeight - lastHeight) >= 1) {
        lastHeight = nextHeight;
        main.style.setProperty('--composer-overlay-height', `${nextHeight}px`);
      }
    };

    applyHeight();

    const updateOverlayHeight = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!main) return;
        applyHeight();
      });
    };

    const observer = new ResizeObserver(updateOverlayHeight);
    observer.observe(shell);
    if (stack) observer.observe(stack);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      main.style.removeProperty('--composer-overlay-height');
    };
  }, [isHomeEmpty]);

  useLayoutEffect(() => {
    if (isHomeEmpty && stackRef.current) {
      homeRectRef.current = stackRef.current.getBoundingClientRect();
    }
  });

  useLayoutEffect(() => {
    const el = stackRef.current;
    const wasHome = prevIsHomeRef.current;
    prevIsHomeRef.current = isHomeEmpty;
    if (!el || !wasHome || isHomeEmpty) return;
    const first = homeRectRef.current;
    if (!first) return;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.transition = 'none';
    void el.offsetWidth;
    el.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = 'translate(0px, 0px)';
    const onEnd = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.removeEventListener('transitionend', onEnd);
    };
    el.addEventListener('transitionend', onEnd);
    return () => {
      el.removeEventListener('transitionend', onEnd);
    };
  }, [isHomeEmpty]);

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

  const handleSubmit = async () => {
    if ((!text.trim() && attachments.length === 0) || disabled || isAttaching) return;
    const draftText = text;
    const draftAttachments = attachments;
    const payload = composeAttachmentPayload(draftText, draftAttachments);
    setText('');
    setAttachments([]);
    setAttachmentError('');
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

  const showPlanStack = collaborationMode === 'build' && Boolean(workflowPlan);

  const modeSwitcherRow = (
    <div className="mb-2 hidden w-full max-w-[620px] justify-start" data-mode-switcher-row="">
      <ModeSwitcher
        mode={collaborationMode}
        onSelectMode={onSelectCollaborationMode}
        disabled={disabled}
        loading={isChangingCollaborationMode}
      />
    </div>
  );

  const promptBar = (
    <PromptBar
      variant="Rounded"
      tall={isHomeEmpty}
      value={text}
      onChange={setText}
      onSubmit={handleSubmit}
      onStop={onAbort}
      isStreaming={isStreaming}
      canSubmit={Boolean(text.trim() || attachments.length > 0)}
      disabled={disabled}
      busy={isAttaching}
      placeholder={t('writeMessagePlaceholder')}
      inputRef={inputRef}
      isDraggingFiles={isDraggingFiles}
      stopLabel={t('stopGeneration') || 'Stop'}
      onDragEnter={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setIsDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        if (!transferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setIsDraggingFiles(false);
        const files = filesFromTransfer(event.dataTransfer);
        if (files.length > 0) void addAttachments(files);
      }}
      models={models}
      activeModel={activeModel}
      onSelectModel={onSelectModel}
      skills={skills}
      onSelectSkill={chooseSkill}
      collaborationMode={collaborationMode}
      onSelectCollaborationMode={onSelectCollaborationMode}
      isChangingCollaborationMode={isChangingCollaborationMode}
      attachments={attachments}
      onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
      onSelectFiles={() => fileInputRef.current?.click()}
      trailingSlot={(
        <>
          {collaborationMode === 'plan' && (
            <span
              className="inline-flex h-7 items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--orange)_14%,transparent)] pl-3 pr-2 text-[13px] font-medium leading-7 text-[color-mix(in_srgb,var(--orange)_85%,var(--ink))] select-none"
              data-plan-badge=""
            >
              <ListTree className="h-4 w-4 stroke-[2]" />
              <span>Plan</span>
              <button
                type="button"
                aria-label={t('reactUiExitPlanMode')}
                onClick={(event) => {
                  event.stopPropagation();
                  void onSelectCollaborationMode('build');
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="grid h-4 w-4 place-items-center rounded-full transition-colors hover:bg-hover"
              >
                <X className="h-3 w-3 stroke-[2.5]" />
              </button>
            </span>
          )}
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
          />
        </>
      )}
      dropOverlay={isDraggingFiles ? (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[14px] bg-ink/[0.02] backdrop-blur-[1px] border border-dashed border-line-strong text-ink font-medium text-[13px] gap-2"
          data-composer-drop-overlay=""
        >
          <FileUp className="w-4 h-4 stroke-[2] text-ink-2" />
          <span>Drop files here to attach</span>
        </div>
      ) : undefined}
      inputProps={{
        onPaste: (event) => {
          if (!transferHasFiles(event.clipboardData)) return;
          event.preventDefault();
          void addAttachments(filesFromTransfer(event.clipboardData));
        },
        'aria-label': t('promptAria'),
      }}
    />
  );

  return (
    <div
      ref={shellRef}
      className={`pointer-events-none absolute z-20 flex w-full flex-col items-center bg-transparent px-4 ${
        isHomeEmpty
          ? 'inset-0 justify-center pb-8 pt-6'
          : 'inset-x-0 bottom-0 justify-center pb-3 pt-1'
      }`}
      data-composer-shell=""
      data-composer-home={isHomeEmpty ? 'true' : undefined}
    >
      {!isHomeEmpty ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 -top-7 -z-10 bg-gradient-to-t from-[var(--page)] from-75% via-[color-mix(in_srgb,var(--page)_95%,transparent)] to-transparent"
          data-composer-fade-mask=""
        />
      ) : null}
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
        <p className="pointer-events-auto mb-2 w-full max-w-[620px] px-3 text-[11px] text-red" role="alert" data-attachment-error="">
          {attachmentError}
        </p>
      )}

      <div
        className={`flex w-full max-w-[620px] flex-col ${
          isHomeEmpty ? 'items-center' : 'items-start'
        }`}
      >
        {isHomeEmpty ? (
          <div
            className="mb-5 flex shrink-0 select-none items-center justify-center"
            data-home-cloud-slot=""
            aria-hidden="true"
          >
            <MetisCloudMark size={68} />
          </div>
        ) : null}

        {workProgress && !isWorkIdle && !isHomeEmpty && (
          <div className="pointer-events-auto mb-2 flex items-center px-1" data-composer-progress-slot="">
            <WorkProgressIndicator progress={workProgress} idle={false} />
          </div>
        )}
        {modeSwitcherRow}

        <div
          ref={stackRef}
          className="pointer-events-auto relative flex w-full max-w-[620px] flex-col will-change-transform"
          data-composer-stack={showPlanStack ? '' : undefined}
          data-composer-dock-stack=""
        >
          {showPlanStack && workflowPlan ? (
            <div className="w-full" data-composer-plan-slot="">
              <WorkflowPlanCard plan={workflowPlan} interrupted={workflowPlanInterrupted} />
            </div>
          ) : null}
          <div className={`relative w-full ${showPlanStack ? 'z-10 -mt-[14px]' : ''}`} data-composer-input-layer={showPlanStack ? '' : undefined}>
            {promptBar}
          </div>
          {!isHomeEmpty ? (
            <ComposerUsageFooter
              isOAuth={isOAuth}
              totalCost={totalCost}
              totalTokens={totalTokens}
              quota5h={quota5h}
              quota7d={quota7d}
              contextUsage={contextUsage}
              tokenBreakdown={tokenBreakdown}
            />
          ) : null}
        </div>

        {isHomeEmpty ? (
          <div className="mt-3 flex w-full justify-center" data-home-project-slot="">
            <HomeProjectSwitcher
              projects={projects}
              activeProject={activeProject}
              onSelectProject={onSelectProject}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

Composer.displayName = 'Composer';
