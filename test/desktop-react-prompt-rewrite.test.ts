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
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('root-owned zero spawn');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('at least T1 with independent G5 review and G6 verification');
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

  it('asks for a playable browser Minecraft and leaves the stack open', () => {
    expect(WEB_MINECRAFT_MODEL_PROMPT.length).toBeLessThan(700);
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('网页版我的世界');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('现在就动手做并跑起来');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('不要只给方案');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('打开就是游戏');
    expect(WEB_MINECRAFT_USER_PROMPT).not.toContain('Next.js');
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('Next.js');
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('WebGL');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('编程语言、框架和渲染引擎你自己选');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('必须是在浏览器里直接打开就能玩的网页');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('能走、能跳、能挖、能放');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('会自己走动的动物');
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('贴图');
    expect(WEB_MINECRAFT_MODEL_PROMPT).toContain('Mac M1 8GB');
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('内置浏览器');
    expect(WEB_MINECRAFT_MODEL_PROMPT).not.toContain('光影是硬性验收');
  });

  it('sends the rewritten prompt on the Desktop prompt request path', () => {
    const hook = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(hook).toContain("await request('/session/prompt', 'POST', {");
    expect(hook).toContain('message: wireMessage');
    expect(hook).toContain('rewritePromptForModel(cleanPastedText(text))');
    expect(hook).toContain('revealPromptForDisplay(cleanPastedText(options.displayText ?? text))');
  });
});
