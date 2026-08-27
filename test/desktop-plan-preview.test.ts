import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractProposedPlan, splitPlanTitle } from '../desktop/src/lib/plan-preview';
import { estimateThinkingDurationMs, formatThinkingDuration } from '../desktop/src/lib/thinking';
import {
  planWorkProgressExpressionUpdate,
  resolveOutputTailProgress,
  resolveWorkProgress,
  resolveWorkProgressExpression,
  WORK_PROGRESS_EXPRESSION_ASSETS,
} from '../desktop/src/lib/work-progress';
import {
  eyeMatrixAttribute,
  interpolateEyeMatrix,
  interpolateSvgPath,
  WORK_PROGRESS_CLOUD_BODY_PATH,
  WORK_PROGRESS_EYE_TARGETS,
} from '../desktop/src/lib/work-progress-expression-morph';
import { pickWorkProgressLabel, WORK_PROGRESS_LABELS } from '../desktop/src/lib/work-progress-copy';
import { assistantWorkTitle } from '../desktop/src/components/chat/AssistantWork';
import { resolveCompletedWorkDurationMs } from '../desktop/src/components/chat/AssistantTurn';

describe('desktop plan preview', () => {
  it('provides varied copy for every progress state and avoids an immediate repeat', () => {
    for (const [state, labels] of Object.entries(WORK_PROGRESS_LABELS)) {
      expect(labels.length, state).toBeGreaterThanOrEqual(5);
      expect(new Set(labels).size, state).toBe(labels.length);
      expect(labels.every((label) => label.trim().length > 0), state).toBe(true);
    }
    expect(pickWorkProgressLabel('thinking', () => 0)).toBe(WORK_PROGRESS_LABELS.thinking[0]);
    expect(pickWorkProgressLabel('thinking', () => 0, WORK_PROGRESS_LABELS.thinking[0]))
      .toBe(WORK_PROGRESS_LABELS.thinking[1]);
  });

  it('uses Worked for completed traces even when reasoning duration is absent', () => {
    const tool = {
      type: 'toolCall' as const,
      id: 'tool-1',
      name: 'exec_command',
      arguments: {},
      result: { content: 'Done', timestamp: 15_800 },
    };
    const messages = [{
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'Done',
      serverTimestamp: 1_000,
      parts: [tool],
    }];
    expect(resolveCompletedWorkDurationMs(messages, [tool])).toBe(14_800);
    expect(assistantWorkTitle(false, 0, 14_800)).toBe('Worked for 14.8s');
    expect(assistantWorkTitle(false, 0)).toBe('Worked');
    expect(assistantWorkTitle(true, 500)).toBe('Working…');
  });

  it('uses full wall-clock work time instead of summing thinking fragments', () => {
    const messages = [{
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'Done',
      serverTimestamp: 2_000,
      completedAt: 31_000,
    }];
    const thinking = {
      type: 'thinking' as const,
      id: 'thinking-1',
      thinking: 'Short visible reasoning',
      durationMs: 1_200,
    };
    expect(resolveCompletedWorkDurationMs(messages, [thinking], 1_000)).toBe(30_000);
    expect(resolveCompletedWorkDurationMs(messages, [thinking], 1_000, true, 21_000)).toBe(20_000);
  });

  it('extracts one complete proposal while preserving surrounding assistant text', () => {
    expect(extractProposedPlan([
      'Intro',
      '<proposed_plan>',
      '# Release plan',
      '',
      '## Summary',
      '- Ship safely',
      '</proposed_plan>',
      'Outro',
    ].join('\n'))).toEqual({
      before: 'Intro',
      plan: '# Release plan\n\n## Summary\n- Ship safely',
      after: 'Outro',
      partial: false,
    });
  });

  it('renders an open proposal as a partial preview only while streaming', () => {
    const partial = '<proposed_plan>\n# Streaming plan\n\n## Summary';
    expect(extractProposedPlan(partial)).toBeUndefined();
    expect(extractProposedPlan(partial, true)).toMatchObject({
      plan: '# Streaming plan\n\n## Summary',
      partial: true,
    });
  });

  it('rejects ambiguous duplicate or out-of-order proposal tags', () => {
    expect(extractProposedPlan('<proposed_plan>A</proposed_plan><proposed_plan>B</proposed_plan>')).toBeUndefined();
    expect(extractProposedPlan('</proposed_plan><proposed_plan>A')).toBeUndefined();
  });

  it('promotes the first level-one heading into the preview title', () => {
    expect(splitPlanTitle('Prelude\n# Plan、Ask 与 Memory\n\n## Summary\nBody')).toEqual({
      title: 'Plan、Ask 与 Memory',
      body: 'Prelude\n\n## Summary\nBody',
    });
    expect(splitPlanTitle('## Summary\nBody')).toEqual({ title: 'Plan', body: '## Summary\nBody' });
  });

  it('wires authoritative proposal state, safe Markdown, and process action', () => {
    const bubble = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AgentBubble.tsx'), 'utf8');
    const markdown = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/MarkdownContent.tsx'), 'utf8');
    const hook = readFileSync(resolve(process.cwd(), 'desktop/src/hooks/useMetisServer.ts'), 'utf8');
    expect(bubble).toContain('workflowProposal.markdown.trim() === proposedPlan.plan.trim()');
    expect(markdown).toContain('DOMPurify.sanitize');
    expect(hook).toContain("workflowAction: 'process_proposal'");
    expect(hook).toContain('setWorkflowProposal(state.workflowProposal)');
  });

  it('ships repeatable Electron geometry checks for the real preview component', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(source).toContain('METIS_DESKTOP_CAPTURE_PLAN_PREVIEW');
    expect(source).toContain("document.querySelector('[data-plan-preview]')");
    expect(source).toContain('processHitArea');
    expect(source).toContain('collapsedMaxHeight');
    expect(source).toContain('expandedMaxHeight');
    expect(source).toContain('actionsBackgroundTransparent');
    expect(source).toContain('actionsDividerRemoved');
    expect(source).toContain('buttonsUseInterfacePills');
    expect(source).toContain('buttonsUseNeutralPalette');
    const component = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/PlanPreview.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    expect(component).toContain('plan-preview-actions');
    expect(component).not.toContain('bg-[#fbfcfd]');
    expect(component).not.toContain('border-t border-[#edf0f3]');
    expect(component).toContain('data-plan-refine=""');
    expect(component).toContain('data-plan-process=""');
    expect(component).toContain('data-plan-refine-send=""');
    expect(component).toContain('bg-[#f5f5f5]');
    expect(component).toContain('bg-[#262626]');
    expect(component).not.toContain('bg-[#e1e7f0]');
    expect(component).not.toContain('bg-[#567a70]');
    expect(component).toContain('rounded-full');
    expect(component).not.toContain('bg-[#172033]');
    expect(css).toMatch(/\.plan-preview-actions\s*\{[\s\S]*?background:\s*transparent/);
  });

  it('ships repeatable Electron checks for directly rendered thinking', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(source).toContain('METIS_DESKTOP_CAPTURE_THINKING');
    expect(source).toContain("document.querySelector('[data-thinking-block]')");
    expect(source).toContain('hasNestedToggle');
    expect(source).toContain('data-direct-thinking');
    expect(source).toContain('initialThinkingExpanded');
    expect(source).toContain('autoScrolledToBottom');
    expect(source).toContain('fadeBackdropFilter');
    expect(source).toContain('topFadeBackgroundImage');
    expect(source).toContain('topFadeHiddenAtTop');
    expect(source).toContain('topFadeRestoredAfterScroll');
    expect(source).toContain('hasThinkingIcon');
    expect(source).toContain('summaryFontWeight');
    expect(source).toContain('summaryTypographyMatchesTools');
    expect(source).toContain('thinkingSummaryMatchesBody');
    expect(source).toContain('thinkingBodyMatchesBody');
    expect(source).toContain('toolSummaryMatchesBody');
    expect(source).toContain('toolRowMatchesBody');
    expect(source).toContain('thinkingColorMatchesTools');
    expect(source).toContain('workColorDiffersFromBody');
    expect(source).toContain('headingFontWeight');
    expect(source).toContain('strongFontWeight');
    expect(source).toContain('summaryInset');
    expect(source).toContain('bodyInset');
    expect(source).toContain('workTitleInset');
    expect(source).toContain('workTextInset');
    expect(source).toContain('initialFinalResponseGap');
    expect(source).toContain('maxWorkItemGap');
    expect(source).toContain('thinkingHeaderHeight');
    expect(source).toContain('toolGroupHeaderHeight');
    expect(source).toContain('workDividerSpansContainer');
    expect(source).toContain('hasFinalDivider');
    expect(source).toContain('bodyCopyColor');
    expect(source).toContain('markdownDividerHidden');
    expect(source).toContain('finalResponseGap');
    expect(source).toContain('hasToolGroupIcon');
    expect(source).toContain('hasToolRowIcon');
  });

  it('ships a tool-only completed-work duration capture', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');
    expect(source).toContain('METIS_DESKTOP_CAPTURE_WORK_DURATION');
    expect(source).toContain('[capture:work-duration]');
    expect(app).toContain('capture-work-duration');
    expect(app).toContain('serverTimestamp: 1_000');
    expect(app).toContain('timestamp: 15_800');
  });

  it('maps current assistant work to preset progress animation states', () => {
    expect(resolveWorkProgress([{ type: 'thinking', id: 'thought', thinking: 'Inspecting' }])).toEqual({
      phase: 'thinking',
      label: 'Analyzing the request…',
      status: 'active',
    });
    expect(resolveWorkProgress([{ type: 'toolCall', id: 'search', name: 'websearch', arguments: {} }]).phase).toBe('searching');
    expect(resolveWorkProgress([{ type: 'toolCall', id: 'read', name: 'read', arguments: {} }]).phase).toBe('reading');
    expect(resolveWorkProgress([{ type: 'toolCall', id: 'exec', name: 'bash', arguments: {} }]).phase).toBe('executing');
    expect(resolveWorkProgress([{ type: 'toolCall', id: 'agent', name: 'spawn_agent', arguments: {} }]).phase).toBe('coordinating');
    expect(resolveWorkProgress([{
      type: 'toolCall', id: 'failed', name: 'read', arguments: {}, result: { content: 'Denied', isError: true },
    }]).phase).toBe('issue');
    expect(resolveWorkProgress([{
      type: 'toolCall', id: 'done', name: 'read', arguments: {}, result: { content: 'Done' },
    }])).toEqual({ phase: 'checking', label: 'Checking the latest tool result…', status: 'completed' });
    expect(resolveWorkProgress([{
      type: 'toolCall',
      id: 'agent-running',
      name: 'spawn_agent',
      arguments: { agent: 'implementer', task: 'Restore archived Tool rendering', mode: 'async' },
      result: { content: 'Subagent started' },
      progress: { jobId: 'agent1', state: 'running' },
    }])).toEqual({
      phase: 'coordinating',
      label: 'implementer is working: Restore archived Tool rendering…',
      status: 'active',
      actor: 'implementer',
    });
    expect(resolveWorkProgress([{
      type: 'toolCall',
      id: 'agent-done',
      name: 'spawn_agent',
      arguments: { agent: 'implementer', task: 'Restore archived Tool rendering' },
      progress: { jobId: 'agent1', state: 'completed' },
    }])).toEqual({
      phase: 'checking',
      label: 'Reviewing implementer’s result…',
      status: 'completed',
      actor: 'implementer',
    });
  });

  it('keeps the output-tail progress indicator in a completed state after streaming stops', () => {
    expect(resolveOutputTailProgress([{ type: 'text', id: 'answer', text: 'Done' }], false)).toEqual({
      phase: 'finalizing',
      label: 'Response complete',
      status: 'completed',
    });
  });

  it('maps live work phases to matching cloud expressions', () => {
    const progress = (phase: Parameters<typeof resolveWorkProgressExpression>[0]['phase']) => ({
      phase,
      label: phase,
      status: phase === 'waiting' ? 'waiting' as const : 'active' as const,
    });
    expect(resolveWorkProgressExpression(progress('thinking'))).toBe('attentive');
    expect(resolveWorkProgressExpression(progress('waiting'))).toBe('neutral');
    expect(resolveWorkProgressExpression(progress('reading'))).toBe('attentive');
    expect(resolveWorkProgressExpression(progress('searching'))).toBe('curious');
    expect(resolveWorkProgressExpression(progress('executing'))).toBe('excited');
    expect(resolveWorkProgressExpression(progress('issue'))).toBe('confused');
    expect(resolveWorkProgressExpression(progress('drafting'))).toBe('shy');
    expect(resolveWorkProgressExpression(progress('coordinating'))).toBe('happy');
    expect(resolveWorkProgressExpression(progress('checking'))).toBe('suspicious');
    expect(resolveWorkProgressExpression(progress('finalizing'))).toBe('proud');
  });

  it('coalesces rapid expression changes behind a minimum display window', () => {
    expect(planWorkProgressExpressionUpdate('attentive', 'curious', 1_000, 1_200, 1_250, 2_000, 450)).toEqual({
      expression: 'attentive',
      delayMs: 1_750,
    });
    expect(planWorkProgressExpressionUpdate('attentive', 'excited', 0, 2_100, 2_200, 2_000, 450)).toEqual({
      expression: 'attentive',
      delayMs: 350,
    });
    expect(planWorkProgressExpressionUpdate('attentive', 'excited', 0, 1_500, 2_200, 2_000, 450)).toEqual({
      expression: 'excited',
      delayMs: null,
    });
    expect(planWorkProgressExpressionUpdate('attentive', 'attentive', 1_000, 1_020, 1_050, 2_000, 450)).toEqual({
      expression: 'attentive',
      delayMs: null,
    });
  });

  it('morphs compatible eye paths and matrices inside one cloud body', () => {
    const attentive = WORK_PROGRESS_EYE_TARGETS.attentive[0];
    const shy = WORK_PROGRESS_EYE_TARGETS.shy[0];
    const middlePath = interpolateSvgPath(attentive.path, shy.path, 0.5);
    const middleMatrix = interpolateEyeMatrix(attentive.matrix, shy.matrix, 0.5);
    expect((middlePath.match(/[A-Za-z]/g) || []).join('')).toBe('MALALALAZ');
    expect(middlePath).not.toBe(attentive.path);
    expect(middlePath).not.toBe(shy.path);
    expect(middleMatrix[4]).toBeCloseTo((attentive.matrix[4] + shy.matrix[4]) / 2);
    expect(eyeMatrixAttribute(middleMatrix)).toMatch(/^matrix\([-\d.]+(?: [-\d.]+){5}\)$/);
    expect(WORK_PROGRESS_CLOUD_BODY_PATH.length).toBeGreaterThan(2_000);
  });

  it('ships the complete supplied cloud-expression set plus a reduced-motion fallback', () => {
    expect(Object.keys(WORK_PROGRESS_EXPRESSION_ASSETS)).toHaveLength(16);
    const cloudBodyPaths = new Set<string>();
    for (const [expression, relativeAsset] of Object.entries(WORK_PROGRESS_EXPRESSION_ASSETS)) {
      const asset = resolve(process.cwd(), 'desktop/public', relativeAsset.replace('./', ''));
      expect(existsSync(asset), expression).toBe(true);
      expect(statSync(asset).size, expression).toBeGreaterThan(10_000);
      const svg = readFileSync(asset, 'utf8');
      expect(svg, expression).toMatch(/^<svg width="250" height="250"/);
      expect(svg, expression).toContain('viewBox="-125 -125 250 250"');
      expect(svg, expression).toContain('@keyframes');
      cloudBodyPaths.add(svg.match(/<path d="([^"]+)"/)?.[1] || '');
    }
    expect(cloudBodyPaths.size).toBe(1);
    expect(readFileSync(resolve(process.cwd(), 'desktop/public/assets/bloub-progress.svg'), 'utf8')).toContain('viewBox="-125 -125 250 250"');
    const idleSvg = resolve(process.cwd(), 'desktop/public/assets/bloub-idle.svg');
    expect(existsSync(idleSvg)).toBe(true);
    expect(statSync(idleSvg).size).toBeGreaterThan(1_000);
  });

  it('renders progress at the latest model-output tail during and after streaming', () => {
    const work = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantWork.tsx'), 'utf8');
    const turn = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantTurn.tsx'), 'utf8');
    const list = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/MessageList.tsx'), 'utf8');
    const indicator = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/WorkProgressIndicator.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    const main = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(work).not.toContain('<WorkProgressIndicator');
    expect(turn).toContain('key="output-tail-progress"');
    expect(turn).toContain('progress={progress} idle={!streaming && !isWaitingUserInput}');
    expect(list).toContain('key="active-assistant-turn"');
    expect(list).toContain('messages={[]}');
    expect(list).toContain('showProgress={group === progressGroup}');
    expect(indicator).toContain('data-progress-phase={progress.phase}');
    expect(indicator).toContain('data-progress-status={progress.status}');
    expect(indicator).not.toContain('data-progress-video');
    expect(indicator).not.toContain('bloub-${progress.phase}.webm');
    expect(indicator).toContain('./assets/bloub-idle.svg');
    expect(indicator).toContain('WORK_PROGRESS_EXPRESSION_MIN_DISPLAY_MS = 2000');
    expect(indicator).toContain('WORK_PROGRESS_EXPRESSION_SETTLE_MS = 450');
    expect(indicator).toContain('WORK_PROGRESS_EXPRESSION_MORPH_MS = 420');
    expect(indicator).toContain('planWorkProgressExpressionUpdate(');
    expect(indicator).toContain('pendingExpression.current');
    expect(indicator).toContain('interpolateSvgPath(');
    expect(indicator).toContain('interpolateEyeMatrix(');
    expect(indicator).toContain('window.requestAnimationFrame(animate)');
    expect(indicator).toContain('fallbackTimer = window.setTimeout');
    expect(indicator).toContain('WORK_PROGRESS_CLOUD_BODY_PATH');
    expect(indicator).toContain('<svg');
    expect(indicator).toContain('data-progress-expression-morphing');
    expect(indicator).toContain('data-progress-expression={idle ? undefined : displayExpression}');
    expect(indicator).toContain('data-progress-expression-settle-ms={WORK_PROGRESS_EXPRESSION_SETTLE_MS}');
    expect(indicator).toContain('data-progress-expression-morph-ms={WORK_PROGRESS_EXPRESSION_MORPH_MS}');
    expect(indicator).toContain('data-progress-default-svg');
    expect(indicator).toContain('data-progress-idle-svg');
    expect(indicator).toContain('pickWorkProgressLabel(copyState');
    expect(indicator).toContain("' shimmering'");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.work-progress-fallback');
    expect(css).toContain('.work-progress-expression');
    expect(css).toMatch(/\.work-progress-expression\s*\{[\s\S]*?transform:\s*translate\(-50%, -50%\);[\s\S]*?overflow:\s*visible/);
    expect(css).toContain('@keyframes work-progress-eye-drift');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.work-progress-eye-motion\s*\{[\s\S]*?animation:\s*none/);
    expect(css).not.toMatch(/\.work-progress-expression\s*\{[^}]*transition/);
    expect(css).not.toMatch(/\.work-progress-expression\s*\{[^}]*scale\(/);
    expect(css).not.toMatch(/\.work-progress-expression\s*\{[^}]*filter:/);
    expect(css).toContain('width: 32px');
    expect(css).toContain('height: 32px');
    expect(css).toMatch(/\.work-progress-indicator\s*\{[\s\S]*?gap:\s*14px;[\s\S]*?font-size:\s*12px;[\s\S]*?font-weight:\s*400/);
    expect(css).toMatch(/\.work-progress-indicator\s*\{[\s\S]*?align-items:\s*center/);
    expect(css).toContain('max-width: none');
    expect(css).toContain('position: absolute');
    expect(css).toContain('left: calc(50% + 2px)');
    expect(css).toContain('transform: translateY(1px)');
    expect(css).toContain('transform: translate(-50%, -50%)');
    expect(css).toContain('transform: translate(-50%, -50%) scale(0.8)');
    expect(css).toContain('@keyframes work-progress-label-shimmer');
    expect(css).toContain('animation: work-progress-label-shimmer 2.2s linear infinite');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.work-progress-label\.shimmering[\s\S]*?animation:\s*none/);
    expect(css).not.toContain('translateX(-10px)');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PROGRESS');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PROGRESS_COMPLETED');
    expect(main).toContain('videoAdvanced');
    expect(main).toContain('isTail');
    expect(main).toContain('afterFinalResponse');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PROGRESS_DEFAULT');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PROGRESS_LOCAL_SEND');
    expect(main).toContain('METIS_DESKTOP_CAPTURE_PROGRESS_THINKING');
    expect(main).toContain('morphing-change');
    expect(main).toContain('expressionSettleMs');
    expect(main).toContain('expressionMorphMs');
    expect(main).toContain('idleCaptureAdvanced');
    expect(main).toContain('progressSampleDelayMs');
    expect(main).toContain('defaultSvgAdvanced');
    expect(main).toContain('activeVisualOffsetFromTurn');
    expect(main).toContain('activeVisualContentOffsetFromTurn');
    expect(main).toContain('activeVisualSize');
    expect(main).toContain('sendButtonSize');
    expect(main).toContain('labelFontSize');
    expect(main).toContain('indicatorGap');
    expect(main).toContain('labelFontWeight');
    expect(main).toContain('labelShimmering');
    expect(main).toContain('labelAnimationName');
    expect(main).toContain('indicatorAlignItems');
    expect(main).toContain('visualLabelBottomDelta');
    expect(main).toContain('afterUserMessage');
  });

  it('ships repeatable Electron checks for archived Tool cards', () => {
    const source = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    expect(source).toContain('METIS_DESKTOP_CAPTURE_TOOLS');
    expect(source).toContain("document.querySelector('[data-tool-group]')");
    expect(source).toContain('hasToolGroup');
    expect(source).toContain('hasInternalOverflow');
    expect(source).toContain('autoScrolledToBottom');
    expect(source).toContain('rowGap');
    expect(source).toContain('lastRowVisible');
    expect(source).toContain('fadeBackdropFilter');
    expect(source).toContain('topFadeBackgroundImage');
    expect(css).toMatch(/\.tool-header-bar\s*\{[\s\S]*?min-height:\s*24px;[\s\S]*?padding:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent/);
    expect(css).toMatch(/\.tool-card\.running \.tool-header-bar\s*\{\s*background:\s*transparent/);
    expect(css).toMatch(/\.tool-name\s*\{[\s\S]*?color:\s*#737373;[\s\S]*?font-size:\s*var\(--body-copy-size\);[\s\S]*?font-weight:\s*var\(--body-copy-weight\);[\s\S]*?line-height:\s*var\(--body-copy-line-height\)/);
    expect(css).toMatch(/\.tool-group-list\s*\{[\s\S]*?max-height:\s*168px;[\s\S]*?overflow-y:\s*auto/);
    expect(css).toMatch(/\.tool-group-row\s*\{[\s\S]*?min-height:\s*24px/);
    expect(css).toMatch(/\.tool-group\.has-overflow \.tool-group-body::after\s*\{[\s\S]*?height:\s*var\(--work-overflow-fade-height\);[\s\S]*?background:\s*var\(--work-overflow-fade\)/);
    expect(css).not.toMatch(/\.tool-group\.has-overflow \.tool-group-body::after\s*\{[^}]*backdrop-filter/);
  });

  it('uses the archived CoT timing and presentation contract', () => {
    expect(estimateThinkingDurationMs('x'.repeat(12))).toBe(1200);
    expect(estimateThinkingDurationMs('x'.repeat(6000))).toBe(30000);
    expect(formatThinkingDuration(1250)).toBe('1.3s');
    expect(formatThinkingDuration(62500)).toBe('1m 2s');

    const work = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantWork.tsx'), 'utf8');
    const thought = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ThinkingBlock.tsx'), 'utf8');
    const turn = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/AssistantTurn.tsx'), 'utf8');
    const tool = readFileSync(resolve(process.cwd(), 'desktop/src/components/chat/ToolCard.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'desktop/src/index.css'), 'utf8');
    expect(work).toContain('cot-container');
    expect(work).toContain('cot-collapse-wrapper');
    expect(work).toContain('groupAssistantWorkItems');
    expect(work).toContain('<ToolGroup');
    expect(work).toContain('Worked for ${formatThinkingDuration(durationMs)}');
    expect(thought).toContain('data-direct-thinking="true"');
    expect(thought).not.toContain('Thoughts');
    expect(thought).toContain('aria-expanded={expanded}');
    expect(thought).toContain('data-thinking-scroll');
    expect(turn).toContain('isSubagentLaunchNotice');
    expect(turn).toContain('after-expanded-work');
    expect(turn).not.toContain('turn-final-divider');
    expect(css).toContain('--work-final-gap: 8px');
    expect(css).toMatch(/\.turn-final-response\.after-expanded-work\s*\{[\s\S]*?margin-top:\s*var\(--work-final-gap\)/);
    expect(css).toMatch(/\.turn-final-response\.after-expanded-work > \[data-message-role="assistant"\]\s*\{[\s\S]*?margin-top:\s*0/);
    expect(tool).toContain('subagent-tool-card');
    expect(tool).toContain('data-job-id');
    expect(tool).toContain('tool-details-body');
    expect(tool).toContain('Arguments:');
    expect(tool).toContain('Output:');
    expect(tool).not.toContain('<ToolIcon');
  });
});
