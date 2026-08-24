export type LocalizedValueState = { source: string; rendered: string };

export function splitSurroundingWhitespace(value: string): { leading: string; text: string; trailing: string } {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return match
    ? { leading: match[1], text: match[2], trailing: match[3] }
    : { leading: '', text: value, trailing: '' };
}

export function resolveLocalizedSource(current: string, previous?: LocalizedValueState): string {
  if (!previous) return current;
  return current === previous.source || current === previous.rendered
    ? previous.source
    : current;
}
