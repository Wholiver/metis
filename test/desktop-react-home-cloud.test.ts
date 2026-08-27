import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React new chat home cloud avatar and heading', () => {
  it('defines CloudAvatar with the exact requested SVG structure', () => {
    const cloudAvatar = source('desktop/src/components/chat/CloudAvatar.tsx');
    expect(cloudAvatar).toContain('viewBox="-125 -125 250 250"');
    expect(cloudAvatar).toContain('role="img"');
    expect(cloudAvatar).toContain('aria-label="bloub 动画头像"');
    expect(cloudAvatar).toContain('id="bot-mask-s77w4g"');
    expect(cloudAvatar).toContain('fill="#f9f9f9"');
    expect(cloudAvatar).toContain('fill="#0a0a0c"');
    expect(cloudAvatar).toContain('mask="url(#bot-mask-s77w4g)"');
  });

  it('renders ChatHomeEmptyState with scaled up cloud and project title without suggestion cards', () => {
    const homeState = source('desktop/src/components/chat/ChatHomeEmptyState.tsx');
    expect(homeState).toContain('data-home-empty-state=""');
    expect(homeState).toContain('data-home-cloud=""');
    expect(homeState).toContain('<CloudAvatar size={110}');
    expect(homeState).toContain("t('chatHomePrefix')");
    expect(homeState).toContain("t('chatHomeSuffix')");
    expect(homeState).toContain('font-normal');
    expect(homeState).not.toContain('font-semibold');
    expect(homeState).not.toContain('data-home-suggestions');
    expect(homeState).not.toContain('探索并理解代码');
  });

  it('wires ChatHomeEmptyState into MessageList when conversation is empty', () => {
    const messageList = source('desktop/src/components/chat/MessageList.tsx');
    expect(messageList).toContain("import { ChatHomeEmptyState } from './ChatHomeEmptyState'");
    expect(messageList).toContain('!isLoading && messages.length === 0 && !isStreaming && !pendingUserInput');
    expect(messageList).toContain('<ChatHomeEmptyState');
    expect(messageList).toContain('projectName={projectName');
  });
});

