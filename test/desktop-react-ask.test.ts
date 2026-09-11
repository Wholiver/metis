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
    expect(chatArea).toContain('<UserInputCard');
    expect(chatArea).toContain('request={pendingUserInput}');
    expect(card).toContain('requestId={request.requestId}');
    expect(card).toContain('id: question.id');
    expect(card).toContain('request.questions.map');
    expect(card).toContain('max-w-[620px]');
    expect(card).toContain('<ApprovalCard');
    expect(card).toContain('questions={questions}');
    expect(card).not.toContain('<hr');
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

  it('keeps Ask on the empty active turn without a composer progress row', () => {
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const messageList = source('desktop/src/components/chat/MessageList.tsx');
    const assistantTurn = source('desktop/src/components/chat/AssistantTurn.tsx');
    const userInputCard = source('desktop/src/components/chat/UserInputCard.tsx');

    expect(chatArea).toContain('pendingUserInput={pendingUserInput}');
    expect(chatArea).not.toContain('progress={currentProgress}');
    expect(chatArea).not.toContain('workProgress=');
    expect(messageList).toContain('pendingUserInput?: PendingUserInput');
    expect(messageList).toContain('pendingUserInput={group === progressGroup ? pendingUserInput : undefined}');
    expect(messageList).toContain('showEmptyActiveTurn');
    expect(assistantTurn).toContain('isWaitingUserInput = Boolean(pendingUserInput)');
    expect(userInputCard).not.toContain('data-composer-progress-slot');
    expect(userInputCard).not.toContain('WorkProgressIndicator');
  });

  it('restores pending user input state when switching back to a waiting session', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain("request<SessionState & { cancelled: boolean }>('/session/switch'");
    expect(hook).toContain('switchResult.pendingUserInput !== undefined');
    expect(hook).toContain('setPendingUserInput(switchResult.pendingUserInput)');
    expect(hook).toContain('loadMessages(targetSessionId, true)');
  });
});
