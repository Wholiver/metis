import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React workflow plan card', () => {
  it('stacks plan flush above the input with each keeping its own frame', () => {
    const card = source('desktop/src/components/chat/WorkflowPlanCard.tsx');
    const composer = source('desktop/src/components/chat/Composer.tsx');
    const chatArea = source('desktop/src/components/chat/ChatArea.tsx');
    const app = source('desktop/src/App.tsx');
    const i18n = source('desktop/i18n-source.cjs');

    expect(card).toContain('data-workflow-plan-card');
    expect(card).toContain('data-workflow-plan-header');
    expect(card).toContain('data-workflow-plan-body');
    expect(card).toContain('rounded-[12px] border border-line');
    expect(card).toContain('pb-[14px]');
    expect(card).not.toContain('plain?: boolean');
    expect(card).not.toContain('data-plan-plain');
    expect(card).toContain("data-plan-step-icon=\"completed\"");
    expect(card).toContain("data-plan-step-icon=\"in_progress\"");
    expect(card).toContain("data-plan-step-icon=\"pending\"");
    expect(card).toContain('h-5 w-[3px]');
    expect(card).toContain('min-h-8 items-center gap-3');
    expect(card).toContain('w-[18px]');
    expect(card).toContain('line-through');
    expect(card).toContain('font-semibold text-ink');
    expect(card).toContain('aria-expanded={expanded}');
    expect(card).toContain("gridTemplateRows: expanded ? '1fr' : '0fr'");
    expect(card).not.toContain('transition-all');

    expect(composer).toContain("import { WorkflowPlanCard } from './WorkflowPlanCard'");
    expect(composer).toContain('data-composer-stack');
    expect(composer).toContain('data-composer-plan-slot');
    expect(composer).toContain('data-composer-input-layer');
    expect(composer).toContain('z-10 -mt-[14px]');
    expect(composer).not.toContain('data-composer-plan-shell');
    expect(composer).not.toContain('data-composer-input-nest');
    expect(composer).not.toContain('expandSlot=');
    expect(composer).not.toContain('plain');
    expect(composer).not.toContain('data-composer-progress-slot');
    expect(composer.indexOf('data-composer-plan-slot')).toBeLessThan(composer.indexOf('{promptBar}'));

    expect(chatArea).toContain('workflowPlan={workflowPlan}');
    expect(chatArea).toContain('workflowPlanInterrupted={workflowPlanInterrupted}');
    expect(chatArea).toContain("stopReason === 'aborted'");

    expect(app).toContain('workflowPlan={displayedWorkflowPlan}');
    expect(app).toContain("captureParams.has('capture-workflow-plan')");
    expect(app).toContain("captureWorkflowPlan ? 'build'");

    expect(i18n).toContain('"workflowPlanProgress": "{completed} of {total} tasks completed"');
    expect(i18n).toContain('"workflowPlanProgress": "已完成 {completed} 个任务（共 {total} 个）"');
    expect(i18n).toContain('"workflowPlanExpand"');
    expect(i18n).toContain('"workflowPlanCollapse"');
  });

  it('ships Electron geometry capture for overlapped stack with preserved input frame', () => {
    const main = source('desktop/main.cjs');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_WORKFLOW_PLAN');
    expect(main).toContain('capture-workflow-plan');
    expect(main).toContain('[capture:workflow-plan]');
    expect(main).toContain("document.querySelector('[data-workflow-plan-card]')");
    expect(main).toContain('progressAbovePlan');
    expect(main).toContain('planAboveComposer');
    expect(main).toContain('overlapMatchesInputRadius');
    expect(main).toContain('collapsedHeaderFullyVisible');
    expect(main).toContain('notWrapped');
    expect(main).toContain('planKeepsOwnFrame');
    expect(main).toContain('activeIconSize');
    expect(main).toContain('pendingIconSize');
    expect(main).toContain('composerKeepsTopFrame');
    expect(main).toContain('composerKeepsOwnRadius');
    expect(main).toContain('progressMovedDownOnCollapse');
  });
});
