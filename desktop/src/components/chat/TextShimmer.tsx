import React, { useEffect, useState } from 'react';

interface TextShimmerProps {
  text: string;
  active?: boolean;
  className?: string;
  offset?: number;
}

/** React port of OpenCode `TextShimmer` (MIT). */
export function TextShimmer({
  text,
  active = true,
  className,
  offset = 0,
}: TextShimmerProps) {
  const [run, setRun] = useState(active);
  const swap = 220;

  useEffect(() => {
    if (active) {
      setRun(true);
      return;
    }
    const timer = window.setTimeout(() => setRun(false), swap);
    return () => window.clearTimeout(timer);
  }, [active]);

  return (
    <span
      data-component="text-shimmer"
      data-active={active ? 'true' : 'false'}
      className={className}
      aria-label={text}
      style={{
        ['--text-shimmer-swap' as string]: `${swap}ms`,
        ['--text-shimmer-index' as string]: `${offset}`,
      }}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">{text}</span>
        <span
          data-slot="text-shimmer-char-shimmer"
          data-run={run ? 'true' : 'false'}
          aria-hidden="true"
        >
          {text}
        </span>
      </span>
    </span>
  );
}
