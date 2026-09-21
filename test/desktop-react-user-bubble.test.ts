import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSubagentAssistantMessage,
  buildSubagentTaskMessage,
} from '../desktop/src/components/chat/SubagentConversation';
import { UserBubble, resolveUserPromptCopyText } from '../desktop/src/components/chat/UserBubble';
import { composeAttachmentPayload } from '../desktop/src/lib/attachments';
import {
  PELICAN_BIKE_SVG_MODEL_PROMPT,
  PELICAN_BIKE_SVG_USER_PROMPT,
} from '../desktop/src/lib/prompt-rewrite';
import type { SubagentItem } from '../desktop/src/lib/subagents';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

describe('desktop React user message bubble', () => {
  it('uses a white surface with a visible border for sent user message blocks', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/UserBubble.tsx'),
      'utf8',
    );

    expect(source).toContain('data-user-bubble=""');
    expect(source).toContain('data-user-prompt-copy=""');
    expect(source).toContain('data-user-prompt-copy-wrapper=""');
    expect(source).toContain('bg-surface');
    expect(source).toContain('border border-line');
    expect(source).toContain('rounded-[10px]');
    expect(source).toContain('normalizeUserMessageForDisplay');
    expect(source).not.toContain('bg-[#f1f1f1]');
  });

  it('hides metis_attachment wire format when rendering reloaded user messages', () => {
    const attachment = {
      id: '4dd707ba-4a24-4ee8-80ff-40dd174f1646',
      kind: 'image' as const,
      name: '截屏2026-09-13 21.30.05.png',
      sizeText: '1.0 KB',
      mimeType: 'image/png',
      data: 'iVBORw0KGgo=',
      previewUrl: 'data:image/png;base64,iVBORw0KGgo=',
    };
    const payload = composeAttachmentPayload('这是软件目前的内存占用，我希望你优化一下', [attachment]);
    const markup = renderToStaticMarkup(React.createElement(UserBubble, {
      message: {
        id: 'user-1',
        role: 'user',
        content: payload.message,
        attachments: [attachment],
      },
    }));
    expect(markup).toContain('这是软件目前的内存占用，我希望你优化一下');
    expect(markup).not.toContain('<metis_attachment');
    expect(markup).not.toContain('metis_attachment');
    expect(markup).toContain('data-message-attachment="image"');
  });

  it('strips browser accessibility list item wrappers when displaying user messages', () => {
    const markup = renderToStaticMarkup(React.createElement(UserBubble, {
      message: {
        id: 'user-2',
        role: 'user',
        content: '第 Generate an SVG / a pelican riding a bicycle 项',
      },
    }));
    expect(markup).toContain('Generate an SVG / a pelican riding a bicycle');
    expect(markup).not.toContain('第 Generate an SVG / a pelican riding a bicycle 项');
    expect(markup).toContain('data-i18n-skip');

    const traditional = renderToStaticMarkup(React.createElement(UserBubble, {
      message: {
        id: 'user-2b',
        role: 'user',
        content: '第Generate an SVG / a pelican riding a bicycle項',
      },
    }));
    expect(traditional).toContain('Generate an SVG / a pelican riding a bicycle');
    expect(traditional).not.toContain('第Generate');
    expect(traditional).not.toContain('項');
  });

  it('shows the original pelican SVG prompt after Desktop rewrites the model-facing text', () => {
    const markup = renderToStaticMarkup(React.createElement(UserBubble, {
      message: {
        id: 'user-pelican',
        role: 'user',
        content: PELICAN_BIKE_SVG_MODEL_PROMPT,
      },
    }));
    expect(markup).toContain(PELICAN_BIKE_SVG_USER_PROMPT);
    expect(markup).not.toContain('使用内置浏览器实时检查和验收');
    expect(resolveUserPromptCopyText({ content: PELICAN_BIKE_SVG_MODEL_PROMPT })).toBe(PELICAN_BIKE_SVG_USER_PROMPT);
  });

  it('places a copy control under the prompt and copies visible text only', () => {
    const attachment = {
      id: 'att-1',
      kind: 'text' as const,
      name: 'notes.txt',
      sizeText: '1 KB',
    };
    const payload = composeAttachmentPayload('请优化内存占用', [attachment]);
    expect(resolveUserPromptCopyText({
      content: payload.message,
      attachments: [attachment],
    })).toBe('请优化内存占用');

    const withText = renderToStaticMarkup(React.createElement(UserBubble, {
      message: {
        id: 'user-copy',
        role: 'user',
        content: payload.message,
        attachments: [attachment],
      },
    }));
    expect(withText).toContain('data-user-prompt-copy=""');
    expect(withText).toContain('data-user-prompt-copy-wrapper=""');
    expect(withText.indexOf('data-user-bubble=""')).toBeLessThan(withText.indexOf('data-user-prompt-copy=""'));
    const bubbleSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/UserBubble.tsx'), 'utf8');
    expect(bubbleSource).toContain("t('copyPrompt')");
    expect(withText).toMatch(/aria-label="(?:Copy prompt|copyPrompt)"/);

    const attachmentOnly = renderToStaticMarkup(React.createElement(UserBubble, {
      message: {
        id: 'user-copy-empty',
        role: 'user',
        content: '',
        attachments: [attachment],
      },
    }));
    expect(attachmentOnly).not.toContain('data-user-prompt-copy=""');
    expect(resolveUserPromptCopyText({ content: '   ', attachments: [] })).toBe('');

    const main = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(main).toContain('userCopyBelowBubble');
    expect(main).toContain('userCopyRightAligned');
    expect(main).toContain('[data-user-prompt-copy]');
  });

  it('routes subagent task bubbles through the shared UserBubble component', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/SubagentConversation.tsx'),
      'utf8',
    );

    expect(source).toContain('<UserBubble');
    expect(source).toContain('<AssistantTurn');
    expect(source).toContain('data-message-scroll');
    expect(source).toContain('data-message-lane');
    expect(source).not.toContain('Execution Error');
    expect(source).not.toContain('WorkProgressIndicator');
    expect(source).not.toContain('MarkdownContent');
  });

  it('maps SubagentItem into main-chat Message shapes', () => {
    const subagent: SubagentItem = {
      id: 'spawn-1',
      role: 'researcher',
      task: 'Find README patterns',
      context: 'Focus on open source',
      status: 'failed',
      error: 'boom',
      startedAt: 1000,
      completedAt: 2000,
      parts: [{ type: 'text', id: 't1', text: 'hello' }],
    };

    expect(buildSubagentTaskMessage(subagent)).toMatchObject({
      id: 'spawn-1-task',
      role: 'user',
      content: 'Find README patterns\n\nFocus on open source',
    });
    expect(buildSubagentAssistantMessage(subagent)).toMatchObject({
      id: 'spawn-1',
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'boom',
      streaming: false,
      parts: [{ id: 't1' }],
    });
    expect(buildSubagentAssistantMessage({ ...subagent, status: 'running', error: undefined })).toMatchObject({
      streaming: true,
    });
  });
});
