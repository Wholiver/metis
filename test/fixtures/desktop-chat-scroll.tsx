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
    messages = [...messages, answer(7)];
    await render();
    bottom('initial streamed answer');

    // Reproduce content that fits only when the overlaid composer's clearance
    // is wrongly excluded. The actual scroll range must still be followed.
    const clearance = document.querySelector<HTMLElement>('[data-composer-clearance]')!;
    const headerHeight = host.clientHeight - scroll().clientHeight;
    host.style.height = `${scroll().scrollHeight - clearance.offsetHeight + headerHeight - 24}px`;
    await render();
    if (scroll().scrollHeight <= scroll().clientHeight) throw new Error('Boundary fixture must overflow');
    scroll().scrollTop = scroll().scrollHeight;
    scroll().dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    bottom('new conversation at composer boundary');

    host.style.height = '600px';
    for (let lines = 10; lines <= 70; lines += 10) {
      messages = [messages[0], answer(lines)];
      await render();
      bottom(`streaming ${lines} paragraphs`);
    }

    scroll().scrollTop -= 300;
    scroll().dispatchEvent(new Event('scroll', { bubbles: true }));
    scroll().dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
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
    scroll().dispatchEvent(new Event('scroll', { bubbles: true }));
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
    scroll().dispatchEvent(new Event('scroll', { bubbles: true }));
    scroll().dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
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
        { id: 'glob', type: 'toolCall', name: 'glob', arguments: { pattern: '**/README*' }, result: { content: 'README.md' } },
        { id: 'final', type: 'text', text: answer(20).content },
      ],
    }];
    await render();
    await settle();
    bottom('streaming thoughts and tools reveal');
    const contextTrigger = document.querySelector<HTMLElement>('[data-component="context-tool-group-trigger"]');
    const contextList = document.querySelector<HTMLElement>('[data-component="context-tool-group-list"]');
    const thinkingRow = document.querySelector<HTMLElement>('[data-slot="session-turn-thinking"]');
    if (!contextTrigger || !contextList || !thinkingRow) {
      throw new Error('OpenCode session UI fixture nodes missing');
    }
    if (document.querySelector('[data-component="reasoning-part"]')) {
      throw new Error('Reasoning body should not render');
    }
    if (document.querySelector('[data-thinking-content]')) {
      throw new Error('Thinking content should not render');
    }
    const triggerStyle = getComputedStyle(contextTrigger);
    const listStyle = getComputedStyle(contextList);
    const thinkingStyle = getComputedStyle(thinkingRow);
    if (triggerStyle.minHeight !== '24px') throw new Error(`Context trigger min-height: ${triggerStyle.minHeight}`);
    if (listStyle.paddingLeft !== '12px') throw new Error(`Context list padding: ${listStyle.paddingLeft}`);
    if (listStyle.rowGap !== '4px') throw new Error(`Context list gap: ${listStyle.rowGap}`);
    const workInner = document.querySelector<HTMLElement>('[data-slot="session-turn-assistant-content"], .cot-content-inner');
    if (!workInner) throw new Error('Assistant work inner missing');
    const workGap = getComputedStyle(workInner).rowGap;
    if (workGap !== '12px') throw new Error(`Work item gap: ${workGap}`);
    // OpenCode: Thinking uses parent spacing (timeline margin / flex gap), not stacked gap+margin.
    if (thinkingStyle.marginTop !== '0px') throw new Error(`Thinking margin: ${thinkingStyle.marginTop}`);
    if (thinkingStyle.lineHeight !== '20px') throw new Error(`Thinking line-height: ${thinkingStyle.lineHeight}`);
    if (document.querySelector('[data-assistant-work-status]')) throw new Error('Legacy Working status is still visible');
    // OpenCode ContextToolGroup defaults closed; busy only drives Exploring shimmer.
    const contextToggleStreaming = document.querySelector<HTMLButtonElement>('[data-component="context-tool-group"] button[aria-expanded]')!;
    if (!contextToggleStreaming) throw new Error('Context group toggle missing while streaming');
    if (contextToggleStreaming.getAttribute('aria-expanded') !== 'false') {
      throw new Error('Context group should stay collapsed by default while exploring');
    }
    const contextGroup = document.querySelector<HTMLElement>('[data-component="context-tool-group"]');
    if (contextGroup?.getAttribute('data-busy') !== 'true') {
      throw new Error('Context group should be busy while exploring');
    }
    const contextLabel = contextTrigger
      .querySelector<HTMLElement>('[data-slot="context-tool-group-label"] [data-component="text-shimmer"]')
      ?.getAttribute('aria-label') || '';
    const contextSummary = contextTrigger
      .querySelector<HTMLElement>('[data-slot="context-tool-group-summary"]')
      ?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!['Exploring', '正在探索'].includes(contextLabel)) {
      throw new Error(`Context label mismatch: ${contextLabel}`);
    }
    if (contextSummary !== '1 read, 1 search' && contextSummary !== '1 次读取, 1 次搜索') {
      throw new Error(`Context summary mismatch: ${contextSummary}`);
    }
    const contextRows = [...contextList.querySelectorAll<HTMLElement>('[data-slot="context-tool-group-item"]')];
    const rowLabels = contextRows.map((row) => ({
      title: row.querySelector<HTMLElement>('[data-component="text-shimmer"]')?.getAttribute('aria-label') || '',
      text: row.textContent?.replace(/\s+/g, ' ').trim() || '',
    }));
    if (!rowLabels.some((row) => ['Read', '读取'].includes(row.title) && row.text.includes('README.md'))) {
      throw new Error(`Read row mismatch: ${JSON.stringify(rowLabels)}`);
    }
    if (!rowLabels.some((row) => row.title === 'Glob' && row.text.includes('pattern=**/README*'))) {
      throw new Error(`Glob row mismatch: ${JSON.stringify(rowLabels)}`);
    }
    streaming = false;
    await render();
    await settle();
    bottom('completed context group remains collapsed');
    const contextToggle = document.querySelector<HTMLButtonElement>('[data-component="context-tool-group"] button[aria-expanded]')!;
    if (!contextToggle) throw new Error('Context group toggle missing');
    if (contextToggle.getAttribute('aria-expanded') !== 'false') {
      throw new Error('Context group should remain collapsed after exploration ends');
    }
    if (document.querySelector('[data-component="context-tool-group"]')?.getAttribute('data-busy') === 'true') {
      throw new Error('Context group should not stay busy after completion');
    }
    if (document.querySelector('[data-slot="session-turn-thinking"]')) {
      throw new Error('Thinking shimmer should hide after completion');
    }
    if (document.querySelector('[data-component="reasoning-part"], [data-thinking-content]')) {
      throw new Error('Thinking body/title should stay hidden after completion');
    }
    const finalResponse = document.querySelector<HTMLElement>('.turn-final-response.after-expanded-work');
    if (finalResponse) {
      const finalGap = getComputedStyle(finalResponse).marginTop;
      if (finalGap !== '24px') throw new Error(`Final response gap: ${finalGap}`);
    }
    contextToggle.click();
    await settle();
    bottom('completed context group expanded');
    if (contextToggle.getAttribute('aria-expanded') !== 'true') throw new Error('Context group did not expand');
    contextToggle.click();
    await settle();
    bottom('completed context group collapsed again');
    if (contextToggle.getAttribute('aria-expanded') !== 'false') throw new Error('Context group did not collapse');
    messages = [];
    await render();
    bottom('new empty conversation');
    return evidence;
  } finally {
    root.unmount();
  }
}

Object.assign(window, { runScrollChecks });
