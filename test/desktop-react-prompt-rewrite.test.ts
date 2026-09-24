import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeUserMessageForDisplay } from '../desktop/src/lib/attachments';
import { sessionSubtitle, sessionTitle } from '../desktop/src/hooks/useMetisServer';
import {
  WEB_MINECRAFT_MODEL_PROMPT,
  WEB_MINECRAFT_USER_PROMPT,
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
  firstMessage: WEB_MINECRAFT_MODEL_PROMPT,
  lastMessage: WEB_MINECRAFT_MODEL_PROMPT,
};

describe('desktop web Minecraft prompt rewrite', () => {
  it('rewrites only the exact trigger for the model and restores it for display', () => {
    expect(rewritePromptForModel(WEB_MINECRAFT_USER_PROMPT)).toBe(WEB_MINECRAFT_MODEL_PROMPT);
    expect(rewritePromptForModel(`  ${WEB_MINECRAFT_USER_PROMPT}  `)).toBe(WEB_MINECRAFT_MODEL_PROMPT);
    expect(rewritePromptForModel(`${WEB_MINECRAFT_USER_PROMPT}。`)).toBe(`${WEB_MINECRAFT_USER_PROMPT}。`);
    expect(rewritePromptForModel(`${WEB_MINECRAFT_USER_PROMPT} 请开始`)).toBe(`${WEB_MINECRAFT_USER_PROMPT} 请开始`);
    expect(rewritePromptForModel('Generate an SVG of a pelican riding a bicycle')).toBe(
      'Generate an SVG of a pelican riding a bicycle',
    );
    expect(revealPromptForDisplay(WEB_MINECRAFT_MODEL_PROMPT)).toBe(WEB_MINECRAFT_USER_PROMPT);
    expect(revealPromptForDisplay(`  ${WEB_MINECRAFT_MODEL_PROMPT}  `)).toBe(WEB_MINECRAFT_USER_PROMPT);
    expect(revealPromptForDisplay(WEB_MINECRAFT_USER_PROMPT)).toBe(WEB_MINECRAFT_USER_PROMPT);
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('does not skip performance_admit');
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('named-child dispatch');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('root-owned zero spawn');
  });

  it('keeps the short prompt in the user bubble after the model rewrite', () => {
    expect(normalizeUserMessageForDisplay(WEB_MINECRAFT_MODEL_PROMPT).text).toBe(WEB_MINECRAFT_USER_PROMPT);
    expect(normalizeUserMessageForDisplay(`第 ${WEB_MINECRAFT_USER_PROMPT} 项`).text)
      .toBe(WEB_MINECRAFT_USER_PROMPT);
  });

  it('keeps session titles and subtitles on the original trigger', () => {
    expect(sessionTitle({ ...session, name: undefined })).toBe(WEB_MINECRAFT_USER_PROMPT);
    expect(sessionSubtitle(session)).toBe(WEB_MINECRAFT_USER_PROMPT);
    expect(sessionTitle({ ...session, name: 'Generated title' })).toBe('Generated title');
  });

  it('tells the model to start the Next.js game instead of stopping at a plan', () => {
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('现在就动手做并跑起来');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('不要只给方案');
  });

  it('treats visible shaders on an M1 8GB browser as a hard fail gate', () => {
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('光影是硬性验收，不过这一关不准结束');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('只要打开后看不出光影');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('水面必须有反光');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('Mac M1 8GB');
  });

  it('treats playable features as a hard fail gate', () => {
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('完整功能是硬性验收，不过这一关不准结束');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('只能看不能玩');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('整局每一处都检查，不限于某一个画面');
  });

  it('requires built-in browser verification and hands-on play before finishing', () => {
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('使用内置浏览器实时检查、验收和操作');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('不要改用系统浏览器');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('再在页面里亲手操作：移动、转视角、破坏、放置');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('你已经在内置浏览器里亲手操作过之后再结束');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('不必做一些调试界面');
  });

  it('sends the rewritten prompt on the Desktop prompt request path', () => {
    const hook = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(hook).toContain("await request('/session/prompt', 'POST', {");
    expect(hook).toContain('message: wireMessage');
    expect(hook).toContain('rewritePromptForModel(cleanPastedText(text))');
    expect(hook).toContain('revealPromptForDisplay(cleanPastedText(options.displayText ?? text))');
  });
});
