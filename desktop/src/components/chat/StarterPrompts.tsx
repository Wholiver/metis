import React, { useMemo } from 'react';
import { GitCompare, Layers, Bug, TestTube2, ArrowRight } from 'lucide-react';
import { useI18n } from '../../i18n';

export interface StarterPromptsProps {
  hasGitChanges?: boolean;
  visible: boolean;
  onSelectPrompt: (promptText: string) => void;
}

export const StarterPrompts: React.FC<StarterPromptsProps> = React.memo(({
  hasGitChanges = false,
  visible,
  onSelectPrompt,
}) => {
  const { t } = useI18n();

  const items = useMemo(() => {
    const firstItem = hasGitChanges
      ? {
          key: 'review',
          icon: GitCompare,
          iconColor: 'text-sky-500 dark:text-sky-400',
          title: t('starterPromptReviewTitle'),
          desc: t('starterPromptReviewDesc'),
          prompt: t('starterPromptReviewPrompt'),
        }
      : {
          key: 'architecture',
          icon: Layers,
          iconColor: 'text-indigo-500 dark:text-indigo-400',
          title: t('starterPromptArchTitle'),
          desc: t('starterPromptArchDesc'),
          prompt: t('starterPromptArchPrompt'),
        };

    return [
      firstItem,
      {
        key: 'bugs',
        icon: Bug,
        iconColor: 'text-amber-500 dark:text-amber-400',
        title: t('starterPromptBugsTitle'),
        desc: t('starterPromptBugsDesc'),
        prompt: t('starterPromptBugsPrompt'),
      },
      {
        key: 'tests',
        icon: TestTube2,
        iconColor: 'text-emerald-500 dark:text-emerald-400',
        title: t('starterPromptTestsTitle'),
        desc: t('starterPromptTestsDesc'),
        prompt: t('starterPromptTestsPrompt'),
      },
    ];
  }, [hasGitChanges, t]);

  return (
    <div
      className={`pointer-events-auto mb-2.5 flex w-full max-w-[620px] flex-col gap-0.5 px-1 transition-all duration-200 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-1'
      }`}
      data-starter-prompts=""
      aria-hidden={!visible}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelectPrompt(item.prompt)}
          className="group flex w-full items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-left transition-colors duration-150 hover:bg-hover/60 active:scale-[0.99] cursor-pointer select-none"
          data-starter-prompt-item={item.key}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-transform duration-150 group-hover:scale-110 ${item.iconColor}`}
              aria-hidden="true"
            >
              <item.icon size={14} strokeWidth={1.8} />
            </span>
            <span className="shrink-0 text-[13px] font-medium text-ink transition-colors group-hover:text-ink">
              {item.title}
            </span>
            <span className="hidden sm:inline-block text-[12px] text-ink-3 truncate transition-colors group-hover:text-ink-2">
              {item.desc}
            </span>
          </div>
          <span
            className="shrink-0 text-ink-3 opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-70 group-hover:translate-x-0"
            aria-hidden="true"
          >
            <ArrowRight size={13} strokeWidth={1.8} />
          </span>
        </button>
      ))}
    </div>
  );
});

StarterPrompts.displayName = 'StarterPrompts';
