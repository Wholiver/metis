import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  ExternalLink,
  Folder,
  CalendarClock,
  Loader2,
  CheckCircle2,
  XCircle,
  PanelLeftOpen,
  Coffee,
  CheckCheck,
  ShieldCheck,
} from 'lucide-react';
import { ProjectItem, RoutineItem } from '../../types';
import { useI18n } from '../../i18n';
import { isMac } from '../../lib/platform';
import { describeCron } from '../../lib/cron-utils';
import { Button } from '../atoms/Button';
import ApprovalDialog from '../primitives/ApprovalDialog';
import { RoutineEditModal } from './RoutineEditModal';

interface RoutinesManagerProps {
  projects?: ProjectItem[];
  activeProjectPath?: string;
  onClose: () => void;
  onSelectSession?: (sessionId: string, projectPath?: string) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
}

type RoutineTemplate = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  cron: string;
  timeLabel: string;
  desc: string;
  prompt: string;
};

function TemplateRows({
  templates,
  onApply,
  useTemplateLabel,
}: {
  templates: RoutineTemplate[];
  onApply: (template: RoutineTemplate) => void;
  useTemplateLabel: string;
}) {
  return (
    <div className="flex flex-col" data-routine-templates="">
      {templates.map((tpl) => {
        const IconComponent = tpl.icon;
        return (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onApply(tpl)}
            className="group flex w-full items-start gap-3 rounded-[12px] px-3 py-3 text-left transition-colors hover:bg-hover active:scale-[0.99]"
            data-routine-template={tpl.id}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-inset text-ink-2 group-hover:text-ink">
              <IconComponent className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-[14px] font-medium text-ink">{tpl.title}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{tpl.timeLabel}</span>
              </span>
              <span className="mt-0.5 block text-[13px] leading-5 text-ink-3 line-clamp-1">
                {tpl.desc}
              </span>
            </span>
            <span className="mt-1 shrink-0 text-[12px] font-medium text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
              {useTemplateLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function iconForRoutine(title: string, templates: RoutineTemplate[]) {
  const match = templates.find((tpl) => tpl.title === title);
  return match?.icon || CalendarClock;
}

export const RoutinesManager: React.FC<RoutinesManagerProps> = ({
  projects = [],
  activeProjectPath = '',
  onClose: _onClose,
  onSelectSession,
  isSidebarOpen = true,
  onToggleSidebar,
  onNewChat,
}) => {
  const { t, language } = useI18n();
  const isZh = language?.startsWith('zh');

  const tr = useCallback((key: string, zhText: string, enText: string): string => {
    const val = t(key);
    if (!val || val === key) {
      return isZh ? zhText : enText;
    }
    return val;
  }, [t, isZh]);

  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [runningRoutineIds, setRunningRoutineIds] = useState<Set<string>>(new Set());
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<RoutineItem | Partial<RoutineItem> | null>(null);
  const [deletingRoutineId, setDeletingRoutineId] = useState<string | null>(null);

  const fetchRoutines = useCallback(async () => {
    const desktop = (window as any).metisDesktop;
    if (desktop?.routines?.list) {
      try {
        const res = await desktop.routines.list();
        if (Array.isArray(res)) {
          setRoutines(res);
        } else if (res?.ok && Array.isArray(res.routines)) {
          setRoutines(res.routines);
        }
      } catch (err) {
        console.error('Failed to load routines:', err);
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoutines();
    const desktop = (window as any).metisDesktop;
    let unsubscribe: (() => void) | undefined;
    if (desktop?.routines?.onUpdated) {
      unsubscribe = desktop.routines.onUpdated(() => {
        void fetchRoutines();
      });
    }

    const interval = setInterval(() => {
      void fetchRoutines();
    }, 30000);

    return () => {
      unsubscribe?.();
      clearInterval(interval);
    };
  }, [fetchRoutines]);

  const activeCount = useMemo(() => routines.filter((r) => r.status === 'active').length, [routines]);

  const handleToggleExpandPrompt = (id: string) => {
    setExpandedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenCreateModal = () => {
    setEditingRoutine(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (routine: RoutineItem) => {
    setEditingRoutine(routine);
    setIsModalOpen(true);
  };

  const handleApplyTemplate = (template: { title: string; cron: string; prompt: string }) => {
    setEditingRoutine({
      title: template.title,
      cron: template.cron,
      prompt: template.prompt,
      projectPath: activeProjectPath,
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const handleSaveRoutine = async (payload: {
    id?: string;
    title: string;
    cron: string;
    prompt: string;
    projectPath?: string;
    status: 'active' | 'paused';
    source?: 'manual' | 'self_learning';
  }) => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.routines) return;

    if (payload.id) {
      await desktop.routines.update(payload.id, {
        title: payload.title,
        cron: payload.cron,
        prompt: payload.prompt,
        projectPath: payload.projectPath,
        status: payload.status,
        source: payload.source,
      });
    } else {
      await desktop.routines.create({
        title: payload.title,
        cron: payload.cron,
        prompt: payload.prompt,
        projectPath: payload.projectPath,
        status: payload.status,
        source: payload.source,
      });
    }
    await fetchRoutines();
  };

  const handleToggleStatus = async (routine: RoutineItem) => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.routines?.update) return;

    const nextStatus = routine.status === 'active' ? 'paused' : 'active';
    await desktop.routines.update(routine.id, { status: nextStatus });
    await fetchRoutines();
  };

  const handleDeleteRoutine = (id: string) => {
    setDeletingRoutineId(id);
  };

  const handleConfirmDeleteRoutine = async () => {
    if (!deletingRoutineId) return;
    const desktop = (window as any).metisDesktop;
    if (desktop?.routines?.delete) {
      await desktop.routines.delete(deletingRoutineId);
      await fetchRoutines();
    }
    setDeletingRoutineId(null);
  };

  const handleRunNow = async (routine: RoutineItem) => {
    const desktop = (window as any).metisDesktop;
    if (!desktop?.routines?.runNow) return;

    setRunningRoutineIds((prev) => new Set(prev).add(routine.id));
    try {
      const res = await desktop.routines.runNow(routine.id);
      await fetchRoutines();
      if (res?.ok && res?.sessionId && onSelectSession) {
        onSelectSession(res.sessionId, routine.projectPath);
      }
    } catch (err) {
      console.error('Failed to run routine now:', err);
    } finally {
      setRunningRoutineIds((prev) => {
        const next = new Set(prev);
        next.delete(routine.id);
        return next;
      });
    }
  };

  const templates = useMemo<RoutineTemplate[]>(() => [
    {
      id: 'morning',
      icon: Coffee,
      title: t('routineTemplateMorning') || '早间代码简报',
      cron: '0 9 * * 1-5',
      timeLabel: describeCron('0 9 * * 1-5', language),
      desc: t('routineTemplateMorningDesc') || '汇总最新提交与待办 PR',
      prompt: t('routineTemplateMorningPrompt') || '检查仓库最近 24 小时的提交和打开的 PR，整理今日需要关注的变更、未完成任务与待办事项。',
    },
    {
      id: 'evening',
      icon: CheckCheck,
      title: t('routineTemplateEvening') || '下班整理与同步',
      cron: '0 18 * * 1-5',
      timeLabel: describeCron('0 18 * * 1-5', language),
      desc: t('routineTemplateEveningDesc') || '检查未提交修改并梳理进展',
      prompt: t('routineTemplateEveningPrompt') || '检查当前工作区的 git status，分析未提交代码，整理今日完成的功能清单，并提示是否需要提交或暂存。',
    },
    {
      id: 'hourly',
      icon: ShieldCheck,
      title: t('routineTemplateHourly') || '每小时构建巡检',
      cron: '0 * * * *',
      timeLabel: describeCron('0 * * * *', language),
      desc: t('routineTemplateHourlyDesc') || '自动化运行测试与代码巡检',
      prompt: t('routineTemplateHourlyPrompt') || '执行项目测试套件和语法检查，如果发现任何报错，定位错误源头并给出详细修复建议。',
    },
  ], [t, language]);

  const availableTemplates = useMemo(() => {
    const existing = new Set(routines.map((r) => r.title.trim().toLowerCase()));
    return templates.filter((tpl) => !existing.has(tpl.title.trim().toLowerCase()));
  }, [routines, templates]);

  const useTemplateLabel = tr('useTemplate', '使用', 'Use');
  const isEmpty = !isLoading && routines.length === 0;

  return (
    <div className="flex h-full flex-1 select-none flex-col overflow-hidden bg-canvas" data-routines-manager="">
      {/* Top header — same quiet titlebar as Chat / Workflow */}
      <div
        className={`titlebar-drag flex h-[50px] shrink-0 items-center justify-between border-b border-transparent ${
          !isSidebarOpen ? 'px-3.5' : 'pl-6 pr-3.5'
        }`}
      >
        <div className="no-drag flex min-w-0 items-center gap-2">
          {!isSidebarOpen && (
            <>
              {isMac && <div className="h-[16px] w-[66px]" />}
              <button
                type="button"
                onClick={onToggleSidebar}
                className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                title="Open Sidebar"
              >
                <PanelLeftOpen className="h-4 w-4 stroke-[1.8]" />
              </button>
              {onNewChat && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                  title="New Chat"
                >
                  <Plus className="h-4 w-4 stroke-[2]" />
                </button>
              )}
            </>
          )}
          <h1 className="truncate text-[14px] font-medium text-ink">
            {tr('routines', '例行任务', 'Routines')}
          </h1>
          {routines.length > 0 && (
            <span className="ml-1 text-[13px] tabular-nums text-ink-3">
              {(t('routineCountSummary') || '{total} routines · {active} active')
                .replace('{total}', String(routines.length))
                .replace('{active}', String(activeCount))}
            </span>
          )}
        </div>

        <div className="no-drag flex items-center gap-2">
          {/* Single primary CTA — never duplicated in empty state body */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenCreateModal}
            data-new-routine-button=""
            {...(isEmpty ? { 'data-create-first-routine': '' } : {})}
          >
            <Plus className="h-3.5 w-3.5 stroke-[2]" />
            <span>{t('newRoutine') || 'New routine'}</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center text-ink-3">
          <Loader2 className="mb-2 h-5 w-5 animate-spin" />
          <span className="text-[14px]">{t('loadingRoutines') || 'Loading routines...'}</span>
        </div>
      ) : isEmpty ? (
        <div
          className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 text-center"
          data-routines-empty=""
        >
          <div className="flex w-full max-w-[480px] flex-col items-center pb-16">
            <CalendarClock className="h-6 w-6 stroke-[1.7] text-ink-3" aria-hidden="true" />
            <h2 className="mt-4 text-[14px] font-medium tracking-tight text-ink text-balance">
              {t('noRoutinesTitle') || 'No routines yet'}
            </h2>
            <p className="mt-2 max-w-[360px] text-[14px] font-normal leading-6 text-ink-3 text-pretty">
              {t('noRoutinesDesc') || 'Set a time and a prompt. Metis opens a chat and runs it automatically.'}
            </p>

            <div className="mt-8 w-full text-left">
              <div className="mb-1.5 px-3 text-[13px] text-ink-3">
                {t('routineTemplates') || 'Or start from a common one'}
              </div>
              <TemplateRows
                templates={templates}
                onApply={handleApplyTemplate}
                useTemplateLabel={useTemplateLabel}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-8">
          <div className="mx-auto w-full max-w-[720px]">
            <div className="space-y-1">
              {routines.map((routine) => {
                const isRunning = runningRoutineIds.has(routine.id) || routine.lastStatus === 'running';
                const isExpanded = expandedPromptIds.has(routine.id);
                const humanCron = describeCron(routine.cron, language);
                const nextDate = routine.nextRunAt ? new Date(routine.nextRunAt) : null;
                const lastDate = routine.lastRunAt ? new Date(routine.lastRunAt) : null;
                const IconComp = iconForRoutine(routine.title, templates);

                return (
                  <div
                    key={routine.id}
                    className="group rounded-[12px] px-3.5 py-3.5 transition-colors hover:bg-hover/70"
                    data-routine-item={routine.id}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-inset text-ink-2">
                        <IconComp className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <h3 className="truncate text-[14px] font-medium text-ink">
                                {routine.title}
                              </h3>
                              {routine.source === 'self_learning' && (
                                <span
                                  className="inline-flex shrink-0 items-center rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                                  data-routine-source="self_learning"
                                >
                                  {tr('routineSourceSelfLearning', 'AI 学习生成', 'AI Generated')}
                                </span>
                              )}
                              {routine.projectPath && (
                                <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ink-3">
                                  <Folder className="h-3.5 w-3.5" />
                                  {routine.projectPath.split('/').pop() || routine.projectPath}
                                </span>
                              )}
                            </div>
                            <p
                              className={`mt-1.5 cursor-pointer text-[13.5px] leading-6 text-ink-3 transition-colors hover:text-ink-2 ${
                                isExpanded ? 'whitespace-pre-wrap text-ink-2' : 'line-clamp-2'
                              }`}
                              onClick={() => handleToggleExpandPrompt(routine.id)}
                              title={isExpanded ? '' : routine.prompt}
                            >
                              {routine.prompt}
                            </p>
                          </div>

                          <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-ink-3">
                            {humanCron}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2 text-[12px]">
                          <div className="flex min-w-0 flex-wrap items-center gap-2 text-ink-3">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(routine)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
                                routine.status === 'active'
                                  ? 'bg-green/10 text-green hover:bg-green/20'
                                  : 'bg-hover-2 text-ink-3 hover:bg-hover hover:text-ink'
                              }`}
                              title={
                                routine.status === 'active'
                                  ? tr('pauseRoutine', '点击暂停排期', 'Pause schedule')
                                  : tr('resumeRoutine', '点击恢复排期', 'Resume schedule')
                              }
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  routine.status === 'active' ? 'bg-green' : 'bg-ink-4'
                                }`}
                              />
                              <span>
                                {routine.status === 'active'
                                  ? tr('routineActive', '启用中', 'Active')
                                  : tr('routinePaused', '已暂停', 'Paused')}
                              </span>
                            </button>

                            {nextDate && routine.status === 'active' && (
                              <span className="hidden tabular-nums sm:inline">
                                {tr('nextRun', '下次', 'Next')}:{' '}
                                {nextDate.toLocaleString(language, {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}

                            {lastDate && (
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                {routine.lastStatus === 'success' && (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green" />
                                )}
                                {routine.lastStatus === 'failed' && (
                                  <XCircle className="h-3.5 w-3.5 text-red" />
                                )}
                                <span>
                                  {lastDate.toLocaleTimeString(language, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                {routine.lastSessionId && onSelectSession && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onSelectSession(routine.lastSessionId!, routine.projectPath)
                                    }
                                    className="ml-0.5 inline-flex items-center gap-0.5 font-medium text-ink hover:underline"
                                  >
                                    <span>{tr('jumpToSession', '查看会话', 'Chat')}</span>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => handleRunNow(routine)}
                              disabled={isRunning}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink active:scale-[0.96] disabled:opacity-50"
                              title={tr('runNow', '立即运行', 'Run now')}
                            >
                              {isRunning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-ink" />
                              ) : (
                                <Play className="h-3 w-3 fill-current" />
                              )}
                              <span>
                                {isRunning
                                  ? tr('running', '运行中...', 'Running...')
                                  : tr('runNow', '立即运行', 'Run now')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(routine)}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                              title={tr('editRoutine', '编辑', 'Edit')}
                            >
                              <Pencil className="h-4 w-4 stroke-[1.8]" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteRoutine(routine.id)}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-red"
                              title={tr('deleteRoutine', '删除', 'Delete')}
                            >
                              <Trash2 className="h-4 w-4 stroke-[1.8]" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {availableTemplates.length > 0 && (
              <div className="mt-6 border-t border-line/50 pt-4">
                <div className="mb-1.5 px-3 text-[13px] text-ink-3">
                  {tr('routineTemplates', '从常用开始', 'Start from a common one')}
                </div>
                <TemplateRows
                  templates={availableTemplates}
                  onApply={handleApplyTemplate}
                  useTemplateLabel={useTemplateLabel}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <RoutineEditModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveRoutine}
        editingRoutine={editingRoutine}
        projects={projects}
        currentProjectPath={activeProjectPath}
      />

      <ApprovalDialog
        open={Boolean(deletingRoutineId)}
        title={tr('deleteRoutine', '删除例行任务', 'Delete routine')}
        message={tr(
          'deleteRoutineConfirm',
          '确定要删除此例行任务吗？',
          'Are you sure you want to delete this routine?',
        )}
        confirmLabel={tr('delete', '删除', 'Delete')}
        cancelLabel={tr('cancel', '取消', 'Cancel')}
        danger
        onCancel={() => setDeletingRoutineId(null)}
        onConfirm={handleConfirmDeleteRoutine}
      />
    </div>
  );
};
