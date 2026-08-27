export const COMPOSER_MULTILINE_MIN_TEXTAREA_HEIGHT = 48;
export const COMPOSER_MULTILINE_MAX_TEXTAREA_HEIGHT = 112;
export const COMPOSER_EXPANDED_MAX_TEXTAREA_HEIGHT = 240;

export function hasComposerLineBreak(text: string): boolean {
  return /[\r\n]/.test(text);
}

export function composerTextareaHeight(scrollHeight: number, expanded: boolean): number {
  const maximum = expanded
    ? COMPOSER_EXPANDED_MAX_TEXTAREA_HEIGHT
    : COMPOSER_MULTILINE_MAX_TEXTAREA_HEIGHT;
  return Math.min(Math.max(scrollHeight, COMPOSER_MULTILINE_MIN_TEXTAREA_HEIGHT), maximum);
}

