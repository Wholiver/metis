import React from 'react';

/** Chevron wavefront delays for a 3×3 Dots loader (Beautiful UI LoadingState Dots). */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});
const DOTS_DURATION_MS = 650;

/** Compact 3×3 circular pixel grid used while a conversation is working. */
export function PixelDotsLoader() {
  return (
    <span
      aria-hidden="true"
      data-conversation-working-loader=""
      className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
    >
      {CHEVRON_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-[4px] rounded-full bg-ink"
          style={{
            opacity: 0.15,
            animation: `pixel-on ${DOTS_DURATION_MS}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}
