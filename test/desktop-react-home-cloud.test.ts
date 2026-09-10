import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('desktop React new chat empty state', () => {
  it('removes legacy cloud artwork from empty chat while preserving project context', () => {
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/chat/CloudAvatar.tsx'))).toBe(false);
    const home = source('desktop/src/components/chat/ChatHomeEmptyState.tsx');
    expect(home).toContain('data-home-empty-state');
    expect(home).toContain("t('chatHomePrefix')");
    expect(home).toContain("t('chatHomeSuffix')");
    expect(home).not.toContain('data-home-cloud');
  });

  it('wires empty state into MessageList only when conversation is idle', () => {
    const messages = source('desktop/src/components/chat/MessageList.tsx');
    expect(messages).toContain("import { ChatHomeEmptyState } from './ChatHomeEmptyState'");
    expect(messages).toContain('!isLoading && messages.length === 0 && !isStreaming && !pendingUserInput');
    expect(messages).toContain('<ChatHomeEmptyState');
  });
});
