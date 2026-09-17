export const COMPOSER_MULTILINE_MIN_TEXTAREA_HEIGHT = 48;
export const COMPOSER_MULTILINE_MAX_TEXTAREA_HEIGHT = 112;
export const COMPOSER_EXPANDED_MAX_TEXTAREA_HEIGHT = 240;

export interface ComposerActivityState {
  localTaskPending: boolean;
  sawServerStreaming: boolean;
}

export type ComposerActivityEvent =
  | { type: 'send-started' }
  | { type: 'send-settled' }
  | { type: 'server-streaming-changed'; streaming: boolean };

export const IDLE_COMPOSER_ACTIVITY: ComposerActivityState = {
  localTaskPending: false,
  sawServerStreaming: false,
};

export function reduceComposerActivity(
  state: ComposerActivityState,
  event: ComposerActivityEvent,
): ComposerActivityState {
  if (event.type === 'send-started') {
    return { localTaskPending: true, sawServerStreaming: false };
  }
  if (event.type === 'send-settled') {
    return IDLE_COMPOSER_ACTIVITY;
  }
  if (!state.localTaskPending) return state;
  if (event.streaming) {
    return state.sawServerStreaming
      ? state
      : { ...state, sawServerStreaming: true };
  }
  return state.sawServerStreaming ? IDLE_COMPOSER_ACTIVITY : state;
}

export function hasComposerLineBreak(text: string): boolean {
  return /[\r\n]/.test(text);
}

export function composerTextareaHeight(scrollHeight: number, expanded: boolean): number {
  const maximum = expanded
    ? COMPOSER_EXPANDED_MAX_TEXTAREA_HEIGHT
    : COMPOSER_MULTILINE_MAX_TEXTAREA_HEIGHT;
  return Math.min(Math.max(scrollHeight, COMPOSER_MULTILINE_MIN_TEXTAREA_HEIGHT), maximum);
}

/** Chinese Chromium/macOS accessibility list markers: "第 … 项/項". */
const ACCESSIBILITY_LIST_WRAPPER =
  /^第(?:\s*[\d一二三四五六七八九十]+[.\s、项項:：]+|\s*[-*•·]\s*|\s*)([\s\S]+?)\s*[项項][。.]?$/;

function unwrapAccessibilityListItem(value: string): string | undefined {
  const match = ACCESSIBILITY_LIST_WRAPPER.exec(value.trim());
  if (!match) return undefined;
  const inner = match[1].trim();
  if (!inner || /^(\d+|[一二三四五六七八九十]+)$/.test(inner)) return undefined;
  return inner;
}

function cleanSingleLineArtifact(line: string): string {
  return unwrapAccessibilityListItem(line) ?? line;
}

export function cleanPastedText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  // Strip invisible unicode zero-width characters, BOM, and direction marks
  const sanitized = raw.replace(/[\u200B-\u200D\uFEFF\u2060\u200E\u200F]/g, '');
  const trimmed = sanitized.trim();

  // 1. Single list item wrapper (or multiline content wrapped in a single "第 ... 项")
  const singleInner = unwrapAccessibilityListItem(trimmed);
  if (
    singleInner
    && !singleInner.includes(' 项')
    && !singleInner.includes(' 項')
    && !singleInner.includes('第 ')
  ) {
    return singleInner;
  }

  // 2. Multiple lines where each line might have its own "第 ... 项" wrapper
  if (sanitized.includes('\n')) {
    const lines = sanitized.split(/\r?\n/);
    let anyCleaned = false;
    const cleanedLines = lines.map((line) => {
      const cleaned = cleanSingleLineArtifact(line);
      if (cleaned !== line) anyCleaned = true;
      return cleaned;
    });
    if (anyCleaned) {
      return cleanedLines.join('\n').trim();
    }
  }

  // 3. Fallback for single match if multiline split did not clean
  if (singleInner) {
    return singleInner;
  }

  return sanitized;
}
