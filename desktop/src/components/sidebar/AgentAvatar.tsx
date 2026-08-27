import React from 'react';
import { AvatarType } from '../../types';

interface AgentAvatarProps {
  type: AvatarType;
  className?: string;
  size?: number;
}

// Reusable signature twin-capsule specular highlight matching zoom 1:1
const TwinHighlight: React.FC<{ x: number; y: number; rotate?: number; scale?: number }> = ({
  x,
  y,
  rotate = 25,
  scale = 1,
}) => (
  <g transform={`translate(${x}, ${y}) rotate(${rotate}) scale(${scale})`}>
    <rect x="-3" y="-3.2" width="2.4" height="6.2" rx="1.2" fill="#ffffff" fillOpacity="0.95" />
    <rect x="1.2" y="-1.8" width="2.2" height="4.8" rx="1.1" fill="#ffffff" fillOpacity="0.95" />
  </g>
);

export const AgentAvatar: React.FC<AgentAvatarProps> = ({ type, className = '', size = 38 }) => {
  switch (type) {
    case 'blob': // 1. Chief of Staff: Purple Sphere
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <circle cx="18" cy="18" r="12.5" fill="#7048ec" />
          <TwinHighlight x={22} y={11} rotate={26} scale={1.05} />
        </svg>
      );

    case 'drop': // 2. EA: Blue Water Droplet
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <path
            d="M18 6C18 6 8.5 17.5 8.5 22.5C8.5 27.8 12.8 31 18 31C23.2 31 27.5 27.8 27.5 22.5C27.5 17.5 18 6 18 6Z"
            fill="#2388ff"
          />
          <TwinHighlight x={21.5} y={15} rotate={24} scale={1} />
        </svg>
      );

    case 'cloud': // 3. Inbox Manager: Green Cloud
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <path
            d="M9.5 24C7.5 24 6 22.5 6 20.5C6 19 7 17.8 8.5 17.5C8.3 17 8.2 16.4 8.2 15.8C8.2 12.8 10.6 10.4 13.6 10.4C15.6 10.4 17.3 11.5 18.2 13.1C19.2 12 20.6 11.4 22.2 11.4C25.2 11.4 27.6 13.8 27.6 16.8C27.6 17.2 27.5 17.6 27.4 18C29.2 18.4 30.5 20 30.5 21.8C30.5 23.8 28.8 25.5 26.8 25.5H10.5C8.8 25.5 7.5 24.8 6.8 23.8"
            fill="#05c168"
          />
          <TwinHighlight x={22} y={12} rotate={24} scale={0.95} />
        </svg>
      );

    case 'droplet': // 4. Sales Outbound: Teal Box + Blue Droplet
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <path
            d="M8 12C8 9.8 9.8 8 12 8H20C22.2 8 24 9.8 24 12V14C21.5 14 19.5 16 19.5 18.5V24H12C9.8 24 8 22.2 8 20V12Z"
            fill="#0cbfa4"
          />
          <TwinHighlight x={17} y={10.5} rotate={24} scale={0.8} />

          <path
            d="M23 15C23 15 17.5 21.5 17.5 24.5C17.5 27.5 20 29.8 23 29.8C26 29.8 28.5 27.5 28.5 24.5C28.5 21.5 23 15 23 15Z"
            fill="#2388ff"
          />
          <TwinHighlight x={24.5} y={20} rotate={24} scale={0.75} />
        </svg>
      );

    case 'bean': // 5. Talent Scout: Brown Sphere
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <circle cx="18" cy="18" r="12.5" fill="#8d5b38" />
          <TwinHighlight x={22} y={11} rotate={26} scale={1.05} />
        </svg>
      );

    case 'water': // 6. Growth Marketer: Orange Egg / Oval
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <ellipse cx="18" cy="18" rx="10.5" ry="13" fill="#ff6d00" />
          <TwinHighlight x={22} y={11} rotate={26} scale={1.05} />
        </svg>
      );

    case 'pill': // 7. Customer Support: Coral-Red Pill
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <rect x="6.5" y="12" width="23" height="12" rx="6" fill="#ff385c" />
          <TwinHighlight x={23} y={13.5} rotate={26} scale={0.9} />
        </svg>
      );

    case 'triangle': // 8. Expense Manager: Pink Rounded Triangle
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <path
            d="M18 6.5C19.2 6.5 20.3 8 21 9.5L27.8 22.8C28.7 24.8 27.5 27 25.2 27H10.8C8.5 27 7.3 24.8 8.2 22.8L15 9.5C15.7 8 16.8 6.5 18 6.5Z"
            fill="#f43f8e"
          />
          <TwinHighlight x={21.5} y={14.5} rotate={26} scale={0.9} />
        </svg>
      );

    case 'square': // 9. Invoice Collector: Blue-Purple Rounded Squircle
      return (
        <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className={`flex-shrink-0 ${className}`}>
          <rect x="7" y="7" width="22" height="22" rx="7.5" fill="#5856d6" />
          <TwinHighlight x={22} y={10.5} rotate={26} scale={0.95} />
        </svg>
      );

    default:
      return (
        <div className={`w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white font-medium ${className}`}>
          M
        </div>
      );
  }
};

