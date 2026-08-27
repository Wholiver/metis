import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React Ask interface', () => {
  it('replaces the composer with one accessible question and no horizontal divider', () => {
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const card = source('desktop/src/components/chat/UserInputCard.tsx');

    expect(chatArea).toContain('pendingUserInput ? (');
    expect(chatArea).toContain('<UserInputCard request={pendingUserInput}');
    expect(card).toContain('data-user-input-request-id={request.requestId}');
    expect(card).toContain('data-question-id={question.id}');
    expect(card).toContain('request.questions[questionIndex]');
    expect(card).toContain('max-w-[620px]');
    expect(card).toContain('rounded-[24px]');
    expect(card).toContain('bg-white');
    expect(card).toContain('shadow-none');
    expect(card).toContain('rounded-[12px] px-3 py-2.5');
    expect(card).toContain('rounded-[12px] bg-[#172033]');
    expect(card).toContain('border-[0.5px]');
    expect(card).toContain('aria-labelledby');
    expect(card).toContain('<fieldset');
    expect(card).not.toContain('<hr');
    expect(card).not.toContain('border-t');
    expect(card).not.toContain('border-b');
    expect(card).not.toContain('transition-all');
  });

  it('uses snapshot state and posts submit or cancel responses to request endpoint', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain('pendingUserInput?: PendingUserInput');
    expect(hook).toContain('setPendingUserInput(state.pendingUserInput)');
    expect(hook).toContain("type === 'user_input_request' && event.request");
    expect(hook).toContain('setPendingUserInput(event.request)');
    expect(hook).toContain("request(`/session/user-input/${encodeURIComponent(requestId)}`, 'POST', response)");
    expect(hook).toContain("type === 'tool_execution_start' || type === 'tool_execution_end'");
  });

  it('restores composer focus after Ask disappears', () => {
    const composer = source('desktop/src/components/chat/Composer.tsx');
    expect(composer).toContain('requestAnimationFrame(() => inputRef.current?.focus())');
    expect(composer).toContain('}, [disabled]);');
  });

  it('shows active work progress indicator above the question card while waiting for user input', () => {
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const messageList = source('desktop/src/components/chat/MessageList.tsx');
    const assistantTurn = source('desktop/src/components/chat/AssistantTurn.tsx');

    expect(chatArea).toContain('pendingUserInput={pendingUserInput}');
    expect(messageList).toContain('pendingUserInput?: PendingUserInput');
    expect(messageList).toContain('pendingUserInput={group === progressGroup ? pendingUserInput : undefined}');
    expect(assistantTurn).toContain('isWaitingUserInput = Boolean(pendingUserInput)');
    expect(assistantTurn).toContain("phase: 'waiting'");
    expect(assistantTurn).toContain('idle={!streaming && !isWaitingUserInput}');
  });

  it('restores pending user input state when switching back to a waiting session', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain("request<SessionState & { cancelled: boolean }>('/session/switch'");
    expect(hook).toContain('switchResult.pendingUserInput !== undefined');
    expect(hook).toContain('setPendingUserInput(switchResult.pendingUserInput)');
    expect(hook).toContain('loadMessages(targetSessionId, true)');
  });
});
