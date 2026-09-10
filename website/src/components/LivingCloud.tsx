import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

export type CloudExpression = 'neutral' | 'idle' | 'attentive' | 'happy';

export interface LivingCloudHandle {
  setExpression: (expr: CloudExpression) => void;
}

interface LivingCloudProps {
  expression?: CloudExpression;
  alt: string;
  reducedMotion?: boolean;
  className?: string;
  interactive?: boolean;
  onExpressionChange?: (expr: CloudExpression) => void;
}

export const CLOUD_BODY = 'M91.07 -0.35C92.37 2.64 93.39 5.82 94.08 9.01C94.78 12.2 95.16 15.52 95.22 18.78C95.28 22.05 95.01 25.38 94.44 28.59C93.86 31.8 92.95 35.01 91.76 38.05C90.57 41.09 89.05 44.06 87.3 46.81C85.54 49.55 83.47 52.17 81.22 54.51C78.96 56.86 76.42 59.02 73.75 60.88C71.08 62.74 68.17 64.36 65.19 65.66C62.21 66.96 59.04 67.98 55.87 68.67C52.69 69.35 48.78 68.6 46.13 69.78C43.49 70.96 42.17 73.9 39.97 75.74C37.78 77.59 35.42 79.31 32.96 80.84C30.51 82.36 27.9 83.74 25.23 84.89C22.56 86.05 19.77 87.03 16.94 87.79C14.12 88.55 11.2 89.1 8.29 89.44C5.39 89.77 2.42 89.89 -0.51 89.8C-3.43 89.7 -6.38 89.38 -9.25 88.85C-12.12 88.33 -14.98 87.58 -17.73 86.64C-20.48 85.71 -23.18 84.56 -25.74 83.24C-28.31 81.93 -30.77 80.36 -33.12 78.75C-35.47 77.15 -37.1 74.47 -39.85 73.61C-42.6 72.74 -46.4 73.86 -49.64 73.54C-52.89 73.22 -56.18 72.59 -59.33 71.67C-62.49 70.75 -65.62 69.52 -68.57 68.04C-71.52 66.55 -74.38 64.75 -77.01 62.74C-79.65 60.72 -82.14 58.42 -84.36 55.95C-86.58 53.47 -88.61 50.74 -90.34 47.9C-92.07 45.05 -93.57 41.99 -94.74 38.87C-95.92 35.75 -96.82 32.46 -97.4 29.18C-97.99 25.9 -98.27 22.51 -98.24 19.18C-98.21 15.86 -97.86 12.48 -97.22 9.22C-96.58 5.97 -95.63 2.72 -94.41 -0.35C-93.19 -3.42 -91.67 -6.42 -89.92 -9.2C-88.18 -11.98 -86.14 -14.63 -83.94 -17.02C-81.74 -19.42 -78.66 -21.38 -76.72 -23.58C-74.78 -25.78 -73.16 -27.74 -72.31 -30.23C-71.46 -32.72 -72.09 -35.8 -71.62 -38.54C-71.15 -41.28 -70.44 -44.03 -69.49 -46.66C-68.55 -49.29 -67.36 -51.89 -65.97 -54.33C-64.58 -56.76 -62.95 -59.12 -61.15 -61.28C-59.35 -63.44 -57.33 -65.47 -55.18 -67.28C-53.03 -69.09 -50.68 -70.73 -48.25 -72.13C-45.81 -73.54 -43.22 -74.74 -40.59 -75.69C-37.95 -76.63 -35.19 -77.36 -32.45 -77.83C-29.7 -78.3 -26.87 -78.52 -24.1 -78.5C-21.33 -78.48 -18.53 -78.21 -15.82 -77.72C-13.12 -77.22 -10.43 -76.47 -7.88 -75.53C-5.32 -74.59 -2.83 -73.4 -0.51 -72.06C1.82 -70.72 3.94 -68.64 6.07 -67.47C8.21 -66.29 10.01 -65 12.29 -64.99C14.57 -64.98 17.19 -66.82 19.74 -67.4C22.28 -67.97 24.94 -68.33 27.57 -68.44C30.2 -68.55 32.89 -68.43 35.51 -68.06C38.13 -67.68 40.78 -67.06 43.3 -66.22C45.82 -65.37 48.31 -64.27 50.65 -62.98C52.98 -61.68 55.24 -60.14 57.3 -58.43C59.37 -56.72 61.31 -54.79 63.03 -52.73C64.74 -50.68 66.3 -48.42 67.62 -46.08C68.93 -43.74 70.05 -41.24 70.92 -38.71C71.78 -36.17 72.42 -33.51 72.82 -30.86C73.21 -28.22 72.08 -25.24 73.26 -22.83C74.45 -20.43 77.76 -18.74 79.93 -16.42C82.1 -14.11 84.43 -11.62 86.29 -8.94C88.14 -6.26 89.77 -3.34 91.07 -0.35Z';

