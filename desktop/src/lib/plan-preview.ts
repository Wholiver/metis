export interface ProposedPlanParts {
  before: string;
  plan: string;
  after: string;
  partial: boolean;
}

const OPEN_TAG = '<proposed_plan>';
const CLOSE_TAG = '</proposed_plan>';

function tagPositions(source: string, tag: string): number[] {
  const positions: number[] = [];
  const lowerSource = source.toLowerCase();
  let offset = 0;
  while (offset < source.length) {
    const index = lowerSource.indexOf(tag, offset);
    if (index < 0) break;
    positions.push(index);
    offset = index + tag.length;
  }
  return positions;
}

export function extractProposedPlan(text: string, allowPartial = false): ProposedPlanParts | undefined {
  const source = String(text || '');
  const opens = tagPositions(source, OPEN_TAG);
  const closes = tagPositions(source, CLOSE_TAG);
  if (opens.length !== 1 || closes.length > 1) return undefined;

  const contentStart = opens[0] + OPEN_TAG.length;
  if (closes.length === 0) {
    if (!allowPartial) return undefined;
    return {
      before: source.slice(0, opens[0]).trim(),
      plan: source.slice(contentStart).trim(),
      after: '',
      partial: true,
    };
  }

  if (closes[0] < contentStart) return undefined;
  return {
    before: source.slice(0, opens[0]).trim(),
    plan: source.slice(contentStart, closes[0]).trim(),
    after: source.slice(closes[0] + CLOSE_TAG.length).trim(),
    partial: false,
  };
}

export function splitPlanTitle(markdown: string): { title: string; body: string } {
  const lines = String(markdown || '').split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (headingIndex < 0) return { title: 'Plan', body: markdown.trim() };
  const title = lines[headingIndex].trim().replace(/^#\s+/, '').trim();
  lines.splice(headingIndex, 1);
  return { title, body: lines.join('\n').trim() };
}

