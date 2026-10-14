import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ShieldCheck, ShieldAlert, CheckCircle2, RotateCcw } from 'lucide-react';
import { useI18n } from '../../../i18n';
import type { HarnessGateNodeData } from '../../../types/harness';
import { getGateLocalization } from '../harness-i18n';

export const GateNode = memo(({ data, selected }: NodeProps) => {
  const { language: i18nLang } = useI18n();
  const gateData = data as unknown as HarnessGateNodeData & { invariant?: string; _language?: string };
  const language = gateData._language || i18nLang;
  const checkCount = gateData.checks?.length ?? 0;
  const isCustomChecks = checkCount > 0;
  const rawGateId = gateData.gateId || (gateData as any).id || 'Gate';
  const isComplete = rawGateId === 'complete';

  const { name, badgeLabel, invariant, checksLabel } = getGateLocalization(
    rawGateId,
    gateData as any,
    language
  );

  return (
    <div
      className={`group relative flex items-start gap-3 p-3 rounded-[12px] border bg-surface text-ink transition-[border-color,box-shadow,background-color] duration-150 w-[288px] select-none ${
        selected
          ? 'ring-2 ring-[color:var(--focus)] border-ink/40 shadow-raised'
          : 'border-line/60 shadow-card hover:border-line-strong hover:shadow-raised'
      }`}
      data-harness-node-gate=""
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !-left-1 !bg-line-strong !border-2 !border-surface !rounded-full transition-all duration-150 group-hover:!scale-150 group-hover:!bg-ink !cursor-crosshair shadow-xs opacity-60 group-hover:opacity-100"
      />

      <div className="w-8 h-8 rounded-[8px] bg-inset text-ink-2 flex items-center justify-center shrink-0 border border-line/40 mt-0.5">
        {isComplete ? (
          <CheckCircle2 className="w-4 h-4 stroke-[1.8]" />
        ) : isCustomChecks ? (
          <ShieldAlert className="w-4 h-4 stroke-[1.8]" />
        ) : (
          <ShieldCheck className="w-4 h-4 stroke-[1.8]" />
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
            {badgeLabel}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-ink-3">
          <span
            className="truncate text-[11.5px] text-ink-3 leading-[16px] flex-1"
            title={invariant}
          >
            {invariant}
          </span>

          {checkCount > 0 ? (
            <span className="text-[10px] font-mono text-ink-3 bg-inset px-1.5 py-0.5 rounded-full border border-line/60 shrink-0">
              {checksLabel}
            </span>
          ) : gateData.onFail && gateData.onFail !== 'block' ? (
            <span className="text-[10px] font-mono text-ink-3 bg-inset px-1.5 py-0.5 rounded-full border border-line/60 shrink-0 flex items-center gap-1">
              <RotateCcw className="w-2.5 h-2.5 stroke-[2]" />
              {gateData.onFail}
            </span>
          ) : null}
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

GateNode.displayName = 'GateNode';
