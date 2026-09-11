import React from 'react';

/** Perimeter order for a clockwise comet around the 3×3 grid (center stays dim). */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const step = ORBIT_ORDER.indexOf(index);
  return step === -1 ? null : step * 110;
});
const ORBIT_DURATION_MS = 950;

/** Compact 3×3 orbiting pixel grid used while a conversation is working. */
export function PixelOrbitLoader() {
  return (
    <span
      aria-hidden="true"
      data-conversation-working-loader=""
      className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] text-ink-3"
    >
      {ORBIT_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-[4px] rounded-[1px] bg-current"
          style={{
            opacity: delay === null ? 0.12 : 0.28,
            animation:
              delay === null
                ? 'none'
                : `pixel-on ${ORBIT_DURATION_MS}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}
