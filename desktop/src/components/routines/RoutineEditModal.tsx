import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, CalendarClock, AlertCircle, Folder } from 'lucide-react';
import { ProjectItem, RoutineItem } from '../../types';
import { useI18n } from '../../i18n';
import { CRON_PRESETS, getNextRunTime, isValidCron } from '../../lib/cron-utils';
import { Button } from '../atoms/Button';

interface RoutineEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    title: string;
    cron: string;
    prompt: string;
    projectPath?: string;
    status: 'active' | 'paused';
    source?: 'manual' | 'self_learning';
  }) => Promise<void>;
  editingRoutine?: RoutineItem | Partial<RoutineItem> | null;
  projects?: ProjectItem[];
  currentProjectPath?: string;
}

type PeriodType = 'weekdays' | 'daily' | 'weekly-mon' | 'weekly-fri' | 'hourly' | 'every-30m' | 'custom';

function parseCronToPeriodAndTime(cronStr: string): { period: PeriodType; time: string } {
  const trimmed = cronStr.trim();
  if (trimmed === '0 * * * *') {
    return { period: 'hourly', time: '09:00' };
  }
  if (trimmed === '*/30 * * * *' || trimmed === '0,30 * * * *') {
    return { period: 'every-30m', time: '09:00' };
  }
  const weekdaysMatch = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+1-5$/);
  if (weekdaysMatch) {
    const m = weekdaysMatch[1].padStart(2, '0');
    const h = weekdaysMatch[2].padStart(2, '0');
    return { period: 'weekdays', time: `${h}:${m}` };
  }
  const dailyMatch = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const m = dailyMatch[1].padStart(2, '0');
    const h = dailyMatch[2].padStart(2, '0');
    return { period: 'daily', time: `${h}:${m}` };
  }
  const weeklyMonMatch = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+1$/);
  if (weeklyMonMatch) {
    const m = weeklyMonMatch[1].padStart(2, '0');
    const h = weeklyMonMatch[2].padStart(2, '0');
    return { period: 'weekly-mon', time: `${h}:${m}` };
  }
  const weeklyFriMatch = trimmed.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+5$/);
  if (weeklyFriMatch) {
    const m = weeklyFriMatch[1].padStart(2, '0');
    const h = weeklyFriMatch[2].padStart(2, '0');
    return { period: 'weekly-fri', time: `${h}:${m}` };
  }
  return { period: 'custom', time: '09:00' };
}

function buildCron(p: PeriodType, t: string, currentCustomCron: string): string {
  if (p === 'custom') return currentCustomCron;
  if (p === 'hourly') return '0 * * * *';
  if (p === 'every-30m') return '*/30 * * * *';
  const [hourStr, minStr] = (t || '09:00').split(':');
  const parsedH = parseInt(hourStr || '9', 10);
  const parsedM = parseInt(minStr || '0', 10);
  const h = Number.isNaN(parsedH) ? 9 : Math.max(0, Math.min(23, parsedH));
  const m = Number.isNaN(parsedM) ? 0 : Math.max(0, Math.min(59, parsedM));
  if (p === 'weekdays') return `${m} ${h} * * 1-5`;
  if (p === 'daily') return `${m} ${h} * * *`;
  if (p === 'weekly-mon') return `${m} ${h} * * 1`;
  if (p === 'weekly-fri') return `${m} ${h} * * 5`;
  return `${m} ${h} * * 1-5`;
}

const controlClass =
  'h-10 w-full rounded-control border border-line bg-field px-3.5 text-[14px] text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50';
const selectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-control border border-line bg-field bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2364748b%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center] pl-3.5 pr-8 text-[14px] text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50';
const textareaClass =
  'w-full resize-none rounded-control border border-line bg-field p-3.5 text-[14px] leading-6 text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)] disabled:cursor-not-allowed disabled:opacity-50';

