import React from 'react';
import { X, Plus, Trash2, Shield, Bot, GitMerge, Layers } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Button } from '../atoms/Button';
import {
  HARNESS_AVAILABLE_TOOLS,
  COMMON_DEV_TOOLS,
  type HarnessCheck,
  type HarnessNode,
} from '../../types/harness';
import {
  getTierLocalization,
  getFrameworkLocalization,
  getGateLocalization,
  getRoleLocalization,
} from './harness-i18n';

interface HarnessNodeDrawerProps {
  node: HarnessNode | null;
  onClose: () => void;
  onUpdateNodeData: (nodeId: string, patch: Record<string, any>) => void;
  onDeleteNode?: (nodeId: string) => void;
  availableNodeIds?: string[];
  availableModels?: Array<{ id: string; name?: string }>;
}

const controlClass =
  'h-9 w-full rounded-control border border-line bg-field px-3 text-[13px] text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]';
const selectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-control border border-line bg-field bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2714%27%20height=%2714%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%2364748b%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center] pl-3 pr-8 text-[13px] text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]';
const textareaClass =
  'w-full resize-none rounded-control border border-line bg-field p-3 text-[13px] leading-relaxed text-ink outline-none transition-[box-shadow,border-color] focus:border-line-strong focus:ring-2 focus:ring-[color:var(--focus)]';

