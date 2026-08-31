import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChatArea } from '../../desktop/src/components/chat/ChatArea';
import type { Message } from '../../desktop/src/types';

// Runs against real React components and Chromium layout, without a server or LLM.
export async function runScrollChecks() {
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const evidence: Array<{ state: string; top: number; gap: number }> = [];
  let messages: Message[] = [];
  let streaming = false;
  let sessionId = 'first';
  const settle = async () => {
    for (let frame = 0; frame < 5; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  };
  const render = async () => {
    flushSync(() => root.render(
      <React.StrictMode>
        <ChatArea
          agent={{ id: sessionId, name: 'Scroll test', avatarType: 'blob', gradient: '', subtitle: '', time: '' }}
          messages={messages}
          isStreaming={streaming}
          models={[]}
          collaborationMode="build"
          onSelectCollaborationMode={() => {}}
          onSelectModel={() => {}}
          onSendMessage={() => true}
          onRespondToUserInput={async () => true}
        />
      </React.StrictMode>,
    ));
    await settle();
  };
  const scroll = () => document.querySelector<HTMLElement>('[data-message-scroll]')!;
  const record = (state: string) => {
    const el = scroll();
    const result = { state, top: el.scrollTop, gap: el.scrollHeight - el.clientHeight - el.scrollTop };
    evidence.push(result);
    return result;
  };
  const bottom = (state: string) => {
    const result = record(state);
    if (Math.abs(result.gap) > 1) throw new Error(JSON.stringify(result));
  };
  const unchanged = (state: string, top: number) => {
    const result = record(state);
    if (Math.abs(result.top - top) > 1) throw new Error(JSON.stringify({ ...result, expectedTop: top }));
  };
  const answer = (lines: number): Message => ({
    id: 'assistant', role: 'assistant', content: Array.from({ length: lines }, (_, i) => `Paragraph ${i}: streamed output.`).join('\n\n'),
  });
  try {
    await render();
    bottom('empty');
    messages = [{ id: 'user', role: 'user', content: 'Start a new conversation.' }];
    streaming = true;
    await render();
    messages = [...messages, answer(4)];
    await render();

    // Reproduce content that fits only when the overlaid composer's clearance
    // is wrongly excluded. The actual scroll range must still be followed.
    const clearance = document.querySelector<HTMLElement>('[data-composer-clearance]')!;
    const headerHeight = host.clientHeight - scroll().clientHeight;
    host.style.height = `${scroll().scrollHeight - clearance.offsetHeight + headerHeight + 24}px`;
    await render();
    bottom('new conversation at composer boundary');
    if (scroll().scrollTop <= 0) throw new Error('Boundary fixture must overflow');

    host.style.height = '600px';
    for (let lines = 10; lines <= 70; lines += 10) {
      messages = [messages[0], answer(lines)];
      await render();
      bottom(`streaming ${lines} paragraphs`);
    }

    scroll().scrollTop -= 300;
    await settle();
    const readingTop = scroll().scrollTop;
    messages = [messages[0], answer(80)];
    await render();
    unchanged('user reading during stream', readingTop);
    streaming = false;
    await render();
    unchanged('completion while reading', readingTop);
    messages = messages.map((message) => ({ ...message }));
    await render();
    unchanged('snapshot reconciliation while reading', readingTop);

    scroll().scrollTop = scroll().scrollHeight;
    await settle();
    streaming = true;
    messages = [messages[0], answer(90)];
    await render();
    bottom('resume after returning to bottom');

    // An asynchronously sized image changes layout without new message props.
    const image = document.createElement('img');
    image.style.cssText = 'display:block;width:500px;flex:none';
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="350"/>');
    document.querySelector('[data-message-lane]')!.append(image);
    await image.decode();
    await settle();
    bottom('late image growth');
    image.remove();
    await settle();
    bottom('content shrink');
    const composer = document.querySelector<HTMLElement>('[data-composer-shell]');
    if (!composer) throw new Error('Composer shell missing');
    composer.style.minHeight = '240px';
    await settle();
    bottom('composer expands');
    composer.style.minHeight = '';
    host.style.height = '450px';
    await settle();
    bottom('viewport shrinks');

    scroll().scrollTop -= 300;
    await settle();
    messages = [...messages, { id: 'next-user', role: 'user', content: 'Next request' }];
    await render();
    bottom('new request resumes follow');
    scroll().scrollTop -= 300;
    await settle();
    sessionId = 'second';
    await render();
    bottom('switch conversation resets follow');
    streaming = false;
    await render();
    bottom('completed at bottom');

    sessionId = 'work';
    streaming = true;
    messages = [messages[0], {
      id: 'work-assistant', role: 'assistant', content: '',
      parts: [
        { id: 'thoughts', type: 'thinking', thinking: 'Reasoning line.\n'.repeat(20) },
        { id: 'status', type: 'text', text: 'Checking files.\n\nAdditional status with wrapping. '.repeat(20) },
        { id: 'tool', type: 'toolCall', name: 'read', arguments: { path: 'README.md' }, result: { content: 'File content\n'.repeat(10) } },
        { id: 'final', type: 'text', text: answer(20).content },
      ],
    }];
    await render();
    // Work items are revealed on timers independently from message updates.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await settle();
    bottom('streaming thoughts and tools reveal');
    streaming = false;
    await render();
    bottom('completed work collapsed');
    const workToggle = document.querySelector<HTMLButtonElement>('[data-assistant-work] > button')!;
    if (workToggle.getAttribute('aria-expanded') !== 'false') throw new Error('Work should collapse on completion');
    workToggle.click();
    await settle();
    bottom('completed work expanded');
    if (workToggle.getAttribute('aria-expanded') !== 'true') throw new Error('Work did not expand');
    workToggle.click();
    await settle();
    bottom('completed work collapsed again');
    messages = [];
    await render();
    bottom('new empty conversation');
    return evidence;
  } finally {
    root.unmount();
  }
}

Object.assign(window, { runScrollChecks });
