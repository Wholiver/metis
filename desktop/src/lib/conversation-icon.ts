export const CONVERSATION_ICON_SHAPE_COUNT = 8;

// SVG user-space offsets for optical, rather than geometric, centering.
export const CONVERSATION_ICON_OPTICAL_Y = [0, 0, 0, 0, 20, 0, 0, 0] as const;

export const CONVERSATION_ICON_COLORS = [
  '#8b5cf6',
  '#2f9cf4',
  '#16c784',
  '#20bfa9',
  '#a66a3f',
  '#ff6b0b',
  '#ff405d',
  '#f04f9b',
  '#5b5ce6',
  '#16a3d8',
] as const;

export interface ConversationIconAssignment {
  shapeIndex: number;
  color: (typeof CONVERSATION_ICON_COLORS)[number];
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function conversationIconAssignment(seed: string): ConversationIconAssignment {
  const stableSeed = seed || 'new-conversation';
  const shapeHash = hashSeed(`${stableSeed}:shape`);
  const colorHash = hashSeed(`${stableSeed}:color`);

  return {
    shapeIndex: shapeHash % CONVERSATION_ICON_SHAPE_COUNT,
    color: CONVERSATION_ICON_COLORS[colorHash % CONVERSATION_ICON_COLORS.length],
  };
}

