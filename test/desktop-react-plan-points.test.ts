import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop React plan points inspector', () => {
  it('shows changed files and plan in compact inspector sections', () => {
    const inspector = source('desktop/src/components/inspector/Inspector.tsx');
    const points = source('desktop/src/components/inspector/PlanPoints.tsx');
    const changedFiles = source('desktop/src/components/inspector/ChangedFiles.tsx');

    expect(inspector).toContain('data-plan-inspector');
    expect(inspector).toContain('data-changed-files-section');
    expect(inspector).toContain('Files Changed');
    expect(inspector).toContain('data-plan-section');
    expect(inspector).toContain('data-plan-points-title');
    expect(inspector).toContain('<PlanPoints points={workflowPlan?.plan || []} />');
    expect(inspector).not.toContain('ScreenPreviewCard');
    expect(inspector).not.toContain('Routines');
    expect(points).toContain('data-plan-points-empty');
    expect(points).toContain('No plan points yet');
    expect(points).toContain('Points created by update_plan will appear here.');
    expect(points).toContain('data-plan-point');
    expect(points).toContain('data-plan-point-text');
    expect(points).toContain('data-plan-status={point.status}');
    expect(points).toContain('flex flex-col gap-0.5');
    expect(points).toContain('min-h-9');
    expect(points).not.toContain('transition-all');
    expect(changedFiles).toContain('data-changed-files-list');
    expect(changedFiles).toContain('data-changed-file');
    expect(changedFiles).toContain('data-changed-file-path={file.path}');
    expect(changedFiles).toContain('{files.map((file) => {');
    expect(changedFiles).not.toContain('See all');
    expect(changedFiles).not.toContain('onClick=');
    expect(changedFiles).not.toMatch(/border-b|divide-y/);
    expect(changedFiles).toContain('min-h-8');
    expect(inspector).toContain('useState(true)');
    expect(inspector).toContain('aria-expanded={filesExpanded}');
    expect(inspector).toContain('data-copy-plan-button');
    expect(inspector).toContain('handleCopyPlan');
    expect(inspector).not.toContain('hover:bg-slate-50');
  });

  it('uses authoritative workflow plan snapshots and reconciles plan entries', () => {
    const hook = source('desktop/src/hooks/useMetisServer.ts');
    expect(hook).toContain('workflowPlan?: WorkflowPlanState');
    expect(hook).toContain('setWorkflowPlan(state.workflowPlan)');
    expect(hook).toContain("type === 'entry_appended'");
    expect(hook).toContain("['workflow_plan', 'workflow_plan_reset']");
    expect(hook).toContain('workflowPlan,');
  });

  it('wires plan state into the right sidebar and provides runtime capture', () => {
    const app = source('desktop/src/App.tsx');
    const main = source('desktop/main.cjs');
    expect(app).toContain('workflowPlan={displayedWorkflowPlan}');
    expect(app).toContain('fileChanges={displayedFileChanges}');
    expect(app).toContain('collectTurnFileChanges(');
    expect(app).toContain('const displayedWorkspacePath = capturePlanPoints ? PLAN_POINTS_CAPTURE_WORKSPACE : activeProject?.path');
    expect(app).toContain('workspacePath={displayedWorkspacePath}');
    expect(app).not.toContain('routines={routines}');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PLAN_POINTS');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PLAN_POINTS_EMPTY');
    expect(main).toContain('[capture:plan-points]');
    expect(main).toContain('titleAlignedWithIcon');
    expect(main).toContain('changedFilePaths');
  });
});

