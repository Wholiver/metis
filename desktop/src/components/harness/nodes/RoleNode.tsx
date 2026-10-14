import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot, Wrench, Crown, ShieldAlert, Cpu } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { HarnessRoleNodeData } from '../../../types/harness';
import { getRoleLocalization } from '../harness-i18n';

function getRoleIcon(categoryKey: string) {
  if (categoryKey === 'Orchestrator') return Crown;
  if (categoryKey === 'Builder') return Bot;
  if (categoryKey === 'Assurance') return ShieldAlert;
  if (categoryKey === 'Strategic') return Cpu;
  return Bot;
}

export const RoleNode = memo(({ data, selected }: NodeProps) => {
  const { language: i18nLang } = useI18n();
  const roleData = data as unknown as HarnessRoleNodeData & { _language?: string };
  const language = roleData._language || i18nLang;
  const toolCount = roleData.tools?.length ?? 0;
  const roleId = roleData.name || roleData.id || '';

  const {
    displayName,
    roleIdTag,
    categoryLabel,
    categoryKey,
    description,
    toolsCountLabel,
  } = getRoleLocalization(roleId, roleData as any, language);

  const IconComponent = getRoleIcon(categoryKey);

  return (
    <div
      className={`group relative flex items-start gap-3 p-3 rounded-[12px] border bg-surface text-ink transition-[border-color,box-shadow,background-color] duration-150 w-[288px] select-none ${
        selected
          ? 'ring-2 ring-[color:var(--focus)] border-ink/40 shadow-raised'
          : 'border-line/60 shadow-card hover:border-line-strong hover:shadow-raised'
      }`}
      data-harness-node-role=""
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !-left-1 !bg-line-strong !border-2 !border-surface !rounded-full transition-all duration-150 group-hover:!scale-150 group-hover:!bg-ink !cursor-crosshair shadow-xs opacity-60 group-hover:opacity-100"
      />

      <div className="w-8 h-8 rounded-[8px] bg-inset text-ink-2 flex items-center justify-center shrink-0 border border-line/40 mt-0.5">
        <IconComponent className="w-4 h-4 stroke-[1.8]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span
              className="text-[13px] font-medium text-ink tracking-tight truncate"
              title={roleIdTag ? `${displayName} (${roleIdTag})` : displayName}
            >
              {displayName}
            </span>
            {roleIdTag && (
              <span
                className="text-[9.5px] font-mono text-ink-3/80 shrink-0 max-w-[85px] truncate"
                title={roleIdTag}
              >
                {roleIdTag}
              </span>
            )}
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-inset text-ink-3 border border-line/60 shrink-0">
            {categoryLabel}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-ink-3">
          {toolCount > 0 ? (
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-3 truncate">
              <Wrench className="w-3 h-3 stroke-[1.8] text-ink-3 shrink-0" />
              <span>{toolsCountLabel}</span>
            </span>
          ) : (
            <span className="truncate text-[11.5px] text-ink-3 leading-[16px]" title={description}>
              {description}
            </span>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {roleData.model && roleData.model !== 'inherit' && (
              <span
                className="text-[9.5px] font-mono text-ink-3 bg-inset px-1.5 py-0.5 rounded-full border border-line/60 max-w-[70px] truncate"
                title={roleData.model}
              >
                {roleData.model}
              </span>
            )}
            {roleData.maxSpawnDepth !== undefined && (
              <span className="text-[9.5px] font-mono text-ink-3 bg-inset px-1.5 py-0.5 rounded-full border border-line/60">
                d:{roleData.maxSpawnDepth}
              </span>
            )}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !-right-1 !bg-line-strong !border-2 !border-surface !rounded-full transition-all duration-150 group-hover:!scale-150 group-hover:!bg-ink !cursor-crosshair shadow-xs opacity-60 group-hover:opacity-100"
      />
    </div>
  );
});

RoleNode.displayName = 'RoleNode';
