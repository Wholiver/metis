import React, { useState, useEffect, useCallback } from 'react';
import { X, Shield, Bot, AlertCircle } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Button } from '../atoms/Button';
import {
  HARNESS_AVAILABLE_TOOLS,
  COMMON_DEV_TOOLS,
  type HarnessCheck,
} from '../../types/harness';

interface HarnessAddNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: 'gate' | 'role';
  onAddGate: (payload: {
    id: string;
    name: string;
    rubric: string;
    checks: HarnessCheck[];
    onFail: 'block' | string;
  }) => void;
  onAddRole: (payload: {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    model?: string;
    thinking?: string;
  }) => void;
  availableNodeIds?: string[];
  availableModels?: Array<{ id: string; name?: string }>;
}

const controlClass =
  'h-9 w-full rounded-control border border-line bg-field px-3 text-[13px] text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]';
const selectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-control border border-line bg-field bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2364748b%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center] pl-3 pr-8 text-[13px] text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]';
const textareaClass =
  'w-full resize-none rounded-control border border-line bg-field p-3 text-[13px] leading-relaxed text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]';

export const HarnessAddNodeModal: React.FC<HarnessAddNodeModalProps> = ({
  isOpen,
  onClose,
  initialType = 'gate',
  onAddGate,
  onAddRole,
  availableNodeIds = [],
  availableModels = [],
}) => {
  const { t, language } = useI18n();
  const isZh = language?.startsWith('zh');

  const tr = useCallback(
    (key: string, zhText: string, enText: string): string => {
      const val = t(key);
      if (!val || val === key) {
        return isZh ? zhText : enText;
      }
      return val;
    },
    [t, isZh]
  );

  // Common fields
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Gate specific fields
  const [rubric, setRubric] = useState('');
  const [checkCommand, setCheckCommand] = useState('');
  const [failStrategy, setFailStrategy] = useState<'block' | 'loop-to'>('block');
  const [loopToTarget, setLoopToTarget] = useState('');

  // Role specific fields
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('inherit');
  const [thinking, setThinking] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>(['read', 'edit', 'write', 'bash']);

  // Reset fields on open
  useEffect(() => {
    if (isOpen) {
      setName('');
      setRubric('');
      setCheckCommand('');
      setFailStrategy('block');
      setLoopToTarget(availableNodeIds[0] || '');
      setDescription('');
      setSystemPrompt('');
      setModel('inherit');
      setThinking('');
      setSelectedTools(['read', 'edit', 'write', 'bash']);
      setError(null);
    }
  }, [isOpen, initialType, availableNodeIds]);

  if (!isOpen) return null;

  const toggleTool = (tool: string) => {
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(
        initialType === 'gate'
          ? tr('harnessGateNameRequired', '请输入质量门名称', 'Gate name is required')
          : tr('harnessRoleNameRequired', '请输入代理角色名称', 'Role name is required')
      );
      return;
    }

    if (initialType === 'gate') {
      const gateId = `gate-${Date.now().toString(36)}`;
      const onFailVal =
        failStrategy === 'loop-to' && loopToTarget.trim()
          ? `loop-to:${loopToTarget.trim()}`
          : 'block';

      const checks: HarnessCheck[] = checkCommand.trim()
        ? [{ command: checkCommand.trim(), expectExit: 0 }]
        : [];

      onAddGate({
        id: gateId,
        name: trimmedName,
        rubric: rubric.trim(),
        checks,
        onFail: onFailVal,
      });
      onClose();
    } else {
      const trimmedId = trimmedName.toLowerCase().replace(/\s+/g, '-');
      onAddRole({
        id: trimmedId || `role-${Date.now().toString(36)}`,
        name: trimmedName,
        description: description.trim() || tr('harnessCustomRoleDesc', '专属代理角色', 'Specialized agent role'),
        systemPrompt: systemPrompt.trim(),
        tools: selectedTools,
        model: model.trim() || 'inherit',
        thinking: thinking.trim() || undefined,
      });
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-ink/30 p-5 backdrop-blur-[3px] animate-fade-in"
      onClick={onClose}
      data-harness-add-modal=""
    >
      <div
        className="flex w-[min(480px,calc(100vw-32px))] flex-col overflow-hidden rounded-window bg-surface shadow-overlay border border-line/60 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="harness-add-title"
      >
        {/* Header — clean icon, title, subtitle & single close button */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-3 border-b border-line/60">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-inset text-ink-2">
              {initialType === 'gate' ? (
                <Shield className="h-4 w-4 stroke-[1.8]" />
              ) : (
                <Bot className="h-4 w-4 stroke-[1.8]" />
              )}
            </span>
            <div className="min-w-0">
              <h2
                id="harness-add-title"
                className="truncate text-[15px] font-medium tracking-tight text-ink"
              >
                {initialType === 'gate'
                  ? tr('harnessNewGateModal', '新建质量门', 'New Quality Gate')
                  : tr('harnessNewRoleModal', '新建代理角色', 'New Agent Role')}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {initialType === 'gate'
                  ? tr(
                      'harnessGateModalHint',
                      '配置里程碑验收准则与自动化验证命令',
                      'Configure milestone criteria and automated verification'
                    )
                  : tr(
                      'harnessRoleModalHint',
                      '配置子代理专职角色、提示词与工具权限',
                      'Configure agent role persona, prompt, and tool permissions'
                    )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none cursor-pointer"
            title={tr('close', '关闭', 'Close')}
            aria-label={tr('close', '关闭', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body — Clean, zero-scroll layout */}
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-3.5 px-6 py-4 text-[13px]">
            {error && (
              <div className="flex items-center gap-2 rounded-control border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* GATE FORM */}
            {initialType === 'gate' && (
              <>
                {/* Gate Name */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('harnessGateName', '质量门名称', 'Gate name')}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={tr(
                      'harnessGatePlaceholder',
                      '例如：单元测试与类型校验',
                      'e.g. Unit Tests & Typecheck'
                    )}
                    className={controlClass}
                    autoFocus
                  />
                </div>

                {/* Rubric / Acceptance Criteria */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('harnessRubric', '评估准则与说明', 'Rubric & criteria')}
                  </label>
                  <textarea
                    rows={3}
                    value={rubric}
                    onChange={(e) => setRubric(e.target.value)}
                    placeholder={tr(
                      'harnessRubricPlaceholder',
                      '例如：所有单元测试必须通过，无编译警告与未决错误…',
                      'e.g. All unit tests must pass with zero compiler warnings…'
                    )}
                    className={textareaClass}
                  />
                </div>

                {/* Declarative Command */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('harnessCommandOptional', '自动化检查命令（可选）', 'Check command (optional)')}
                  </label>
                  <input
                    type="text"
                    value={checkCommand}
                    onChange={(e) => setCheckCommand(e.target.value)}
                    placeholder={tr(
                      'harnessCommandPlaceholder',
                      '例如：npm test 或 git diff --check',
                      'e.g. npm test or git diff --check'
                    )}
                    className={`${controlClass} font-mono`}
                  />
                </div>

                {/* On Failure Strategy */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('harnessOnFail', '未通过时策略', 'On failure')}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={failStrategy}
                      onChange={(e) => setFailStrategy(e.target.value as 'block' | 'loop-to')}
                      className={`${selectClass} ${failStrategy === 'loop-to' ? 'w-40 shrink-0' : 'w-full'}`}
                    >
                      <option value="block">
                        {tr('harnessFailBlock', '阻断流程执行 (block)', 'Block execution')}
                      </option>
                      <option value="loop-to">
                        {tr('harnessFailLoop', '回退至节点 (loop-to)', 'Loop to node')}
                      </option>
                    </select>

                    {failStrategy === 'loop-to' && (
                      <select
                        value={loopToTarget}
                        onChange={(e) => setLoopToTarget(e.target.value)}
                        className={`${selectClass} flex-1 font-mono`}
                      >
                        {availableNodeIds.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ROLE FORM */}
            {initialType === 'role' && (
              <>
                {/* Role Name */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('harnessRoleName', '角色标识与名称', 'Role name & ID')}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={tr(
                      'harnessRolePlaceholder',
                      '例如：reviewer (代码审查员)',
                      'e.g. reviewer (Code Reviewer)'
                    )}
                    className={controlClass}
                    autoFocus
                  />
                </div>

                {/* Role Description */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('description', '角色职责简述', 'Description')}
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={tr(
                      'harnessRoleDescPlaceholder',
                      '例如：专注于代码规范、安全性分析与质量把控',
                      'e.g. Focus on code quality, security analysis, and standards'
                    )}
                    className={controlClass}
                  />
                </div>

                {/* System Prompt */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-ink-2">
                    {tr('harnessSystemPrompt', '角色系统提示词', 'System prompt')}
                  </label>
                  <textarea
                    rows={4}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={tr(
                      'harnessRolePromptPlaceholder',
                      '例如：你是一名资深代码审查专家，请根据项目规范对变更提交进行严谨且具有建设性的评审…',
                      'e.g. You are a principal reviewer, evaluate changes rigorously against codebase rules…'
                    )}
                    className={`${textareaClass} font-mono text-[12.5px]`}
                  />
                </div>

                {/* Model & Thinking */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1.5">
                    <label className="block text-[13px] font-medium text-ink-2">
                      {tr('harnessModel', '指定模型', 'Model')}
                    </label>
                    <input
                      type="text"
                      list="harness-modal-model-suggestions"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="inherit"
                      className={`${controlClass} font-mono`}
                      data-harness-modal-role-model=""
                    />
                    <datalist id="harness-modal-model-suggestions">
                      <option value="inherit" />
                      <option value="tierflow" />
                      <option value="custom-test/tierflow" />
                      {availableModels
                        ?.filter((m) => m.id && m.id !== 'inherit' && m.id !== 'tierflow' && m.id !== 'custom-test/tierflow')
                        .map((m) => (
                          <option key={m.id} value={m.id} />
                        ))}
                    </datalist>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[13px] font-medium text-ink-2">
                      {tr('harnessThinking', '思考深度', 'Thinking Level')}
                    </label>
                    <select
                      value={thinking}
                      onChange={(e) => setThinking(e.target.value)}
                      className={selectClass}
                      data-harness-modal-role-thinking=""
                    >
                      <option value="">{tr('default', '默认 / 继承', 'Default / Inherit')}</option>
                      <option value="off">off</option>
                      <option value="minimal">minimal</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="xhigh">xhigh</option>
                    </select>
                  </div>
                </div>

                {/* Allowed Tools — All available selectable tools listed directly as toggleable chips */}
                <div className="space-y-2 pt-0.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-[13px] font-medium text-ink-2">
                      {tr('harnessTools', '可用工具权限', 'Allowed tools')}
                    </label>
                    <div className="flex items-center gap-1.5 text-[11.5px]">
                      <button
                        type="button"
                        onClick={() => setSelectedTools([...COMMON_DEV_TOOLS])}
                        className="text-ink-3 hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover"
                      >
                        {tr('harnessToolsCommon', '常用', 'Common')}
                      </button>
                      <span className="text-line">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedTools(HARNESS_AVAILABLE_TOOLS.map((t) => t.id))}
                        className="text-ink-3 hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover"
                      >
                        {tr('harnessToolsAll', '全选', 'All')}
                      </button>
                      <span className="text-line">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedTools([])}
                        className="text-ink-3 hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover"
                      >
                        {tr('harnessToolsClear', '清空', 'Clear')}
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-control bg-field/40 border border-line/60">
                    <div className="flex flex-wrap gap-1.5 max-h-[135px] overflow-y-auto">
                      {HARNESS_AVAILABLE_TOOLS.map((tool) => {
                        const active = selectedTools.includes(tool.id);
                        return (
                          <button
                            key={tool.id}
                            type="button"
                            onClick={() => toggleTool(tool.id)}
                            title={isZh ? `${tool.id}: ${tool.descriptionZh}` : `${tool.id}: ${tool.descriptionEn}`}
                            className={`rounded-full px-2.5 py-1 text-[12px] font-mono transition-colors cursor-pointer select-none ${
                              active
                                ? 'bg-ink text-canvas font-medium shadow-xs'
                                : 'bg-surface/80 text-ink-3 hover:text-ink hover:bg-hover border border-line/60'
                            }`}
                          >
                            {tool.id}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-ink-3 font-mono px-0.5">
                    <span>{isZh ? `已选 ${selectedTools.length} 项` : `${selectedTools.length} selected`}</span>
                    <span className="truncate max-w-[280px]" title={selectedTools.join(', ')}>
                      {selectedTools.join(', ')}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer — single clean primary action button */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line/60 px-6 py-3.5 bg-surface">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!name.trim()}
              data-harness-modal-save=""
            >
              {tr('save', '保存', 'Save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
