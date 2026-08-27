import React from 'react';
import {
  CONVERSATION_ICON_OPTICAL_Y,
  conversationIconAssignment,
} from '../../lib/conversation-icon';

interface ConversationIconProps {
  seed: string;
  size?: number;
  className?: string;
}

export const ConversationIcon: React.FC<ConversationIconProps> = ({
  seed,
  size = 48,
  className = '',
}) => {
  const { shapeIndex, color } = conversationIconAssignment(seed);
  const opticalOffsetY = CONVERSATION_ICON_OPTICAL_Y[shapeIndex];

  return (
    <span
      aria-hidden="true"
      className="flex h-[50px] w-[38px] flex-none items-center justify-center overflow-visible"
      data-conversation-icon-slot=""
    >
      <svg
        focusable="false"
        viewBox="-125 -125 250 250"
        className={`block flex-none overflow-visible ${className}`}
        style={{ color, width: size, height: size }}
        data-conversation-icon=""
        data-icon-shape={shapeIndex}
        data-icon-color={color}
      >
        <use
          href={`./assets/conversation-icons.svg#conversation-shape-${shapeIndex}`}
          x="-125"
          y="-125"
          width="250"
          height="250"
          transform={`translate(0 ${opticalOffsetY})`}
        />
      </svg>
    </span>
  );
};

