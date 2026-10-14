/**
 * Source: https://www.beautifului.dev/r/glide-menu.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 */
"use client";

import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";

type GlideMenuProps = {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
  rowSelector?: string;
  activeRowSelector?: string;
};

/** A single hover layer that glides between interactive menu rows. */
export default function GlideMenu({
  children,
  className = "",
  highlightClassName = "inset-x-0 rounded-[8px] bg-hover",
  rowSelector = "[data-menu-row]",
  activeRowSelector,
}: GlideMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);

  const moveTo = (target: EventTarget | null) => {
    const container = ref.current;
    if (!(target instanceof Element) || !container) return;
    const row = target.closest(rowSelector);
    if (!(row instanceof HTMLElement) || !container.contains(row)) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setBox({ top: rowRect.top - containerRect.top, height: rowRect.height });
    setVisible(true);
  };

  const updateToActive = useCallback(() => {
    if (!activeRowSelector) return;
    const container = ref.current;
    if (!container) return;
    const activeRow = container.querySelector(activeRowSelector);
    if (activeRow instanceof HTMLElement) {
      const containerRect = container.getBoundingClientRect();
      const rowRect = activeRow.getBoundingClientRect();
      if (rowRect.height > 0) {
        setBox({ top: rowRect.top - containerRect.top, height: rowRect.height });
        setVisible(true);
      }
    } else {
      setVisible(false);
    }
  }, [activeRowSelector]);

  useEffect(() => {
    if (activeRowSelector) {
      updateToActive();
      const raf = requestAnimationFrame(updateToActive);
      return () => cancelAnimationFrame(raf);
    }
  }, [activeRowSelector, children, updateToActive]);

  return (
    <div
      ref={ref}
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={() => {
        if (activeRowSelector) {
          updateToActive();
        } else {
          setVisible(false);
        }
      }}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node | null)) {
          if (activeRowSelector) {
            updateToActive();
          } else {
            setVisible(false);
          }
        }
      }}
      className={`group/glide-menu relative ${className}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute ${highlightClassName}`}
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
          transition:
            "top 150ms cubic-bezier(0.16,1,0.3,1), height 150ms cubic-bezier(0.16,1,0.3,1), opacity 150ms ease",
        }}
      />
      {children}
    </div>
  );
}
