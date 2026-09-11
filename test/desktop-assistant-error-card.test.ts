import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toMessage, toMessages } from '../desktop/src/hooks/useMetisServer';

describe('desktop assistant error card and error preservation', () => {
  it('preserves error messages when stopReason is error in toMessage', () => {
    const message = toMessage({
      id: 'error-msg-1',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'WebSocket connect timeout after 15000ms',
    });

    expect(message).toBeDefined();
    expect(message?.id).toBe('error-msg-1');
    expect(message?.role).toBe('assistant');
    expect(message?.stopReason).toBe('error');
    expect(message?.errorMessage).toBe('WebSocket connect timeout after 15000ms');
    expect(message?.content).toBe('WebSocket connect timeout after 15000ms');
  });

  it('preserves aborted messages with error information instead of silently dropping them', () => {
    const abortedWithReason = toMessage({
      id: 'abort-msg-1',
      role: 'assistant',
      content: [],
      stopReason: 'aborted',
      errorMessage: 'Request was aborted due to timeout',
    });

    expect(abortedWithReason).toBeDefined();
    expect(abortedWithReason?.id).toBe('abort-msg-1');
    expect(abortedWithReason?.stopReason).toBe('aborted');
    expect(abortedWithReason?.errorMessage).toBe('Request was aborted due to timeout');

    const abortedEmpty = toMessage({
      id: 'abort-msg-2',
      role: 'assistant',
      content: [],
      stopReason: 'aborted',
    });

    expect(abortedEmpty).toBeDefined();
    expect(abortedEmpty?.id).toBe('abort-msg-2');
    expect(abortedEmpty?.stopReason).toBe('aborted');
  });

  it('does not drop failed assistant messages in toMessages pipeline', () => {
    const raw = [
      { id: 'user-1', role: 'user', content: '你好' },
      {
        id: 'assistant-err-1',
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        stopReason: 'error',
        errorMessage: 'Connection failed',
      },
    ];

    const messages = toMessages(raw);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].errorMessage).toBe('Connection failed');
    expect(messages[1].stopReason).toBe('error');
  });

  it('verifies AssistantErrorCard component has alert role, retry button, and error display', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/AssistantErrorCard.tsx'),
      'utf8',
    );

    expect(source).toContain('data-assistant-error-card=""');
    expect(source).toContain('role="alert"');
    expect(source).toContain('data-assistant-error-message=""');
    expect(source).toContain('data-assistant-retry=""');
    expect(source).toContain('CircleAlert');
    expect(source).toContain('RotateCcw');
    expect(source).toContain("t('assistantErrorTitle')");
    expect(source).toContain("t('assistantRetry')");
  });

  it('verifies AssistantTurn integrates AssistantErrorCard with onRetry wiring', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/AssistantTurn.tsx'),
      'utf8',
    );

    expect(source).toContain('import { AssistantErrorCard } from \'./AssistantErrorCard\'');
    expect(source).toContain('onRetry?: () => void;');
    expect(source).toContain('failureMessage');
    expect(source).toContain('<AssistantErrorCard');
    expect(source).toContain('onRetry={onRetry}');
  });

  it('verifies MessageList tracks user prompt text and passes onRetry to AssistantTurn', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/src/components/chat/MessageList.tsx'),
      'utf8',
    );

    expect(source).toContain('promptText?: string');
    expect(source).toContain('latestUserPrompt');
    expect(source).toContain('onRetry={group.promptText && onSendMessage ? () => onSendMessage(group.promptText!) : undefined}');
  });

  it('contains assistant error translations in both en and zh-CN catalogs', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'desktop/i18n-source.cjs'),
      'utf8',
    );

    expect(source).toMatch(/"assistantErrorTitle":\s*"Request failed"/);
    expect(source).toMatch(/"assistantRetry":\s*"Retry"/);
    expect(source).toMatch(/"assistantErrorDefault":\s*"The request timed out or was interrupted\."/);

    expect(source).toMatch(/"assistantErrorTitle":\s*"请求失败"/);
    expect(source).toMatch(/"assistantRetry":\s*"重试"/);
    expect(source).toMatch(/"assistantErrorDefault":\s*"请求超时或被中断。"/);
  });
});
