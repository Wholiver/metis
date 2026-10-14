import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers, Zap } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { HarnessTierNodeData } from '../../../types/harness';
import { getTierLocalization } from '../harness-i18n';

export const TierNode = memo(({ id, data, selected }: NodeProps) => {
  const { language: i18nLang } = useI18n();
  const tierData = data as unknown as HarnessTierNodeData;
  const language = (tierData as any)?._language || i18nLang;
  const isFastPath = id === 'tier-fast-path';
  const { name, badge, description } = getTierLocalization(id, tierData as any, language);

  return (
    <div
      className={`group relative flex items-start gap-3 p-3 rounded-[12px] border bg-surface text-ink transition-[border-color,box-shadow,background-color] duration-150 w-[288px] select-none ${
        selected
          ? 'ring-2 ring-[color:var(--focus)] border-ink/40 shadow-raised'
          : 'border-line/60 shadow-card hover:border-line-strong hover:shadow-raised'
      }`}
      data-harness-node-tier=""
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !-left-1 !bg-line-strong !border-2 !border-surface !rounded-full transition-all duration-150 group-hover:!scale-150 group-hover:!bg-ink !cursor-crosshair shadow-xs opacity-60 group-hover:opacity-100"
      />

      <div className="w-8 h-8 rounded-[8px] bg-inset text-ink-2 flex items-center justify-center shrink-0 border border-line/40 mt-0.5">
        {isFastPath ? (
          <Zap className="w-4 h-4 stroke-[1.8]" />
        ) : (
          <Layers className="w-4 h-4 stroke-[1.8]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[13px] font-medium text-ink tracking-tight truncate"
            title={name}
          >
            {name}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-inset text-ink-3 border border-line/60 shrink-0">
            {badge}
          </span>
        </div>

        {description && (
          <div
            className="mt-1 text-[11.5px] leading-[16px] text-ink-3 line-clamp-1"
            title={description}
          >
            {description}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !-right-1 !bg-line-strong !border-2 !border-surface !rounded-full transition-all duration-150 group-hover:!scale-150 group-hover:!bg-ink !cursor-crosshair shadow-xs opacity-60 group-hover:opacity-100"
      />
    </div>
  );
});

TierNode.displayName = 'TierNode';
