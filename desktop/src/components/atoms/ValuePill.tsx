"use client";

import React from "react";
import { cn } from "../../lib/utils";

export type ValuePillProps = {
  children: React.ReactNode;
  tone?: "green" | "orange" | "accent" | "blue" | string;
  className?: string;
};

export function ValuePill({ children, tone, className }: ValuePillProps) {
  const toneClass =
    tone === "green"
      ? "bg-green-tint text-green border border-green/25"
      : tone === "orange"
      ? "bg-orange-tint text-orange border border-orange/25"
      : tone === "accent" || tone === "blue"
      ? "bg-accent-tint text-accent border border-accent/25"
      : "bg-hover-2 text-ink shadow-hairline";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[12.5px] font-medium tabular-nums align-middle",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}
