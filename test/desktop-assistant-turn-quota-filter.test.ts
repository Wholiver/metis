import { describe, expect, it } from 'vitest';
import {
  isInternalQuotaNotice,
  resolveAssistantFinalCopyText,
  resolveAssistantTurnLayout,
  stripInternalQuotaNotices,
} from '../desktop/src/components/chat/AssistantTurn';
import type { Message } from '../desktop/src/types';

describe('AssistantTurn internal quota notice filtering', () => {
  it('identifies internal quota notices', () => {
    expect(isInternalQuotaNotice('子代理额度已用尽（root 的 16 个子任务上限已满），')).toBe(true);
    expect(isInternalQuotaNotice('子代理额度已用尽')).toBe(true);
    expect(isInternalQuotaNotice('子任务上限已满')).toBe(true);
    expect(isInternalQuotaNotice('Maximum children per agent (16) reached.')).toBe(true);
    expect(isInternalQuotaNotice('Global spawned child limit (32) exceeded.')).toBe(true);
    expect(isInternalQuotaNotice('正在运行测试套件与安全校验。')).toBe(false);
  });

  it('strips internal quota notices from mixed message text', () => {
    const raw = '子代理额度已用尽（root 的 16 个子任务上限已满），因此本轮 G6 由我在共享工作区做独立验证：真实跑测试与覆盖率，并自行写对抗性探针核对安全边界与重构等价性。';
    const cleaned = stripInternalQuotaNotices(raw);
    expect(cleaned).toBe('本轮 G6 由我在共享工作区做独立验证：真实跑测试与覆盖率，并自行写对抗性探针核对安全边界与重构等价性。');
    expect(cleaned).not.toContain('子代理额度已用尽');
    expect(cleaned).not.toContain('16 个子任务上限已满');
  });

  it('filters standalone quota text out of AssistantTurn layout workItems and finalText', () => {
    const messages: Message[] = [{
      id: 'msg-1',
      role: 'assistant',
      content: '子代理额度已用尽（root 的 16 个子任务上限已满），',
      parts: [
        {
          type: 'text',
          id: 'text-1',
          text: '子代理额度已用尽（root 的 16 个子任务上限已满），',
        },
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'bash',
          arguments: { command: 'npm test' },
          result: { content: 'PASS' },
        },
        {
          type: 'text',
          id: 'text-2',
          text: '所有测试均已通过，代码重构已完成。',
        },
      ],
    }];

    const layout = resolveAssistantTurnLayout(messages);
    // Standalone quota text-1 must be completely stripped, leaving only the tool call in workItems
    expect(layout.workItems).toHaveLength(1);
    expect(layout.workItems[0].type).toBe('toolCall');
    expect(layout.finalText).toBe('所有测试均已通过，代码重构已完成。');
    expect(resolveAssistantFinalCopyText(messages)).toBe('所有测试均已通过，代码重构已完成。');
  });

  it('cleans mixed quota text in workItems and maintains non-quota explanation', () => {
    const messages: Message[] = [{
      id: 'msg-2',
      role: 'assistant',
      content: '子代理额度已用尽（root 的 16 个子任务上限已满），因此由主代理执行验证。',
      parts: [
        {
          type: 'text',
          id: 'text-mixed',
          text: '子代理额度已用尽（root 的 16 个子任务上限已满），因此由主代理执行验证。',
        },
        {
          type: 'toolCall',
          id: 'tool-2',
          name: 'bash',
          arguments: { command: 'node verify.mjs' },
        },
      ],
    }];

    const layout = resolveAssistantTurnLayout(messages, { streaming: true });
    // In streaming mode, text-mixed should be present in workItems but stripped of quota notice
    const textPart = layout.workItems.find((p) => p.type === 'text');
    expect(textPart).toBeDefined();
    if (textPart && textPart.type === 'text') {
      expect(textPart.text).toBe('由主代理执行验证。');
      expect(textPart.text).not.toContain('子代理额度已用尽');
    }
  });
});
