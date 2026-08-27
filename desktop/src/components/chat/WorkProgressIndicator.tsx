import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  planWorkProgressExpressionUpdate,
  resolveWorkProgressExpression,
  WorkProgressExpression,
  WorkProgressState,
} from '../../lib/work-progress';
import {
  eyeMatrixAttribute,
  EyeMatrix,
  interpolateEyeMatrix,
  interpolateSvgPath,
  WORK_PROGRESS_CLOUD_BODY_PATH,
  WORK_PROGRESS_EYE_TARGETS,
  WorkProgressEyeTarget,
} from '../../lib/work-progress-expression-morph';
import { pickWorkProgressLabel, WorkProgressCopyState } from '../../lib/work-progress-copy';

export const WORK_PROGRESS_EXPRESSION_MIN_DISPLAY_MS = 2000;
export const WORK_PROGRESS_EXPRESSION_SETTLE_MS = 450;
const WORK_PROGRESS_EXPRESSION_MORPH_MS = 420;

interface WorkProgressIndicatorProps {
  progress: WorkProgressState;
  idle?: boolean;
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function easeInOutSine(progress: number): number {
  return -(Math.cos(Math.PI * progress) - 1) / 2;
}

function cloneEyeTarget(target: WorkProgressEyeTarget): WorkProgressEyeTarget {
  return { path: target.path, matrix: [...target.matrix] as unknown as EyeMatrix };
}

export const WorkProgressIndicator: React.FC<WorkProgressIndicatorProps> = ({ progress, idle = false }) => {
  const targetExpression = resolveWorkProgressExpression(progress);
  const [displayExpression, setDisplayExpression] = useState(targetExpression);
  const displayedAtMs = useRef(monotonicNow());
  const targetSinceMs = useRef(monotonicNow());
  const pendingExpression = useRef(targetExpression);
  const trackedTargetExpression = useRef(targetExpression);
  const wasIdle = useRef(idle);
  const maskId = `work-progress-mask-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const eye0Ref = useRef<SVGPathElement>(null);
  const eye1Ref = useRef<SVGPathElement>(null);
  const initialEyesRef = useRef(WORK_PROGRESS_EYE_TARGETS[targetExpression]);
  const initialEyes = initialEyesRef.current;
  const currentEyes = useRef<readonly [WorkProgressEyeTarget, WorkProgressEyeTarget]>([
    cloneEyeTarget(initialEyes[0]),
    cloneEyeTarget(initialEyes[1]),
  ]);
  useEffect(() => {
    const now = monotonicNow();
    pendingExpression.current = targetExpression;
    if (trackedTargetExpression.current !== targetExpression) {
      trackedTargetExpression.current = targetExpression;
      targetSinceMs.current = now;
    }
    if (idle) {
      wasIdle.current = true;
      return;
    }
    if (wasIdle.current) {
      wasIdle.current = false;
      displayedAtMs.current = now;
      targetSinceMs.current = now;
      setDisplayExpression(targetExpression);
      return;
    }

    const update = planWorkProgressExpressionUpdate(
      displayExpression,
      targetExpression,
      displayedAtMs.current,
      targetSinceMs.current,
      now,
      WORK_PROGRESS_EXPRESSION_MIN_DISPLAY_MS,
      WORK_PROGRESS_EXPRESSION_SETTLE_MS,
    );
    if (update.delayMs === null) {
      if (update.expression !== displayExpression) {
        displayedAtMs.current = monotonicNow();
        setDisplayExpression(update.expression);
      }
      return;
    }

    const timer = window.setTimeout(() => {
      const nextExpression = pendingExpression.current;
      if (nextExpression === displayExpression) return;
      displayedAtMs.current = monotonicNow();
      setDisplayExpression(nextExpression);
    }, update.delayMs);
    return () => window.clearTimeout(timer);
  }, [displayExpression, idle, targetExpression]);

  useLayoutEffect(() => {
    if (idle) return;
    const targetEyes = WORK_PROGRESS_EYE_TARGETS[displayExpression];
    const fromEyes = currentEyes.current.map(cloneEyeTarget) as unknown as readonly [WorkProgressEyeTarget, WorkProgressEyeTarget];
    const eyeElements = [eye0Ref.current, eye1Ref.current] as const;
    const svg = svgRef.current;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let fallbackTimer = 0;

    const applyProgress = (progressAmount: number) => {
      const eased = easeInOutSine(progressAmount);
      const nextEyes = targetEyes.map((target, index) => ({
        path: interpolateSvgPath(fromEyes[index].path, target.path, eased),
        matrix: interpolateEyeMatrix(fromEyes[index].matrix, target.matrix, eased),
      })) as unknown as readonly [WorkProgressEyeTarget, WorkProgressEyeTarget];
      nextEyes.forEach((eye, index) => {
        eyeElements[index]?.setAttribute('d', eye.path);
        eyeElements[index]?.setAttribute('transform', eyeMatrixAttribute(eye.matrix));
      });
      currentEyes.current = nextEyes;
    };

    if (reducedMotion) {
      applyProgress(1);
      svg?.setAttribute('data-progress-expression-morphing', 'false');
      return;
    }

    const startedAt = monotonicNow();
    svg?.setAttribute('data-progress-expression-morphing', 'true');
    const animate = (now: number) => {
      window.clearTimeout(fallbackTimer);
      const progressAmount = Math.min(1, (now - startedAt) / WORK_PROGRESS_EXPRESSION_MORPH_MS);
      applyProgress(progressAmount);
      if (progressAmount < 1) {
        scheduleFrame();
      } else {
        svg?.setAttribute('data-progress-expression-morphing', 'false');
      }
    };
    const scheduleFrame = () => {
      frame = window.requestAnimationFrame(animate);
      fallbackTimer = window.setTimeout(() => {
        window.cancelAnimationFrame(frame);
        animate(monotonicNow());
      }, 40);
    };
    scheduleFrame();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fallbackTimer);
    };
  }, [displayExpression, idle]);

  const visualMode = idle ? 'idle' : 'expression-morph';
  const copyState: WorkProgressCopyState = idle ? 'idle' : progress.phase;
  const [displayLabel, setDisplayLabel] = useState(() => pickWorkProgressLabel(copyState));

  useLayoutEffect(() => {
    setDisplayLabel((previous) => pickWorkProgressLabel(copyState, Math.random, previous));
  }, [copyState]);

  return (
    <div
      className="work-progress-indicator"
      role="status"
      aria-live="polite"
      data-work-progress
      data-progress-phase={progress.phase}
      data-progress-status={progress.status}
      data-progress-idle={idle ? 'true' : undefined}
      data-progress-visual-mode={visualMode}
      data-progress-expression={idle ? undefined : displayExpression}
      data-progress-expression-min-display-ms={WORK_PROGRESS_EXPRESSION_MIN_DISPLAY_MS}
      data-progress-expression-settle-ms={WORK_PROGRESS_EXPRESSION_SETTLE_MS}
      data-progress-expression-morph-ms={WORK_PROGRESS_EXPRESSION_MORPH_MS}
      {...(progress.actor ? { 'data-progress-actor': progress.actor } : {})}
    >
      <span className="work-progress-visual" aria-hidden="true">
        <img src="./assets/bloub-progress.svg" alt="" className="work-progress-fallback" />
        {idle ? (
          <img
            src="./assets/bloub-idle.svg"
            alt=""
            className="work-progress-idle"
            data-progress-idle-svg
          />
        ) : (
          <svg
            ref={svgRef}
            className="work-progress-expression"
            viewBox="-125 -125 250 250"
            data-progress-expression-svg={displayExpression}
            data-progress-expression-active="true"
            data-progress-expression-morphing="false"
            data-progress-default-svg=""
          >
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse" x="-158" y="-158" width="316" height="316">
                <path d={WORK_PROGRESS_CLOUD_BODY_PATH} fill="#fff" />
                <g className="work-progress-eye-motion work-progress-eye-motion-left">
                  <path
                    ref={eye0Ref}
                    d={initialEyes[0].path}
                    transform={eyeMatrixAttribute(initialEyes[0].matrix)}
                    fill="#000"
                    data-progress-expression-eye="left"
                  />
                </g>
                <g className="work-progress-eye-motion work-progress-eye-motion-right">
                  <path
                    ref={eye1Ref}
                    d={initialEyes[1].path}
                    transform={eyeMatrixAttribute(initialEyes[1].matrix)}
                    fill="#000"
                    data-progress-expression-eye="right"
                  />
                </g>
              </mask>
            </defs>
            <path d={WORK_PROGRESS_CLOUD_BODY_PATH} fill="#f9f9f9" />
            <g mask={`url(#${maskId})`}>
              <rect x="-158" y="-158" width="316" height="316" fill="#0a0a0c" />
            </g>
          </svg>
        )}
      </span>
      <span
        className={`work-progress-label${idle ? '' : ' shimmering'}`}
        data-work-progress-label
      >
        {displayLabel}
      </span>
    </div>
  );
};

