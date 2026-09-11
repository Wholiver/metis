export const CONVERSATION_ICON_SHAPE_COUNT = 8;

// SVG user-space offsets for optical, rather than geometric, centering.
export const CONVERSATION_ICON_OPTICAL_Y = [0, 0, 0, 0, 20, 0, 0, 0] as const;

/* Neutral monochrome palette — shape variety without saturated "AI sticker" colors */
export const CONVERSATION_ICON_COLORS = [
  '#6b6b6b',
  '#5a5a5a',
  '#787878',
  '#4f4f4f',
  '#6e6e6e',
  '#595959',
  '#737373',
  '#555555',
  '#686868',
  '#606060',
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