export function HarnessNodeDrawer({
  node,
  onClose,
  onUpdateNodeData,
  onDeleteNode,
  availableNodeIds = [],
  availableModels = [],
}: HarnessNodeDrawerProps) {
  const { t, language } = useI18n();
  const isZh = language?.startsWith('zh');

  const tr = (key: string, zhText: string, enText: string): string => {
    const val = t(key);
    if (!val || val === key) {
      return isZh ? zhText : enText;
    }
    return val;
  };

  const nodeType = node?.type;
  const data = (node?.data || {}) as Record<string, any>;

  const localizedInfo = React.useMemo(() => {
    if (!node || !nodeType) return null;
    if (nodeType === 'tier') return getTierLocalization(node.id, data, language);
    if (nodeType === 'framework') return getFrameworkLocalization(node.id, data, language);
    if (nodeType === 'gate') return getGateLocalization(node.id, data, language);
    if (nodeType === 'role') return getRoleLocalization(node.id, data, language);
    return null;
  }, [node, nodeType, data, language]);

  if (!node) return null;

  const displayTitle =
    nodeType === 'role'
      ? (localizedInfo as any)?.displayName || data.name || node.id
      : (localizedInfo as any)?.name || data.name || data.label || node.id;

  const handleFieldChange = (key: string, value: any) => {
    onUpdateNodeData(node.id, { [key]: value });
  };

  const handleDescriptionChange = (value: string) => {
    if (nodeType === 'gate') {
      onUpdateNodeData(node.id, { description: value, invariant: value });
    } else {
      handleFieldChange('description', value);
    }
  };

  const handleAddCheck = () => {
    const currentChecks: HarnessCheck[] = (data.checks as HarnessCheck[]) || [];
    const newCheck: HarnessCheck = { command: '', expectExit: 0 };
    handleFieldChange('checks', [...currentChecks, newCheck]);
  };

  const handleUpdateCheck = (index: number, patch: Partial<HarnessCheck>) => {
    const currentChecks: HarnessCheck[] = [...((data.checks as HarnessCheck[]) || [])];
    currentChecks[index] = { ...currentChecks[index], ...patch };
    handleFieldChange('checks', currentChecks);
  };

  const handleDeleteCheck = (index: number) => {
    const currentChecks: HarnessCheck[] = ((data.checks as HarnessCheck[]) || []).filter((_, i) => i !== index);
    handleFieldChange('checks', currentChecks);
  };

  const toolsList: string[] = Array.isArray(data.tools)
    ? data.tools
    : typeof data.tools === 'string'
    ? data.tools.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-[420px] max-w-full bg-surface border-l border-line z-30 flex flex-col shadow-overlay animate-in slide-in-from-right duration-200"
      data-harness-drawer=""
    >
      {/* Header — clean icon, localized type badge, title & close button */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line/60 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-inset text-ink-2">
            {nodeType === 'gate' && <Shield className="w-4.5 h-4.5 stroke-[1.8]" />}
            {nodeType === 'role' && <Bot className="w-4.5 h-4.5 stroke-[1.8]" />}
            {nodeType === 'framework' && <GitMerge className="w-4.5 h-4.5 stroke-[1.8]" />}
            {nodeType === 'tier' && <Layers className="w-4.5 h-4.5 stroke-[1.8]" />}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-medium tracking-tight text-ink" title={displayTitle}>
              {displayTitle}
            </h3>
            <p className="text-[12px] text-ink-3 flex items-center gap-1.5 mt-0.5">
              <span className="font-medium text-ink-2">
                {nodeType === 'role'
                  ? tr('harnessRole', '代理角色', 'Role')
                  : nodeType === 'gate'
                  ? tr('harnessGate', '质量门', 'Gate')
                  : nodeType === 'framework'
                  ? tr('harnessFramework', '框架', 'Framework')
                  : tr('harnessTier', '执行等级', 'Tier')}
              </span>
              <span>·</span>
              <span className="font-mono text-ink-3">{node.id}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
          title={tr('close', '关闭', 'Close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body — Clean, simplified form with zero clutter */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[13px]">
        {/* Name */}
        <div className="space-y-1.5">
          <label className="block text-[13px] font-medium text-ink-2">
            {nodeType === 'role'
              ? tr('harnessRoleName', '角色名称', 'Role Name')
              : nodeType === 'gate'
              ? tr('harnessGateName', '质量门名称', 'Gate Name')
              : tr('harnessNodeName', '节点名称', 'Node Name')}
          </label>
          <input
            type="text"
            value={data.name || data.label || ''}
            placeholder={displayTitle}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            className={controlClass}
          />
        </div>

        {/* Description / Invariant */}
        <div className="space-y-1.5">
          <label className="block text-[13px] font-medium text-ink-2">
            {nodeType === 'role'
              ? tr('description', '角色职责简述', 'Role Description')
              : nodeType === 'gate'
              ? tr('harnessInvariant', '判定不变量 / 验收标准', 'Invariant / Criteria')
              : tr('description', '职责描述', 'Description')}
          </label>
          <textarea
            rows={2}
            value={data.description || data.invariant || ''}
            placeholder={(localizedInfo as any)?.description || (localizedInfo as any)?.invariant || ''}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            className={textareaClass}
          />
        </div>

        {/* Gate Specific Fields */}
        {nodeType === 'gate' && (
          <>
            {/* Failure strategy */}
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('harnessOnFail', '失败处理策略', 'On Failure')}
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={String(data.onFail || 'block').startsWith('loop-to:') ? 'loop-to' : (data.onFail || 'block')}
                  onChange={(e) => {
                    if (e.target.value === 'block') handleFieldChange('onFail', 'block');
                    else {
                      const firstTarget = availableNodeIds.find((id) => id !== node.id && id !== data.gateId) || 'G4';
                      handleFieldChange('onFail', `loop-to:${firstTarget}`);
                    }
                  }}
                  className={`${selectClass} w-36 shrink-0`}
                >
                  <option value="block">block</option>
                  <option value="loop-to">loop-to</option>
                </select>
                {String(data.onFail || '').startsWith('loop-to:') && (
                  <>
                    <input
                      type="text"
                      list="harness-node-targets"
                      value={String(data.onFail).replace('loop-to:', '')}
                      onChange={(e) => handleFieldChange('onFail', `loop-to:${e.target.value.trim()}`)}
                      placeholder="target-node-id"
                      className={`${controlClass} font-mono flex-1`}
                    />
                    <datalist id="harness-node-targets">
                      {availableNodeIds
                        .filter((id) => id !== node.id && id !== data.gateId)
                        .map((id) => (
                          <option key={id} value={id} />
                        ))}
                    </datalist>
                  </>
                )}
              </div>
            </div>

            {/* Rubric */}
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('harnessRubric', '评估准则与判定指令', 'Rubric & Evaluation Instructions')}
              </label>
              <textarea
                rows={4}
                value={data.rubric || ''}
                onChange={(e) => handleFieldChange('rubric', e.target.value)}
                placeholder="给负责此质量门的代理角色的评审提示与准则..."
                className={textareaClass}
              />
            </div>

            {/* Declarative Checks */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-ink-2">
                  {tr('harnessChecks', '声明式检查项', 'Declarative Checks')}
                </label>
                <button
                  type="button"
                  onClick={handleAddCheck}
                  className="flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink font-medium cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{tr('harnessAddCheck', '添加检查', 'Add Check')}</span>
                </button>
              </div>

              {(!data.checks || data.checks.length === 0) ? (
                <div className="p-3.5 rounded-control border border-line/60 bg-field/40 text-[12px] text-ink-3 text-center">
                  {tr(
                    'harnessNoChecksHint',
                    '暂无自动化检查项。质量门将依赖角色评估准则。',
                    'No automated checks defined. Gate will rely on role evaluation rubric.'
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {data.checks.map((chk: HarnessCheck, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 rounded-control border border-line bg-field space-y-2 relative group"
                    >
                      <button
                        type="button"
                        onClick={() => handleDeleteCheck(idx)}
                        className="absolute top-2.5 right-2.5 p-1 text-ink-3 hover:text-red-500 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="删除检查项"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="pr-6">
                        <span className="text-[11px] text-ink-3 font-mono">
                          {tr('harnessCommand', '命令', 'Command')}:
                        </span>
                        <input
                          type="text"
                          value={chk.command || ''}
                          onChange={(e) => handleUpdateCheck(idx, { command: e.target.value })}
                          placeholder="例如：npm test"
                          className={`${controlClass} font-mono h-8 text-[12px] mt-0.5`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[11px] text-ink-3">
                            {tr('harnessExpectExit', '退出码', 'Exit code')}:
                          </span>
                          <input
                            type="number"
                            value={chk.expectExit ?? 0}
                            onChange={(e) => handleUpdateCheck(idx, { expectExit: parseInt(e.target.value, 10) || 0 })}
                            className={`${controlClass} font-mono h-8 text-[12px] mt-0.5`}
                          />
                        </div>
                        <div>
                          <span className="text-[11px] text-ink-3">
                            {tr('harnessArtifactPath', '产物路径', 'Artifact path')}:
                          </span>
                          <input
                            type="text"
                            value={chk.artifactPath || ''}
                            onChange={(e) => handleUpdateCheck(idx, { artifactPath: e.target.value.trim() || undefined })}
                            placeholder="可选，例如 dist/index.js"
                            className={`${controlClass} font-mono h-8 text-[12px] mt-0.5`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Role Specific Fields: Model, Thinking, Depth, Tools & System Prompt */}
        {nodeType === 'role' && (
          <>
            {/* Model & Thinking */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-ink-2">
                  {tr('harnessModel', '指定模型', 'Model')}
                </label>
                <input
                  type="text"
                  list="harness-model-suggestions"
                  value={data.model || 'inherit'}
                  onChange={(e) => handleFieldChange('model', e.target.value.trim() || undefined)}
                  placeholder="inherit"
                  className={`${controlClass} font-mono`}
                  data-harness-role-model=""
                />
                <datalist id="harness-model-suggestions">
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
                  value={data.thinking || ''}
                  onChange={(e) => handleFieldChange('thinking', e.target.value || undefined)}
                  className={selectClass}
                  data-harness-role-thinking=""
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

            {/* Max Spawn Depth */}
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('harnessMaxSpawnDepth', '最大递归派生深度', 'Max Spawn Depth')}
              </label>
              <input
                type="number"
                min={0}
                max={5}
                value={data.maxSpawnDepth ?? 1}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  handleFieldChange('maxSpawnDepth', isNaN(val) ? 0 : Math.max(0, val));
                }}
                className={`${controlClass} font-mono`}
                data-harness-role-depth=""
              />
            </div>

            {/* Tools — All available selectable tools listed directly as toggleable chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-[13px] font-medium text-ink-2">
                  {tr('harnessTools', '可用工具权限', 'Allowed Tools')}
                </label>
                <div className="flex items-center gap-1.5 text-[11.5px]">
                  <button
                    type="button"
                    onClick={() => handleFieldChange('tools', [...COMMON_DEV_TOOLS])}
                    className="text-ink-3 hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover"
                  >
                    {tr('harnessToolsCommon', '常用', 'Common')}
                  </button>
                  <span className="text-line">·</span>
                  <button
                    type="button"
                    onClick={() => handleFieldChange('tools', HARNESS_AVAILABLE_TOOLS.map((t) => t.id))}
                    className="text-ink-3 hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover"
                  >
                    {tr('harnessToolsAll', '全选', 'All')}
                  </button>
                  <span className="text-line">·</span>
                  <button
                    type="button"
                    onClick={() => handleFieldChange('tools', [])}
                    className="text-ink-3 hover:text-ink transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover"
                  >
                    {tr('harnessToolsClear', '清空', 'Clear')}
                  </button>
                </div>
              </div>

              {/* Grid of all available selectable tools */}
              <div className="p-2.5 rounded-control bg-field/40 border border-line/60">
                <div className="flex flex-wrap gap-1.5">
                  {/* Any custom tools present in role config */}
                  {toolsList
                    .filter((t) => !HARNESS_AVAILABLE_TOOLS.some((std) => std.id === t))
                    .map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => {
                          const newTools = toolsList.filter((t) => t !== tool);
                          handleFieldChange('tools', newTools);
                        }}
                        title={isZh ? `自定义工具: ${tool}（点击移除）` : `Custom tool: ${tool} (click to remove)`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-mono bg-ink text-canvas font-medium shadow-xs transition-colors cursor-pointer select-none"
                      >
                        <span>{tool}</span>
                        <span className="opacity-70 hover:opacity-100">×</span>
                      </button>
                    ))}

                  {/* All standard available tools */}
                  {HARNESS_AVAILABLE_TOOLS.map((tool) => {
                    const active = toolsList.includes(tool.id);
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? toolsList.filter((t) => t !== tool.id)
                            : [...toolsList, tool.id];
                          handleFieldChange('tools', next);
                        }}
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

              {/* Summary line: item count and selected tools list */}
              <div className="flex items-center justify-between text-[11px] text-ink-3 font-mono px-0.5">
                <span>{isZh ? `已选 ${toolsList.length} 项` : `${toolsList.length} selected`}</span>
                <span className="truncate max-w-[240px]" title={toolsList.join(', ')}>
                  {toolsList.join(', ')}
                </span>
              </div>
            </div>

            {/* System Prompt */}
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-ink-2">
                {tr('harnessSystemPrompt', '角色系统提示词', 'System Prompt')}
              </label>
              <textarea
                rows={10}
                value={data.systemPrompt || ''}
                onChange={(e) => handleFieldChange('systemPrompt', e.target.value)}
                placeholder="输入角色专属系统提示词..."
                className={`${textareaClass} font-mono text-[12.5px] leading-relaxed`}
              />
            </div>
          </>
        )}
      </div>

      {/* Footer: Delete Node — Quiet, refined button */}
      {onDeleteNode && (
        <div className="p-4 border-t border-line/60 bg-surface">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const confirmMsg = tr(
                'harnessDeleteNodeConfirm',
                '确定要删除此节点及其所有连线吗？',
                'Are you sure you want to delete this node and its connections?'
              );
              if (window.confirm(confirmMsg)) {
                onDeleteNode(node.id);
              }
            }}
            className="w-full flex items-center justify-center gap-1.5 h-9 rounded-control text-red hover:bg-red-tint/50 text-[13px] font-medium transition-colors cursor-pointer"
            data-harness-delete-node=""
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{tr('harnessDeleteNode', '删除此节点', 'Delete Node')}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
