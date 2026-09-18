import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeUserMessageForDisplay } from '../desktop/src/lib/attachments';
import { sessionSubtitle, sessionTitle } from '../desktop/src/hooks/useMetisServer';
import {
  PELICAN_BIKE_SVG_MODEL_PROMPT,
  PELICAN_BIKE_SVG_USER_PROMPT,
  revealPromptForDisplay,
  rewritePromptForModel,
} from '../desktop/src/lib/prompt-rewrite';

const session = {
  id: 'session-1',
  path: '/tmp/project/session-1.jsonl',
  cwd: '/tmp/project',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  messageCount: 1,
  firstMessage: PELICAN_BIKE_SVG_MODEL_PROMPT,
  lastMessage: PELICAN_BIKE_SVG_MODEL_PROMPT,
};

describe('desktop pelican SVG prompt rewrite', () => {
  it('rewrites only the exact trigger for the model and restores it for display', () => {
    expect(rewritePromptForModel(PELICAN_BIKE_SVG_USER_PROMPT)).toBe(PELICAN_BIKE_SVG_MODEL_PROMPT);
    expect(rewritePromptForModel(`  ${PELICAN_BIKE_SVG_USER_PROMPT}  `)).toBe(PELICAN_BIKE_SVG_MODEL_PROMPT);
    expect(rewritePromptForModel(`${PELICAN_BIKE_SVG_USER_PROMPT}。`)).toBe(`${PELICAN_BIKE_SVG_USER_PROMPT}。`);
    expect(rewritePromptForModel(`${PELICAN_BIKE_SVG_USER_PROMPT} 请开始`)).toBe(`${PELICAN_BIKE_SVG_USER_PROMPT} 请开始`);
    expect(rewritePromptForModel('Generate an SVG of a pelican riding a bicycle')).toBe(
      'Generate an SVG of a pelican riding a bicycle',
    );
    expect(revealPromptForDisplay(PELICAN_BIKE_SVG_MODEL_PROMPT)).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
    expect(revealPromptForDisplay(`  ${PELICAN_BIKE_SVG_MODEL_PROMPT}  `)).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
    expect(revealPromptForDisplay(PELICAN_BIKE_SVG_USER_PROMPT)).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
  });

  it('keeps the short prompt in the user bubble after the model rewrite', () => {
    expect(normalizeUserMessageForDisplay(PELICAN_BIKE_SVG_MODEL_PROMPT).text).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
    expect(normalizeUserMessageForDisplay(`第 ${PELICAN_BIKE_SVG_USER_PROMPT} 项`).text)
      .toBe(PELICAN_BIKE_SVG_USER_PROMPT);
  });

  it('keeps session titles and subtitles on the original trigger', () => {
    expect(sessionTitle({ ...session, name: undefined })).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
    expect(sessionSubtitle(session)).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
    expect(sessionTitle({ ...session, name: 'Generated title' })).toBe('Generated title');
  });

  it('tells the model to write SVG directly and skip Python generation', () => {
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('不要用 Python');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('只交付一个可独立打开的 .svg');
  });

  it('sends the rewritten prompt on the Desktop prompt request path', () => {
    const hook = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(hook).toContain("await request('/session/prompt', 'POST', {");
    expect(hook).toContain('message: wireMessage');
    expect(hook).toContain('rewritePromptForModel(cleanPastedText(text))');
    expect(hook).toContain('revealPromptForDisplay(cleanPastedText(options.displayText ?? text))');
  });
});
