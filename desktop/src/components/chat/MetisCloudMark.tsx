import React, { useId } from 'react';
import {
  WORK_PROGRESS_CLOUD_BODY_PATH,
  WORK_PROGRESS_EYE_TARGETS,
} from '../../lib/work-progress-expression-morph';

function eyeMatrixAttribute(matrix: readonly [number, number, number, number, number, number]): string {
  return `matrix(${matrix.join(' ')})`;
}

const NEUTRAL_EYES = WORK_PROGRESS_EYE_TARGETS.neutral;

type MetisCloudMarkProps = {
  className?: string;
  size?: number;
};

export const MetisCloudMark: React.FC<MetisCloudMarkProps> = ({
  className = '',
  size = 64,
}) => {
  const reactId = useId().replace(/:/g, '');
  const maskId = `metis-home-cloud-mask-${reactId}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="-125 -125 250 250"
      role="img"
      aria-label="Metis"
      data-home-cloud=""
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-158" y="-158" width="316" height="316">
          <path d={WORK_PROGRESS_CLOUD_BODY_PATH} fill="#fff" />
          <path
            d={NEUTRAL_EYES[0].path}
            transform={eyeMatrixAttribute(NEUTRAL_EYES[0].matrix)}
            fill="#000"
          />
          <path
            d={NEUTRAL_EYES[1].path}
            transform={eyeMatrixAttribute(NEUTRAL_EYES[1].matrix)}
            fill="#000"
          />
        </mask>
      </defs>
      <path d={WORK_PROGRESS_CLOUD_BODY_PATH} fill="#f4f4f2" />
      <g mask={`url(#${maskId})`}>
        <rect x="-158" y="-158" width="316" height="316" fill="#0a0a0c" />
      </g>
    </svg>
  );
};
