export type BrowserToolLike = {
  type?: string;
  name?: string;
  result?: unknown;
  progress?: { state?: string };
};

export function isBrowserToolName(name: string | undefined): boolean {
  return String(name || '').toLowerCase().startsWith('browser_');
}

function isBrowserToolPart(part: BrowserToolLike): boolean {
  return part.type === 'toolCall' && isBrowserToolName(part.name);
}

export function collectCurrentTurnToolParts(
  messages: Array<{ role?: string; parts?: BrowserToolLike[] }> | undefined,
): BrowserToolLike[] {
  if (!messages || messages.length === 0) return [];
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      start = index + 1;
      break;
    }
  }
  const parts: BrowserToolLike[] = [];
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || !message.parts) continue;
    for (const part of message.parts) {
      if (part?.type === 'toolCall') parts.push(part);
    }
  }
  return parts;
}

export function isBrowserBeingControlled(
  toolParts: BrowserToolLike[] | undefined,
  streaming: boolean,
): boolean {
  if (!toolParts || toolParts.length === 0) return false;
  let hasBrowser = false;
  for (const part of toolParts) {
    if (!isBrowserToolPart(part)) continue;
    hasBrowser = true;
    if (part.progress?.state === 'running') return true;
  }
  return hasBrowser && streaming;
}

export function resolveBrowserShineActive(options: {
  hostBusy: boolean;
  streaming: boolean;
  latched: boolean;
  messages?: Array<{ role?: string; parts?: BrowserToolLike[] }>;
  toolParts?: BrowserToolLike[];
}): { active: boolean; nextLatched: boolean } {
  const parts = options.toolParts ?? collectCurrentTurnToolParts(options.messages);
  const turnControlled = isBrowserBeingControlled(parts, options.streaming);
  if (options.hostBusy || turnControlled) {
    return { active: true, nextLatched: true };
  }
  if (!options.streaming) {
    return { active: false, nextLatched: false };
  }
  return { active: options.latched, nextLatched: options.latched };
}
