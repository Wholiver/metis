import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('desktop React new chat home composer', () => {
  it('centers a static Metis cloud above the home composer', () => {
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/chat/CloudAvatar.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/chat/ChatHomeEmptyState.tsx'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'desktop/src/components/chat/MetisCloudMark.tsx'))).toBe(true);

    const cloud = source('desktop/src/components/chat/MetisCloudMark.tsx');
    expect(cloud).toContain('data-home-cloud');
    expect(cloud).toContain('WORK_PROGRESS_CLOUD_BODY_PATH');
    expect(cloud).not.toContain('work-progress-eye-motion');
    expect(cloud).not.toContain('animation');
    expect(cloud).not.toContain('requestAnimationFrame');

    const composer = source('desktop/src/components/chat/Composer.tsx');
    expect(composer).toContain('data-home-cloud-slot');
    expect(composer).toContain('<MetisCloudMark');
    expect(composer).toContain('tall={isHomeEmpty}');
    expect(composer).toContain("data-composer-home={isHomeEmpty ? 'true' : undefined}");
    expect(composer).toContain('data-composer-dock-stack');
    // Cloud stays outside the FLIP dock stack so it does not travel with the input.
    expect(composer.indexOf('data-home-cloud-slot')).toBeLessThan(composer.indexOf('data-composer-dock-stack'));
  });

  it('wires home empty detection through ChatArea and hides MessageList greeting', () => {
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    expect(chatArea).toContain('const isHomeEmpty = messages.length === 0 && !isLoading && !showActiveProgress && !pendingUserInput');
    expect(chatArea).toContain('isHomeEmpty={isHomeEmpty}');
    expect(chatArea).toContain('projects={projects}');
    expect(chatArea).toContain('onSelectProject={onSelectProject}');

    const messages = source('desktop/src/components/chat/MessageList.tsx');
    expect(messages).not.toContain('ChatHomeEmptyState');
    expect(messages).toContain('isHomeEmpty');
    expect(messages).toContain('data-composer-clearance');

    const app = source('desktop/src/App.tsx');
    expect(app).toContain('projects={projects}');
    expect(app).toContain('activeProject={activeProject}');
    expect(app).toContain('onSelectProject={handleSelectProject}');
  });

  it('renders a project switcher with decorative non-interactive branch', () => {
    const switcher = source('desktop/src/components/chat/HomeProjectSwitcher.tsx');
    expect(switcher).toContain('data-home-project-switcher');
    expect(switcher).toContain('data-home-project-trigger');
    expect(switcher).toContain('data-home-project-branch');
    expect(switcher).toContain('pointer-events-none');
    expect(switcher).toContain('gitInfo');
    expect(switcher).toContain('GitBranch');
    expect(switcher).toContain('onSelectProject');

    const composer = source('desktop/src/components/chat/Composer.tsx');
    expect(composer).toContain('data-home-project-slot');
    expect(composer).toContain('<HomeProjectSwitcher');
  });
});
