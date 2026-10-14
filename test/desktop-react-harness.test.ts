import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Sidebar } from '../desktop/src/components/sidebar/Sidebar';
import { HarnessNodeDrawer } from '../desktop/src/components/harness/HarnessNodeDrawer';
import { HarnessAddNodeModal } from '../desktop/src/components/harness/HarnessAddNodeModal';
import {
  backwardGutterAnchors,
  bulgeDirection,
  edgeFlowKind,
  findOpenCardPosition,
  getTierPipeline,
  isKeptCanvasNode,
  sameColumnEdgePath,
} from '../desktop/src/components/harness/layout';

const requireDesktop = createRequire(resolve(process.cwd(), 'desktop/package.json'));
const React = requireDesktop('react') as typeof import('react');
const { renderToStaticMarkup } = requireDesktop('react-dom/server') as typeof import('react-dom/server');

describe('desktop Harness Graph Editor & sidebar integration', () => {
  it('renders the Agent Harness action button below Code Tree in the sidebar', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        agents: [],
        activeAgentId: '',
        onSelectAgent: () => undefined,
        isHarnessOpen: false,
      })
    );

    expect(markup).toContain('data-harness-action=""');
    expect(markup).toContain('data-code-tree-action=""');
    expect(markup).toContain('data-routines-action=""');
  });

  it('renders HarnessNodeDrawer with gate checks, rubric, and onFail', () => {
    const gateNode = {
      id: 'G6',
      type: 'gate' as const,
      data: {
        gateId: 'G6',
        name: 'Verification',
        checks: [{ command: 'npm test', expectExit: 0 }],
        rubric: 'All verification checks must pass',
        onFail: 'block' as const,
      },
    };

    const markup = renderToStaticMarkup(
      React.createElement(HarnessNodeDrawer, {
        node: gateNode,
        onClose: () => undefined,
        onUpdateNodeData: () => undefined,
      })
    );

    expect(markup).toContain('data-harness-drawer=""');
    expect(markup).toContain('Verification');
    expect(markup).toContain('npm test');
    expect(markup).toContain('All verification checks must pass');
    expect(markup).toContain('block');
  });

  it('renders HarnessNodeDrawer for role with tools and system prompt', () => {
    const roleNode = {
      id: 'architect',
      type: 'role' as const,
      data: {
        name: 'Architect',
        description: 'Designs systems',
        model: 'inherit',
        tools: ['read', 'edit', 'write'],
        systemPrompt: 'You are the principal architect.',
      },
    };

    const markup = renderToStaticMarkup(
      React.createElement(HarnessNodeDrawer, {
        node: roleNode,
        onClose: () => undefined,
        onUpdateNodeData: () => undefined,
      })
    );

    expect(markup).toContain('data-harness-drawer=""');
    expect(markup).toContain('Architect');
    expect(markup).toContain('read, edit, write');
    expect(markup).toContain('You are the principal architect.');
  });

  it('mounts HarnessEditor in App.tsx when isHarnessOpen is true', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(appSource).toContain('import { HarnessEditor }');
    expect(appSource).toContain('isHarnessOpen ? (');
    expect(appSource).toContain('<HarnessEditor');
    expect(appSource).toContain('registerLeaveGuard={registerHarnessLeaveGuard}');
    expect(appSource).toContain('runIfHarnessAllows');
  });

  it('hides the right inspector shell when routines, code tree, or harness is open', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'desktop/src/App.tsx'), 'utf8');

    expect(appSource).toContain("isRoutinesViewActive || isCodeTreeOpen || isHarnessOpen ? 'hidden' : 'contents'");
  });

  it('exposes harness IPC methods in main.cjs and preload.cjs', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    const preloadSource = readFileSync(resolve(process.cwd(), 'desktop/preload.cjs'), 'utf8');

    expect(mainSource).toContain('"harness:load"');
    expect(mainSource).toContain('"harness:save"');
    expect(mainSource).toContain('"harness:delete"');
    expect(mainSource).toContain('"harness:seed"');

    expect(preloadSource).toContain('harness: {');
    expect(preloadSource).toContain('load: (targetDir)');
    expect(preloadSource).toContain('save: (harness, targetDir)');
    expect(preloadSource).toContain('delete: (targetDir)');
    expect(preloadSource).toContain('seed: ()');
  });

  it('renders Delete Node action and loop-to datalist in HarnessNodeDrawer', () => {
    const gateNode = {
      id: 'custom-gate',
      type: 'gate' as const,
      data: {
        id: 'custom-gate',
        name: 'Custom Gate',
        onFail: 'loop-to:G4' as const,
      },
    };

    const markup = renderToStaticMarkup(
      React.createElement(HarnessNodeDrawer, {
        node: gateNode,
        onClose: () => undefined,
        onUpdateNodeData: () => undefined,
        onDeleteNode: () => undefined,
        availableNodeIds: ['G4', 'custom-gate', 'custom-role'],
      })
    );

    expect(markup).toContain('data-harness-delete-node=""');
    expect(markup).toContain('list="harness-node-targets"');
    expect(markup).toContain('id="harness-node-targets"');
    expect(markup).toContain('value="G4"');
  });

  it('provides toolbar buttons and interactive edge creation in HarnessEditor', () => {
    const editorSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/harness/HarnessEditor.tsx'), 'utf8');

    expect(editorSource).toContain('data-harness-add-gate=""');
    expect(editorSource).toContain('data-harness-add-role=""');
    expect(editorSource).toContain('data-harness-save=""');
    expect(editorSource).not.toContain('data-harness-close=""');
    expect(editorSource).toContain('data-harness-unsaved=""');
    expect(editorSource).toContain('registerLeaveGuard');
    expect(editorSource).toContain('data-harness-filter=""');
    expect(editorSource).toMatch(/shadow-btn[^>]*?data-harness-filter=""/);
    expect(editorSource).toContain('text-[12.5px]');
    expect(editorSource).toContain('titlebar-drag');
    expect(editorSource).toContain('h-[50px]');
    expect(editorSource).toContain('onConnect={handleConnect}');
    expect(editorSource).toContain('onDeleteNode={handleDeleteNode}');
  });

  it('bundles builtin-harness-seed.json and defaults HarnessEditor nodes/edges to the complete built-in architecture', () => {
    const seed = JSON.parse(readFileSync(resolve(process.cwd(), 'desktop/builtin-harness-seed.json'), 'utf8'));
    expect(seed.nodes.length).toBeGreaterThanOrEqual(50);
    expect(seed.edges.length).toBeGreaterThanOrEqual(100);

    const nodeTypes = new Set(seed.nodes.map((n: any) => n.type));
    expect(nodeTypes.has('tier')).toBe(true);
    expect(nodeTypes.has('framework')).toBe(true);
    expect(nodeTypes.has('gate')).toBe(true);
    expect(nodeTypes.has('role')).toBe(true);

    const editorSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/harness/HarnessEditor.tsx'), 'utf8');
    expect(editorSource).toContain("import builtinHarnessSeed from '../../../builtin-harness-seed.json'");
    expect(editorSource).toContain('useNodesState<Node>(initialNodes)');
    expect(editorSource).toContain('useEdgesState<Edge>(initialEdges)');

    const mainSource = readFileSync(resolve(process.cwd(), 'desktop/main.cjs'), 'utf8');
    expect(mainSource).toContain('getFallbackBuiltinHarness');
    expect(mainSource).toContain('res.data');
  });

  it('renders task tier sub-toolbar below the topbar and filters by task tier pipeline without "All" button', () => {
    const editorSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/harness/HarnessEditor.tsx'), 'utf8');

    // Sub-toolbar directly below 50px topbar
    expect(editorSource).toContain('h-[38px]');
    expect(editorSource).toContain("t('harnessTaskTiers')");
    expect(editorSource).toContain('data-harness-tier-tab');
    expect(editorSource).toContain('data-harness-reset-view');

    // Defaults to T1 level
    expect(editorSource).toContain("useState<TierFilter>('tier-t1')");
    expect(editorSource).toContain('handleSelectTier');

    // Excludes "全部" / "All"
    expect(editorSource).not.toContain('harnessCategoryAll');

    // Strictly renders active tier pipeline rather than entire canvas
    expect(editorSource).toContain('isKeptCanvasNode(n.id, activePipeline ? activePipeline.nodeIds : null, localNodeIds)');
    expect(editorSource).toContain('activePipeline.edgeIds.has(e.id)');

    // Integrates getTierPipeline. Edges stay mounted: viewport culling drops a
    // line whenever a handle has not been measured yet, and it does not come back.
    expect(editorSource).toContain('getTierPipeline(id, nodes, edges)');
    expect(editorSource).not.toContain('onlyRenderVisibleElements');
    expect(editorSource).toContain('isMovingRef.current');
  });

  it('renders simplified HarnessAddNodeModal with essential fields and no fake options', () => {
    const markupGate = renderToStaticMarkup(
      React.createElement(HarnessAddNodeModal, {
        isOpen: true,
        onClose: () => undefined,
        initialType: 'gate',
        onAddGate: () => undefined,
        onAddRole: () => undefined,
      })
    );

    expect(markupGate).toContain('data-harness-add-modal=""');
    expect(markupGate).toContain('data-harness-modal-save=""');
    expect(markupGate).toContain('role="dialog"');
    expect(markupGate).toContain('aria-modal="true"');
    expect(markupGate).toContain('id="harness-add-title"');
    expect(markupGate).not.toContain('role="switch"');

    const markupRole = renderToStaticMarkup(
      React.createElement(HarnessAddNodeModal, {
        isOpen: true,
        onClose: () => undefined,
        initialType: 'role',
        onAddGate: () => undefined,
        onAddRole: () => undefined,
      })
    );

    expect(markupRole).toContain('data-harness-add-modal=""');
    expect(markupRole).toContain('data-harness-modal-save=""');
    expect(markupRole).not.toContain('role="switch"');
  });

  it('renders project switcher and removes unsaved builtin seed text and extra layout/branch buttons in HarnessEditor', () => {
    const editorSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/harness/HarnessEditor.tsx'), 'utf8');

    expect(editorSource).toContain('data-harness-project-switcher=""');
    expect(editorSource).toContain('data-harness-project-option=""');
    expect(editorSource).toContain('Folder');
    expect(editorSource).not.toContain('uppercase tracking-wider');
    expect(editorSource).not.toContain('harnessAutoLayout');
    expect(editorSource).not.toContain('harnessConnModeSmart');
    expect(editorSource).toContain('edgeTypes={edgeTypes}');
    expect(editorSource).not.toContain('opacity: 0, strokeWidth: 0');
  });

  it('keeps later role delegations in the tier and routes them through the column gutter', () => {
    const seed = JSON.parse(readFileSync(resolve(process.cwd(), 'desktop/builtin-harness-seed.json'), 'utf8'));
    const nodes = seed.nodes.map((node: { id: string; type: string; position: { x: number; y: number } }) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {},
    }));
    const edges = seed.edges.map((edge: { id: string; source: string; target: string; type?: string }) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: { edgeType: edge.type },
    }));

    const t2 = getTierPipeline('tier-t2', nodes, edges);
    const t2Edges = edges.filter((edge: { id: string }) => t2.edgeIds.has(edge.id));
    const hasEdge = (source: string, target: string) =>
      t2Edges.some((edge: { source: string; target: string }) => edge.source === source && edge.target === target);

    expect(hasEdge('manager', 'synthesizer')).toBe(true);
    expect(hasEdge('coordinator', 'goal-checker')).toBe(true);
    expect(hasEdge('coordinator', 'juror')).toBe(true);
    expect(hasEdge('feature-coordinator', 'manager')).toBe(true);
    expect(t2.nodeIds.has('coordinator')).toBe(true);

    const t0 = getTierPipeline('tier-t0', nodes, edges);
    const t0Edges = edges.filter((edge: { id: string }) => t0.edgeIds.has(edge.id));
    expect(
      t0Edges.some((edge: { source: string; target: string }) => edge.source === 'coordinator' && edge.target === 'planner')
    ).toBe(false);

    const manager = { x: 1520, y: 510, width: 288, height: 76, type: 'role' };
    const synthesizer = { x: 1140, y: 930, width: 288, height: 76, type: 'role' };
    expect(edgeFlowKind(manager, synthesizer)).toBe('backward');
    const anchors = backwardGutterAnchors(manager, synthesizer);
    const gutterMid = (anchors.sourceX + anchors.targetX) / 2;
    expect(gutterMid).toBeGreaterThan(synthesizer.x + synthesizer.width);
    expect(gutterMid).toBeLessThan(manager.x);

    const scopeCoordinator = { x: 1520, y: 180, width: 288, height: 76, type: 'role' };
    const direction = bulgeDirection(scopeCoordinator, [synthesizer, manager]);
    expect(direction).toBe(-1);
    const path = sameColumnEdgePath(scopeCoordinator, manager, direction);
    expect(path.startsWith('M1520,')).toBe(true);
    expect(path).toContain('C1480,');
  });

  it('places a new harness card in open canvas space instead of on top of existing cards', () => {
    const occupied = [
      { x: 80, y: 90, width: 288, height: 76 },
      { x: 460, y: 90, width: 288, height: 76 },
    ];
    const viewport = { x: 0, y: 0, width: 1400, height: 800 };
    const spot = findOpenCardPosition(occupied, viewport, { topInset: 0, rightInset: 440 });

    expect(spot.x + 288).toBeLessThanOrEqual(1400 - 440);
    expect(spot.y).toBeGreaterThanOrEqual(0);
    for (const box of occupied) {
      const overlaps =
        spot.x < box.x + box.width + 24 &&
        spot.x + 288 + 24 > box.x &&
        spot.y < box.y + box.height + 24 &&
        spot.y + 76 + 24 > box.y;
      expect(overlaps).toBe(false);
    }
  });

  it('keeps a newly added card after the editor drawer closes and before it is linked', () => {
    const pipeline = new Set(['tier-t1', 'G1']);
    const local = new Set(['gate-new']);
    expect(isKeptCanvasNode('G1', pipeline, local)).toBe(true);
    expect(isKeptCanvasNode('gate-new', pipeline, new Set())).toBe(false);
    expect(isKeptCanvasNode('gate-new', pipeline, local)).toBe(true);
  });

  it('configures ReactFlow with hideAttribution, isValidConnection, onNodesDelete, and pathsEqual in HarnessEditor', () => {
    const editorSource = readFileSync(resolve(process.cwd(), 'desktop/src/components/harness/HarnessEditor.tsx'), 'utf8');

    expect(editorSource).toContain('pathsEqual(p.path, activeProjectPath)');
    expect(editorSource).toContain('proOptions={{ hideAttribution: true }}');
    expect(editorSource).toContain('isValidConnection={isValidConnection}');
    expect(editorSource).toContain('onNodesDelete={handleNodesDelete}');
    expect(editorSource).toContain('deletable: n.type !== \'tier\'');
  });

  it('includes fast-path edge to completion so the normal tier shows a complete pipeline', () => {
    const seed = JSON.parse(readFileSync(resolve(process.cwd(), 'desktop/builtin-harness-seed.json'), 'utf8'));
    const fastPathPipeline = getTierPipeline('tier-fast-path', seed.nodes, seed.edges);

    expect(fastPathPipeline.nodeIds.has('tier-fast-path')).toBe(true);
    expect(fastPathPipeline.nodeIds.has('complete')).toBe(true);
    expect(fastPathPipeline.edgeIds.size).toBeGreaterThanOrEqual(1);
  });

  it('renders model suggestions including tierflow and availableModels in HarnessNodeDrawer and HarnessAddNodeModal', () => {
    const roleNode = {
      id: 'custom-role',
      type: 'role' as const,
      data: {
        name: 'Custom Agent',
        description: 'Custom specialist',
        model: 'tierflow',
        tools: ['read', 'write'],
      },
    };

    const markupDrawer = renderToStaticMarkup(
      React.createElement(HarnessNodeDrawer, {
        node: roleNode,
        onClose: () => undefined,
        onUpdateNodeData: () => undefined,
        availableModels: [{ id: 'tierflow' }, { id: 'custom-model-2' }],
      })
    );

    expect(markupDrawer).toContain('id="harness-model-suggestions"');
    expect(markupDrawer).toContain('value="tierflow"');
    expect(markupDrawer).toContain('value="custom-model-2"');

    const markupModal = renderToStaticMarkup(
      React.createElement(HarnessAddNodeModal, {
        isOpen: true,
        onClose: () => undefined,
        initialType: 'role',
        onAddGate: () => undefined,
        onAddRole: () => undefined,
        availableModels: [{ id: 'tierflow' }, { id: 'custom-model-2' }],
      })
    );

    expect(markupModal).toContain('id="harness-modal-model-suggestions"');
    expect(markupModal).toContain('value="tierflow"');
    expect(markupModal).toContain('value="custom-model-2"');
  });

  it('filters loop-to datalist in HarnessNodeDrawer to exclude current gate id and prevent self-loops', () => {
    const gateNode = {
      id: 'G4',
      type: 'gate' as const,
      data: {
        id: 'G4',
        name: 'Implementation',
        onFail: 'loop-to:G1' as const,
      },
    };

    const markup = renderToStaticMarkup(
      React.createElement(HarnessNodeDrawer, {
        node: gateNode,
        onClose: () => undefined,
        onUpdateNodeData: () => undefined,
        availableNodeIds: ['G1', 'G4', 'custom-role'],
      })
    );

    expect(markup).toContain('id="harness-node-targets"');
    expect(markup).toContain('value="G1"');
    expect(markup).toContain('value="custom-role"');
    // Current gate G4 must NOT be in the loop-to target suggestions
    const options = markup.match(/<option value="([^"]+)"\/>/g) || [];
    const values = options.map((opt) => opt.match(/value="([^"]+)"/)?.[1]);
    expect(values).not.toContain('G4');
  });
});