export const RoutineEditModal: React.FC<RoutineEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingRoutine,
  projects = [],
  currentProjectPath = '',
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

  const [title, setTitle] = useState('');
  const [cron, setCron] = useState('0 9 * * 1-5');
  const [prompt, setPrompt] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [status, setStatus] = useState<'active' | 'paused'>('active');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<PeriodType>('weekdays');
  const [time, setTime] = useState('09:00');

  useEffect(() => {
    if (editingRoutine) {
      const initialCron = editingRoutine.cron || '0 9 * * 1-5';
      setTitle(editingRoutine.title || '');
      setCron(initialCron);
      setPrompt(editingRoutine.prompt || '');
      setProjectPath(
        editingRoutine.projectPath !== undefined
          ? editingRoutine.projectPath
          : currentProjectPath || (projects[0]?.path ?? ''),
      );
      setStatus(editingRoutine.status || 'active');

      const parsed = parseCronToPeriodAndTime(initialCron);
      setPeriod(parsed.period);
      setTime(parsed.time);
    } else {
      setTitle('');
      setCron('0 9 * * 1-5');
      setPrompt('');
      setProjectPath(currentProjectPath || (projects[0]?.path ?? ''));
      setStatus('active');
      setPeriod('weekdays');
      setTime('09:00');
    }
    setError(null);
  }, [editingRoutine, isOpen, currentProjectPath, projects]);

  const handlePeriodChange = useCallback(
    (newPeriod: PeriodType) => {
      setPeriod(newPeriod);
      if (newPeriod !== 'custom') {
        setCron(buildCron(newPeriod, time, cron));
      }
    },
    [time, cron],
  );

  const handleTimeChange = useCallback(
    (newTime: string) => {
      setTime(newTime);
      if (period !== 'custom') {
        setCron(buildCron(period, newTime, cron));
      }
    },
    [period, cron],
  );

  const cronValid = useMemo(() => isValidCron(cron), [cron]);

  const nextRunDate = useMemo(() => {
    if (!cronValid) return null;
    return getNextRunTime(cron, new Date());
  }, [cron, cronValid]);

  if (!isOpen) return null;

  const isEditing = Boolean((editingRoutine as RoutineItem)?.id);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) {
      setError(tr('routineTitleRequired', '任务名称不能为空', 'Routine title is required'));
      return;
    }
    if (!cronValid) {
      setError(
        tr(
          'invalidCronError',
          '无效的 5 段 Cron 表达式',
          'Invalid cron expression (must be standard 5 fields)',
        ),
      );
      return;
    }
    if (!prompt.trim()) {
      setError(tr('routinePromptRequired', '任务指令不能为空', 'Prompt instruction is required'));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSave({
        id: (editingRoutine as RoutineItem)?.id,
        title: title.trim(),
        cron: cron.trim(),
        prompt: prompt.trim(),
        projectPath: projectPath.trim() || undefined,
        status,
        source: (editingRoutine as RoutineItem)?.source,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save routine');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedProject = projects.find((p) => p.path === projectPath);

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-ink/30 p-5 backdrop-blur-[3px] animate-fade-in"
      onClick={onClose}
      data-routine-edit-modal=""
    >
      <div
        className="flex max-h-[min(720px,calc(100vh-40px))] w-[min(540px,calc(100vw-32px))] flex-col overflow-hidden rounded-window bg-surface shadow-overlay"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-edit-title"
      >
        {/* Header — one close control (X); no Cancel duplicate */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-inset text-ink-2">
              <CalendarClock className="h-4 w-4 stroke-[1.8]" />
            </span>
            <div className="min-w-0">
              <h2
                id="routine-edit-title"
                className="truncate text-[15px] font-medium tracking-tight text-ink"
              >
                {isEditing
                  ? tr('editRoutineModal', '编辑例行任务', 'Edit Routine')
                  : tr('newRoutineModal', '新建例行任务', 'New Routine')}
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-3">
                {tr(
                  'routineModalHint',
                  '到点后 Metis 会开对话并执行指令',
                  'Metis opens a chat and runs the prompt on schedule',
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus)]"
            title={tr('close', '关闭', 'Close')}
            aria-label={tr('close', '关闭', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-[14px]">
            {error && (
              <div className="flex items-center gap-2 rounded-[10px] border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('routineTitle', '任务名称', 'Routine title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tr(
                  'routineDailyCodeReview',
                  '例如：早间代码简报',
                  'e.g. Morning code briefing',
                )}
                className={controlClass}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('routineProject', '目标项目', 'Target project')}
              </label>
              <div className="relative">
                <Folder className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <select
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  className={`${selectClass} pl-10`}
                  title={selectedProject?.path || projectPath}
                >
                  <option value="">
                    {tr('defaultWorkspace', '当前工作区', 'Default workspace')}
                  </option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.path}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('scheduleFrequency', '执行周期', 'Schedule')}
                  </label>
                  <select
                    value={period}
                    onChange={(e) => handlePeriodChange(e.target.value as PeriodType)}
                    className={selectClass}
                  >
                    <option value="weekdays">
                      {tr('frequencyWeekdays', '工作日', 'Weekdays')}
                    </option>
                    <option value="daily">{tr('frequencyDaily', '每天', 'Every day')}</option>
                    <option value="weekly-mon">
                      {tr('frequencyWeeklyMon', '每周一', 'Every Monday')}
                    </option>
                    <option value="weekly-fri">
                      {tr('frequencyWeeklyFri', '每周五', 'Every Friday')}
                    </option>
                    <option value="hourly">{tr('presetHourly', '每小时整点', 'Every hour')}</option>
                    <option value="every-30m">
                      {tr('presetEvery30m', '每 30 分钟', 'Every 30 minutes')}
                    </option>
                    <option value="custom">
                      {tr('customCron', '自定义 Cron…', 'Custom Cron')}
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {period === 'custom'
                      ? tr('cronExpression', 'Cron 表达式', 'Cron expression')
                      : tr('triggerTime', '触发时间', 'Time')}
                  </label>
                  {period === 'custom' ? (
                    <input
                      type="text"
                      value={cron}
                      onChange={(e) => setCron(e.target.value)}
                      placeholder="0 9 * * 1-5"
                      className={`${controlClass} font-mono`}
                    />
                  ) : period === 'hourly' || period === 'every-30m' ? (
                    <div className="flex h-10 items-center rounded-control border border-line bg-inset px-3.5 text-[13px] text-ink-3">
                      {period === 'hourly'
                        ? tr('onTheHour', '整点触发', 'On the hour')
                        : tr('at00and30', '00 / 30 分', 'At :00 and :30')}
                    </div>
                  ) : (
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => handleTimeChange(e.target.value)}
                      className={controlClass}
                    />
                  )}
                </div>
              </div>

              {period === 'custom' && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {CRON_PRESETS.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setCron(p.cron)}
                      className="rounded-full bg-hover-2 px-2.5 py-1 text-[12px] text-ink-3 transition-colors hover:text-ink"
                    >
                      {isZh ? p.labelZh : p.labelEn}
                    </button>
                  ))}
                </div>
              )}

              {/* Only next run — do not restate the schedule already chosen above */}
              <div className="pt-0.5 text-[13px] text-ink-3">
                {!cronValid ? (
                  <span className="text-red">
                    {tr('invalidCron', '无效的 Cron 表达式', 'Invalid cron')}
                  </span>
                ) : nextRunDate ? (
                  <span className="tabular-nums">
                    {tr('nextRun', '下次执行', 'Next run')}{' '}
                    {nextRunDate.toLocaleString(language, {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('taskPromptInstruction', '到点执行的指令', 'Prompt to run')}
              </label>
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={tr(
                  'promptInstructionPlaceholder',
                  '例如：汇总最近提交与待办 PR…',
                  'e.g. Summarize recent commits and open PRs…',
                )}
                className={textareaClass}
              />
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={status === 'active'}
              onClick={() => setStatus(status === 'active' ? 'paused' : 'active')}
              className="flex w-full items-center justify-between rounded-[12px] px-1.5 py-1.5 text-left transition-colors hover:bg-hover/60"
            >
              <span>
                <span className="block text-[14px] font-medium text-ink">
                  {tr('enableRoutineNow', '保存后启用', 'Enable after save')}
                </span>
                <span className="mt-0.5 block text-[12px] text-ink-3">
                  {status === 'active'
                    ? tr('routineActive', '启用中', 'Active')
                    : tr('routinePaused', '已暂停', 'Paused')}
                </span>
              </span>
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  status === 'active' ? 'bg-ink' : 'bg-line-strong'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-canvas shadow-sm transition ${
                    status === 'active' ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Footer — single primary action; dismiss via X / overlay */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line/60 px-6 py-3.5">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting || !cronValid || !title.trim() || !prompt.trim()}
              data-save-routine=""
            >
              {isSubmitting
                ? tr('running', '保存中…', 'Saving…')
                : tr('saveRoutineModal', '保存', 'Save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
