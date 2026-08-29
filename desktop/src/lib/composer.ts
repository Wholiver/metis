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