// Oval pill base path
const PILL_PATH = 'M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z';

// Happy smiling crescent arc base path
const SMILE_PATH = 'M-13.5 0A8.5 8.5 0 0 1 -5 -8.5L5 -8.5A8.5 8.5 0 0 1 13.5 0L13.5 0A8.5 8.5 0 0 1 5 8.5L-5 8.5A8.5 8.5 0 0 1 -13.5 0Z';

export const LivingCloud = forwardRef<SVGSVGElement, LivingCloudProps>(function LivingCloud(
  {
    expression = 'idle',
    alt,
    reducedMotion = false,
    className,
    interactive = true,
    onExpressionChange,
  },
  forwardedRef,
) {
  const maskId = `living-cloud-mask-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement | null>(null);

  useImperativeHandle(forwardedRef, () => svgRef.current as SVGSVGElement);

  const [activeExpr, setActiveExpr] = useState<CloudExpression>(reducedMotion ? 'neutral' : expression);

  useEffect(() => {
    setActiveExpr(reducedMotion ? 'neutral' : expression);
  }, [expression, reducedMotion]);

  const handlePointerEnter = () => {
    if (reducedMotion || !interactive) return;
    setActiveExpr('happy');
    onExpressionChange?.('happy');
  };

  const handlePointerLeave = () => {
    if (reducedMotion || !interactive) return;
    setActiveExpr('idle');
    onExpressionChange?.('idle');
  };

  const handleClick = () => {
    if (reducedMotion || !interactive) return;
    setActiveExpr('happy');
    onExpressionChange?.('happy');
    window.setTimeout(() => {
      setActiveExpr('idle');
      onExpressionChange?.('idle');
    }, 1800);
  };

  const isHappy = activeExpr === 'happy';

  // Completely stationary, fixed coordinates
  const pillLeftTransform = 'matrix(0.87, -0.34, 0.44, 0.86, 13.56, -26.88)';
  const pillRightTransform = 'matrix(0.64, -0.09, 0.44, 0.86, 49.24, -38.96)';

  const smileLeftTransform = 'matrix(0.96, 0.18, -0.21, 0.97, 13.32, -25.56) scale(1.05)';
  const smileRightTransform = 'matrix(0.87, -0.18, 0.25, 0.97, 48.82, -37.39) scale(1.05)';

  return (
    <div className="living-cloud-stage">
      <svg
        ref={svgRef}
        className={`living-cloud-svg ${className || ''}`}
        viewBox="-125 -125 250 250"
        role="img"
        aria-label={alt}
        data-cloud-expression={activeExpr}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      >
        <defs>
          <filter id={`${maskId}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="16" floodColor="#09090b" floodOpacity="0.12" />
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#09090b" floodOpacity="0.05" />
          </filter>
        </defs>

        {/* Completely Stationary Black Cloud Body */}
        <path
          d={CLOUD_BODY}
          fill="#09090b"
          className="cloud-body-path"
          filter={`url(#${maskId}-shadow)`}
        />

        {/* Normal Pill Eyes */}
        <g
          className="cloud-eyes-pill"
          fill="#ffffff"
          style={{
            opacity: isHappy ? 0 : 1,
            transform: isHappy ? 'scale(0.85)' : 'scale(1)',
            transformOrigin: '28px -32px',
            transition: reducedMotion
              ? 'none'
              : 'opacity 0.2s ease-out, transform 0.2s ease-out',
            pointerEvents: 'none',
          }}
        >
          <path
            d={PILL_PATH}
            transform={pillLeftTransform}
            className="cloud-eye cloud-eye-left"
          />
          <path
            d={PILL_PATH}
            transform={pillRightTransform}
            className="cloud-eye cloud-eye-right"
          />
        </g>

        {/* Happy Smiling Crescent Eyes */}
        <g
          className="cloud-eyes-smile"
          fill="#ffffff"
          style={{
            opacity: isHappy ? 1 : 0,
            transform: isHappy ? 'scale(1)' : 'scale(0.8)',
            transformOrigin: '28px -32px',
            transition: reducedMotion
              ? 'none'
              : 'opacity 0.2s ease-out, transform 0.2s ease-out',
            pointerEvents: 'none',
          }}
        >
          <path
            d={SMILE_PATH}
            transform={smileLeftTransform}
            className="cloud-smile-eye cloud-smile-left"
          />
          <path
            d={SMILE_PATH}
            transform={smileRightTransform}
            className="cloud-smile-eye cloud-smile-right"
          />
        </g>
      </svg>
    </div>
  );
});
