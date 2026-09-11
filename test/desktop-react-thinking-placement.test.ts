import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AssistantTurn } from '../desktop/src/components/chat/AssistantTurn';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

describe('desktop thinking placement', () => {
  it('shows ThinkingBlock on the live empty active turn', () => {
    const html = renderToStaticMarkup(React.createElement(AssistantTurn, {
      messages: [],
      streaming: true,
    }));
    expect(html).toContain('data-thinking-block');
  });

  it('hides ThinkingBlock when the empty turn is not streaming', () => {
    const html = renderToStaticMarkup(React.createElement(AssistantTurn, {
      messages: [],
      streaming: false,
    }));
    expect(html).not.toContain('data-thinking-block');
  });

  it('binds streaming only to the active assistant group and creates an empty turn after a trailing user', () => {
    const list = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/MessageList.tsx'), 'utf8');
    const composer = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/Composer.tsx'), 'utf8');
    expect(list).toContain('streaming={Boolean(isStreaming && group === activeAssistantGroup)}');
    expect(list).toContain('showEmptyActiveTurn');
    expect(list).toContain('key="active-assistant-turn"');
    expect(list).not.toContain('activeAssistantGroup || lastAssistantGroup');
    expect(list).not.toContain('!lastAssistantGroup');
    expect(composer).not.toContain('WorkProgressIndicator');
    expect(composer).not.toContain('data-composer-progress-slot');
  });
});
