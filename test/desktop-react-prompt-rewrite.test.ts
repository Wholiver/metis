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
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('does not skip performance_admit');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).not.toContain('named-child dispatch');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('root-owned zero spawn');
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

  it('forbids silhouette intersections anywhere in the drawing', () => {
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('不该相交的轮廓不要互相切开');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('整幅每一处都检查，不限于某一对零件');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).not.toContain('挡泥板应在轮胎外侧绕过');
  });

  it('forbids see-through solids and limbs being pierced by what they hold', () => {
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('实体默认不透明');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('不能让车把从翅膀中间穿过');
  });

  it('forbids connectors being drawn through another part\'s interior', () => {
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('不要画进另一件的内部平面');
    expect(PELICAN_BIKE_SVG_MODEL_PROMPT).toContain('不要一条管子横贴在轮面上把辐条盖住或切断');
  });

  it('sends the rewritten prompt on the Desktop prompt request path', () => {
    const hook = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(hook).toContain("await request('/session/prompt', 'POST', {");
    expect(hook).toContain('message: wireMessage');
    expect(hook).toContain('rewritePromptForModel(cleanPastedText(text))');
    expect(hook).toContain('revealPromptForDisplay(cleanPastedText(options.displayText ?? text))');
  });
});
