import React from 'react';
import { Hammer, ListTodo, LoaderCircle } from 'lucide-react';
import { CollaborationMode } from '../../types';

interface ModeSwitcherProps {
  mode: CollaborationMode;
  onSelectMode: (mode: CollaborationMode) => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
  loading?: boolean;
}

const MODES: Array<{
  id: CollaborationMode;
  label: string;
  description: string;
  icon: typeof ListTodo;
  selectedClass: string;
  idleClass: string;
}> = [
  {
    id: 'plan',
    label: 'Plan',
    description: 'Plan and clarify before making changes',
    icon: ListTodo,
    selectedClass: 'bg-[#5b7198] text-white shadow-[0_1px_3px_rgba(70,91,130,0.3)]',
    idleClass: 'text-[#586e90] hover:bg-white/70',
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Implement changes directly',
    icon: Hammer,
    selectedClass: 'bg-[#567a70] text-white shadow-[0_1px_3px_rgba(61,96,86,0.3)]',
    idleClass: 'text-[#4f7068] hover:bg-white/70',
  },
];

export const ModeSwitcher: React.FC<ModeSwitcherProps> = ({
  mode,
  onSelectMode,
  disabled = false,
  loading = false,
}) => (
  <div
    className="pointer-events-auto inline-flex h-8 items-center gap-0 rounded-xl bg-[#eef2f6] p-0.5 shadow-[0_0_0_1px_rgba(215,222,232,0.9),0_1px_2px_rgba(15,23,42,0.08)]"
    role="radiogroup"
    aria-label="Agent mode"
    aria-busy={loading}
    data-mode-switcher=""
  >
    {MODES.map((option) => {
      const selected = mode === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={`${option.label}. ${option.description}`}
          data-mode-option={option.id}
          disabled={disabled || loading}
          onClick={() => {
            if (!selected) void onSelectMode(option.id);
          }}
          className={`relative flex h-7 min-w-[64px] items-center justify-center gap-1.5 rounded-[12px] px-2.5 text-[11.5px] font-semibold before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full before:-translate-y-1/2 before:content-[''] active:scale-[0.96] transition-[color,background-color,box-shadow,transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60 disabled:cursor-not-allowed disabled:opacity-55 ${selected ? option.selectedClass : option.idleClass}`}
          title={option.description}
        >
          <Icon className="h-3.5 w-3.5 stroke-2" />
          <span>{option.label}</span>
          {loading && selected && <LoaderCircle className="h-3.5 w-3.5 animate-spin stroke-2" />}
        </button>
      );
    })}
  </div>
);
