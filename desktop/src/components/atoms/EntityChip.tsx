"use client";

import React from "react";
import { cn } from "../../lib/utils";

export type EntityChipProps = {
  name: string;
  monogram?: string;
  className?: string;
};

export function EntityChip({ name, monogram, className }: EntityChipProps) {
  const initial = monogram ?? (name.trim().charAt(0).toUpperCase() || "?");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-hover-2 px-2 py-0.5 text-[12.5px] font-medium text-ink align-middle shadow-hairline",
        className,
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-orange text-[10px] font-bold text-white leading-none">
        {initial}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
