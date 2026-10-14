import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Network,
  Save,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Info,
  Shield,
  Bot,
  PanelLeftOpen,
  Plus,
  Layers,
  GitMerge,
  Zap,
  ChevronDown,
  Folder,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSystemTheme } from '../../hooks/useSystemTheme';
import { isMac, isWindows } from '../../lib/platform';
import { pathsEqual } from '../../hooks/useMetisServer';
import { Button } from '../atoms/Button';
import type { ProjectItem } from '../../types';
import type { HarnessDocument, HarnessCheck } from '../../types/harness';
import { TierNode } from './nodes/TierNode';
import { FrameworkNode } from './nodes/FrameworkNode';
import { GateNode } from './nodes/GateNode';
import { RoleNode } from './nodes/RoleNode';
import { HarnessNodeDrawer } from './HarnessNodeDrawer';
import { HarnessAddNodeModal } from './HarnessAddNodeModal';
import { findOpenCardPosition, getConnectedSubgraph, getTierPipeline, isKeptCanvasNode } from './layout';
import { GutterEdge } from './edges/GutterEdge';
import {
  getTierLocalization,
  getFrameworkLocalization,
  getGateLocalization,
  getRoleLocalization,
} from './harness-i18n';
import builtinHarnessSeed from '../../../builtin-harness-seed.json';

const nodeTypes = {
  tier: TierNode,
  framework: FrameworkNode,
  gate: GateNode,
  role: RoleNode,
};

const edgeTypes = {
  gutter: GutterEdge,
};

const restingEdgeStyle = {
  stroke: 'color-mix(in srgb, var(--ink) 24%, transparent)',
  strokeWidth: 1.15,
  opacity: 0.65,
};

type TierFilter = 'tier-fast-path' | 'tier-t0' | 'tier-t1' | 'tier-t2' | 'tier-t3' | null;

function documentToFlow(doc: HarnessDocument) {
  const flowNodes: Node[] = (doc.nodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    data: n.data,
    position: n.position || { x: 0, y: 0 },
    deletable: n.type !== 'tier',
  }));

  const flowEdges: Edge[] = (doc.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'gutter',
    animated: false,
    style: { ...restingEdgeStyle },
    data: {
      edgeType: e.type,
      order: e.order,
    },
  }));
  return { flowNodes, flowEdges };
}

const { flowNodes: initialNodes, flowEdges: initialEdges } = documentToFlow(
  builtinHarnessSeed as HarnessDocument
);

export interface HarnessEditorProps {
  projects?: ProjectItem[];
  activeProjectId?: string;
  activeProjectPath?: string;
  onSelectProject?: (projectId: string) => void;
  onClose: () => void;
  registerLeaveGuard?: (guard: ((proceed: () => void) => void) | null) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  availableModels?: Array<{ id: string; name?: string }>;
}

export function HarnessEditor({
  projects = [],
  activeProjectId,
  activeProjectPath,
  onSelectProject,
  onClose: _onClose,
  registerLeaveGuard,
  isSidebarOpen,
  onToggleSidebar,
  onNewChat,
  availableModels = [],
}: HarnessEditorProps) {
  const { t, language } = useI18n();
  const { isDark } = useSystemTheme();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [localNodeIds, setLocalNodeIds] = useState<Set<string>>(() => new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const [hasSavedSnapshot, setHasSavedSnapshot] = useState(false);
  const [isSnapshotInvalid, setIsSnapshotInvalid] = useState(false);
  const [snapshotErrors, setSnapshotErrors] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const isDirtyRef = useRef(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  isDirtyRef.current = isDirty;
  const [searchFilter, setSearchFilter] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('tier-t1');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addModalType, setAddModalType] = useState<'gate' | 'role'>('gate');
  const addMenuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Project switcher dropdown state
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  const activeProject = useMemo(() => {
    if (activeProjectId) {
      const found = projects.find((p) => p.id === activeProjectId);
      if (found) return found;
    }
    if (activeProjectPath) {
      const found = projects.find((p) => pathsEqual(p.path, activeProjectPath));
      if (found) return found;
    }
    return projects[0] || null;
  }, [projects, activeProjectId, activeProjectPath]);

  const displayName =
    activeProject?.name ||
    (activeProjectPath ? activeProjectPath.split(/[/\\]/).filter(Boolean).pop() : '') ||
    '';
  const displayPath = activeProject?.path || activeProjectPath || '';

  // Close project dropdown when clicking outside
  useEffect(() => {
    if (!isProjectDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProjectDropdownOpen]);

  // Close add dropdown when clicking outside
  useEffect(() => {
    if (!isAddMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddMenuOpen]);

  // Hover throttle & movement guards for buttery smooth 60fps interaction
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMovingRef = useRef(false);

  // Apply harness document to xyflow state
  const applyDocument = useCallback(
    (doc: HarnessDocument, saved: boolean, invalid = false, errors: string[] = []) => {
      const { flowNodes, flowEdges } = documentToFlow(doc);
      setNodes(flowNodes);
      setEdges(flowEdges);
      setLocalNodeIds(new Set());
      setHasSavedSnapshot(saved);
      setIsSnapshotInvalid(invalid);
      setSnapshotErrors(errors);
      setIsDirty(false);
      setTimeout(() => rfInstance?.fitView({ padding: 0.15, duration: 400 }), 80);
    },
    [setNodes, setEdges, rfInstance]
  );

  const rememberLocalNode = useCallback((id: string) => {
    setLocalNodeIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Load document on mount or project change
  useEffect(() => {
    let cancelled = false;
    const desktop = (window as any).metisDesktop;

    async function loadData() {
      try {
        if (desktop?.harness?.load) {
          const res = await desktop.harness.load(activeProjectPath);
          if (cancelled) return;
          if (res?.harness) {
            applyDocument(res.harness, Boolean(res.exists), !res.valid, res.errors || []);
            return;
          }
        } else {
          const query = activeProjectPath ? `?cwd=${encodeURIComponent(activeProjectPath)}` : '';
          const fetchRes = await fetch(`/harness${query}`);
          if (cancelled) return;
          if (fetchRes.ok) {
            const res = await fetchRes.json();
            if (res?.harness) {
              applyDocument(res.harness, Boolean(res.exists), !res.valid, res.errors || []);
              return;
            }
          }
        }
        // Fallback: seed request
        if (desktop?.harness?.seed) {
          const seedRes = await desktop.harness.seed();
          if (cancelled) return;
          if (seedRes?.harness) {
            applyDocument(seedRes.harness, false);
            return;
          }
        } else {
          const seedRes = await fetch('/harness/seed');
          if (cancelled) return;
          if (seedRes.ok) {
            const data = await seedRes.json();
            if (data?.harness) {
              applyDocument(data.harness, false);
              return;
            }
          }
        }
        if (cancelled) return;
        applyDocument(builtinHarnessSeed as HarnessDocument, false);
      } catch (err) {
        console.error('Failed to load harness graph:', err);
        if (!cancelled) {
          applyDocument(builtinHarnessSeed as HarnessDocument, false);
        }
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [activeProjectPath, applyDocument]);

  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard((proceed) => {
      if (!isDirtyRef.current) {
        proceed();
        return;
      }
      pendingLeaveRef.current = proceed;
      setLeavePromptOpen(true);
    });
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard]);

  const finishLeave = useCallback((proceed: boolean) => {
    const action = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    setLeavePromptOpen(false);
    if (proceed) action?.();
  }, []);

  // Save current graph to .metis/harness.json
  const handleSave = async (): Promise<boolean> => {
    const doc: HarnessDocument = {
      version: 1,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as any,
        data: n.data as any,
        position: n.position,
      })),
      edges: edges.map((e) => {
        const edgeData = (e.data as any) || {};
        let edgeType = edgeData.edgeType;
        if (!edgeType || edgeType === 'gutter') {
          const sNode = nodes.find((n) => n.id === e.source);
          const tNode = nodes.find((n) => n.id === e.target);
          if (sNode?.type === 'tier') edgeType = tNode?.type === 'gate' ? 'tier-gate' : 'tier-framework';
          else if (sNode?.type === 'framework' && tNode?.type === 'gate') edgeType = 'framework-gate';
          else if (sNode?.type === 'gate' && tNode?.type === 'role') edgeType = 'gate-role';
          else if (sNode?.type === 'role' && tNode?.type === 'role') edgeType = 'role-delegation';
          else edgeType = 'role-delegation';
        }
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: edgeType,
          order: typeof edgeData.order === 'number' ? edgeData.order : (e as any).order,
          label: typeof e.label === 'string' ? e.label : undefined,
        };
      }),
    };

    const desktop = (window as any).metisDesktop;
    try {
      if (desktop?.harness?.save) {
        const res = await desktop.harness.save(doc, activeProjectPath);
        if (res?.success) {
          setHasSavedSnapshot(true);
          setIsSnapshotInvalid(false);
          setSnapshotErrors([]);
          setIsDirty(false);
          setFeedbackMessage(t('harnessSaveSuccess') || 'Saved to .metis/harness.json successfully');
          setTimeout(() => setFeedbackMessage(null), 3000);
          return true;
        } else if (res?.error) {
          setFeedbackMessage(String(res.error));
          setTimeout(() => setFeedbackMessage(null), 5000);
          return false;
        }
      } else {
        const res = await fetch('/harness', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: activeProjectPath, harness: doc }),
        });
        if (res.ok) {
          setHasSavedSnapshot(true);
          setIsSnapshotInvalid(false);
          setSnapshotErrors([]);
          setIsDirty(false);
          setFeedbackMessage(t('harnessSaveSuccess') || 'Saved to .metis/harness.json successfully');
          setTimeout(() => setFeedbackMessage(null), 3000);
          return true;
        } else {
          const errData = await res.json().catch(() => null);
          setFeedbackMessage(errData?.message || errData?.error || 'Save failed');
          setTimeout(() => setFeedbackMessage(null), 5000);
          return false;
        }
      }
      return false;
    } catch (err) {
      console.error('Failed to save harness document:', err);
      return false;
    }
  };

  // Revert to builtin (delete .metis/harness.json)
  const handleDeleteOverride = async () => {
    const confirmText =
      t('harnessDeleteConfirm') ||
      'Are you sure you want to delete .metis/harness.json and revert to builtin harness?';
    if (!window.confirm(confirmText)) return;

    const desktop = (window as any).metisDesktop;
    try {
      if (desktop?.harness?.delete) {
        await desktop.harness.delete(activeProjectPath);
        const seedRes = await desktop.harness.seed?.();
        if (seedRes?.harness) {
          applyDocument(seedRes.harness, false);
        } else {
          applyDocument(builtinHarnessSeed as HarnessDocument, false);
        }
      } else {
        const query = activeProjectPath ? `?cwd=${encodeURIComponent(activeProjectPath)}` : '';
        await fetch(`/harness${query}`, { method: 'DELETE' });
        const seedRes = await fetch('/harness/seed');
        if (seedRes.ok) {
          const data = await seedRes.json();
          if (data?.harness) {
            applyDocument(data.harness, false);
          } else {
            applyDocument(builtinHarnessSeed as HarnessDocument, false);
          }
        } else {
          applyDocument(builtinHarnessSeed as HarnessDocument, false);
        }
      }
      setFeedbackMessage(t('harnessDeleteSuccess') || 'Reverted to builtin seed');
      setTimeout(() => setFeedbackMessage(null), 3000);
    } catch (err) {
      console.error('Failed to delete harness override:', err);
      applyDocument(builtinHarnessSeed as HarnessDocument, false);
    }
  };

  // Validate allowed architectural connections
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const st = sourceNode.type;
      const tt = targetNode.type;

      if (st === 'tier') return tt === 'framework' || tt === 'gate';
      if (st === 'framework') return tt === 'gate';
      if (st === 'gate') return tt === 'role';
      if (st === 'role') return tt === 'role';
      return false;
    },
    [nodes]
  );

  // Connect edge
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      const sourceType = sourceNode?.type;
      const targetType = targetNode?.type;

      let edgeType = 'role-delegation';
      let order: number | undefined;

      if (sourceType === 'tier' || connection.source.startsWith('tier-')) {
        edgeType = targetType === 'gate' ? 'tier-gate' : 'tier-framework';
      } else if (sourceType === 'framework' && targetType === 'gate') {
        edgeType = 'framework-gate';
        const existingFwGateEdges = edges.filter(
          (e) => e.source === connection.source && (e.data?.edgeType === 'framework-gate' || (e as any).type === 'framework-gate')
        );
        order = existingFwGateEdges.length + 1;
      } else if (sourceType === 'gate' && targetType === 'role') {
        edgeType = 'gate-role';
      } else if (sourceType === 'role' && targetType === 'role') {
        edgeType = 'role-delegation';
      } else if (sourceType === 'framework') {
        edgeType = 'framework-gate';
      } else if (sourceType === 'gate') {
        edgeType = 'gate-role';
      }

      const newEdgeId = `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newEdge: Edge = {
        ...connection,
        id: newEdgeId,
        source: connection.source,
        target: connection.target,
        type: 'gutter',
        animated: false,
        style: { ...restingEdgeStyle },
        data: {
          edgeType,
          order,
        },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      setIsDirty(true);
    },
    [nodes, edges, setEdges]
  );

  // Delete node and remove connected edges & reset loop-to targets referencing this node
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds
          .filter((n) => n.id !== nodeId)
          .map((n) =>
            n.type === 'gate' && n.data?.onFail === `loop-to:${nodeId}`
              ? { ...n, data: { ...n.data, onFail: 'block' } }
              : n
          )
      );
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setLocalNodeIds((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      setIsDirty(true);
    },
    [selectedNodeId, setEdges, setNodes]
  );

  const handleNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const deletedIds = new Set(deletedNodes.map((n) => n.id));
      setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)));
      setNodes((nds) =>
        nds.map((n) =>
          n.type === 'gate' && typeof n.data?.onFail === 'string' && deletedIds.has(n.data.onFail.replace('loop-to:', ''))
            ? { ...n, data: { ...n.data, onFail: 'block' } }
            : n
        )
      );
      setLocalNodeIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        deletedIds.forEach((id) => {
          if (next.has(id)) {
            next.delete(id);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      if (selectedNodeId && deletedIds.has(selectedNodeId)) {
        setSelectedNodeId(null);
      }
      setIsDirty(true);
    },
    [selectedNodeId, setEdges, setNodes]
  );

  // Update node data from drawer
  const handleUpdateNodeData = useCallback(
    (nodeId: string, updatedData: any) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updatedData } } : n))
      );
      setIsDirty(true);
    },
    [setNodes]
  );

  // Selected node object for drawer
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  // Active focus subgraph (from hovered/selected node)
  const focusSubgraph = useMemo(() => {
    const focusTarget = hoveredNodeId || selectedNodeId;
    if (focusTarget) {
      const sub = getConnectedSubgraph(focusTarget, edges);
      return { nodeIds: sub.connectedNodeIds, edgeIds: sub.connectedEdgeIds };
    }
    return null;
  }, [hoveredNodeId, selectedNodeId, edges]);

  // Node counts
  const counts = useMemo(() => {
    let tiers = 0;
    let frameworks = 0;
    let gates = 0;
    let roles = 0;
    for (const n of nodes) {
      if (n.type === 'tier') tiers++;
      else if (n.type === 'framework') frameworks++;
      else if (n.type === 'gate') gates++;
      else if (n.type === 'role') roles++;
    }
    return { tiers, frameworks, gates, roles };
  }, [nodes]);

  const TASK_TIERS = useMemo(
    () => [
      { id: 'tier-fast-path', label: t('harnessTierFastPath') || '普通', icon: Zap },
      { id: 'tier-t0', label: t('harnessTierT0') || 'T0 极简', icon: CheckCircle2 },
      { id: 'tier-t1', label: t('harnessTierT1') || 'T1 标准', icon: Layers },
      { id: 'tier-t2', label: t('harnessTierT2') || 'T2 复杂', icon: GitMerge },
      { id: 'tier-t3', label: t('harnessTierT3') || 'T3 协同', icon: Network },
    ],
    [t]
  );

  // Computes the node/edge pipeline for each task tier
  const tierPipelines = useMemo(() => {
    const map: Record<string, { nodeIds: Set<string>; edgeIds: Set<string> }> = {};
    const ids = ['tier-fast-path', 'tier-t0', 'tier-t1', 'tier-t2', 'tier-t3'];
    ids.forEach((id) => {
      map[id] = getTierPipeline(id, nodes, edges);
    });
    return map;
  }, [nodes, edges]);

  const activePipeline = useMemo(() => {
    if (!tierFilter) return null;
    return tierPipelines[tierFilter] || null;
  }, [tierFilter, tierPipelines]);

  // Switch tier canvas & smoothly fit viewport
  const handleSelectTier = useCallback(
    (tierId: TierFilter) => {
      setTierFilter(tierId);
      setSelectedNodeId(null);
      setHoveredNodeId(null);
      setTimeout(() => {
        rfInstance?.fitView({ padding: 0.2, duration: 350 });
      }, 50);
    },
    [rfInstance]
  );

  // Filter nodes: strictly renders ONLY the active task tier pipeline nodes
  const displayNodes = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();

    // Strictly filter to active tier pipeline nodes (or newly created node)
    const pipelineNodes = nodes.filter((n) =>
      isKeptCanvasNode(n.id, activePipeline ? activePipeline.nodeIds : null, localNodeIds)
    );

    return pipelineNodes.map((n) => {
      const d = n.data as any;
      const toolsMatch = Array.isArray(d.tools) && d.tools.some((tl: string) => tl.toLowerCase().includes(q));

      const loc =
        n.type === 'tier'
          ? getTierLocalization(n.id, d, language)
          : n.type === 'framework'
          ? getFrameworkLocalization(n.id, d, language)
          : n.type === 'gate'
          ? getGateLocalization(n.id, d, language)
          : n.type === 'role'
          ? getRoleLocalization(n.id, d, language)
          : null;

      const locName = (loc as any)?.displayName || (loc as any)?.name || '';
      const locDesc = (loc as any)?.description || (loc as any)?.invariant || '';

      const matchSearch =
        !q ||
        n.id.toLowerCase().includes(q) ||
        String(d.name || '').toLowerCase().includes(q) ||
        String(d.description || '').toLowerCase().includes(q) ||
        String(d.invariant || '').toLowerCase().includes(q) ||
        String(d.rubric || '').toLowerCase().includes(q) ||
        String(d.model || '').toLowerCase().includes(q) ||
        locName.toLowerCase().includes(q) ||
        locDesc.toLowerCase().includes(q) ||
        toolsMatch;

      const isConnected = !focusSubgraph || focusSubgraph.nodeIds.has(n.id);
      const isSelected = n.id === selectedNodeId;
      const isHovered = n.id === hoveredNodeId;

      const isVisible = matchSearch && isConnected;

      return {
        ...n,
        selected: isSelected,
        style: {
          opacity: isVisible ? 1 : 0.2,
          zIndex: isHovered || isSelected ? 30 : isConnected ? 10 : 1,
        },
      };
    });
  }, [
    nodes,
    searchFilter,
    activePipeline,
    focusSubgraph,
    selectedNodeId,
    hoveredNodeId,
    localNodeIds,
  ]);

  // Every pipeline edge uses the same gutter curve as framework → gate.
  // Focusing a node darkens its own edges and leaves the rest of the river visible.
  const displayEdges = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    const pipelineEdges = edges.filter((e) => {
      if (!activePipeline) return true;
      if (activePipeline.edgeIds.has(e.id)) return true;
      return localNodeIds.has(e.source) || localNodeIds.has(e.target);
    });

    return pipelineEdges.map((e) => {
      const isConnected = focusSubgraph ? focusSubgraph.edgeIds.has(e.id) : false;
      if (isConnected) {
        return {
          ...e,
          type: 'gutter',
          animated: false,
          style: {
            stroke: 'var(--ink)',
            strokeWidth: 1.8,
            opacity: 1,
          },
        };
      }

      const isDimmedBySearch = Boolean(q) && !focusSubgraph;

      return {
        ...e,
        type: 'gutter',
        animated: false,
        style: {
          ...restingEdgeStyle,
          opacity: isDimmedBySearch ? 0.2 : restingEdgeStyle.opacity,
        },
      };
    });
  }, [edges, activePipeline, focusSubgraph, localNodeIds, searchFilter]);

  // Debounced hover handlers to eliminate micro-stutters during fast mouse sweeps
  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (isMovingRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredNodeId(node.id);
    }, 60);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredNodeId((curr) => (curr ? null : curr));
  }, []);

  const handleMoveStart = useCallback(() => {
    isMovingRef.current = true;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleMoveEnd = useCallback(() => {
    isMovingRef.current = false;
  }, []);


  // Connections count for hovered/selected node HUD
  const activeFocusMetrics = useMemo(() => {
    const targetId = hoveredNodeId || selectedNodeId;
    if (!targetId) return null;
    const targetNode = nodes.find((n) => n.id === targetId);
    if (!targetNode) return null;

    let incoming = 0;
    let outgoing = 0;
    edges.forEach((e) => {
      if (e.target === targetId) incoming++;
      if (e.source === targetId) outgoing++;
    });

    return {
      node: targetNode,
      incoming,
      outgoing,
    };
  }, [hoveredNodeId, selectedNodeId, nodes, edges]);

  const handleOpenAddGateModal = useCallback(() => {
    setAddModalType('gate');
    setIsAddModalOpen(true);
  }, []);

  const handleOpenAddRoleModal = useCallback(() => {
    setAddModalType('role');
    setIsAddModalOpen(true);
  }, []);

  const handleAddGate = handleOpenAddGateModal;
  const handleAddRole = handleOpenAddRoleModal;

  const placeNewCard = useCallback(() => {
    const zoom = rfInstance?.getViewport().zoom || 1;
    const vp = rfInstance?.getViewport();
    const host = canvasRef.current;
    const viewport =
      host && vp && host.clientWidth > 0 && host.clientHeight > 0
        ? {
            x: -vp.x / zoom,
            y: -vp.y / zoom,
            width: host.clientWidth / zoom,
            height: host.clientHeight / zoom,
          }
        : { x: 0, y: 0, width: 1400, height: 900 };
    const visibleIds = activePipeline?.nodeIds;
    const occupied = nodes
      .filter((node) => !visibleIds || visibleIds.has(node.id))
      .map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? node.width ?? 288,
        height: node.measured?.height ?? node.height ?? 76,
      }));
    return findOpenCardPosition(occupied, viewport, {
      topInset: 72 / zoom,
      rightInset: 440 / zoom,
    });
  }, [activePipeline, nodes, rfInstance]);

  const handleSaveAddGate = useCallback(
    (payload: {
      id: string;
      name: string;
      rubric: string;
      checks: HarnessCheck[];
      onFail: 'block' | string;
    }) => {
      const position = placeNewCard();

      const newGateNode: Node = {
        id: payload.id,
        type: 'gate',
        position,
        data: {
          id: payload.id,
          name: payload.name,
          invariant: payload.rubric || payload.name,
          rubric: payload.rubric,
          checks: payload.checks,
          onFail: payload.onFail,
        },
      };

      setNodes((nds) => [...nds, newGateNode]);
      rememberLocalNode(payload.id);
      setSelectedNodeId(payload.id);
      setIsDirty(true);
      setFeedbackMessage(t('harnessSaveSuccess') ? '质量门已添加' : 'Gate added');
      setTimeout(() => setFeedbackMessage(null), 2500);
    },
    [placeNewCard, rememberLocalNode, setNodes, t]
  );

  const handleSaveAddRole = useCallback(
    (payload: {
      id: string;
      name: string;
      description: string;
      systemPrompt: string;
      tools: string[];
      model?: string;
      thinking?: string;
    }) => {
      const position = placeNewCard();

      const newRoleNode: Node = {
        id: payload.id,
        type: 'role',
        position,
        data: {
          id: payload.id,
          name: payload.name,
          description: payload.description,
          systemPrompt: payload.systemPrompt,
          tools: payload.tools,
          model: payload.model || 'inherit',
          thinking: (payload.thinking as any) || undefined,
          maxSpawnDepth: 1,
        },
      };

      setNodes((nds) => [...nds, newRoleNode]);
      rememberLocalNode(payload.id);
      setSelectedNodeId(payload.id);
      setIsDirty(true);
      setFeedbackMessage(t('harnessSaveSuccess') ? '角色已添加' : 'Role added');
      setTimeout(() => setFeedbackMessage(null), 2500);
    },
    [placeNewCard, rememberLocalNode, setNodes, t]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      const isStructureChange = changes.some(
        (c) => c.type === 'remove' || (c.type === 'position' && (c as any).dragging)
      );
      if (isStructureChange) setIsDirty(true);
    },
    [onNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: any[]) => {
      onEdgesChange(changes);
      const hasStructureChange = changes.some((c) => c.type === 'remove' || c.type === 'add');
      if (hasStructureChange) setIsDirty(true);
    },
    [onEdgesChange]
  );

  return (
    <div
      className="flex-1 flex flex-col min-w-0 min-h-0 bg-page relative overflow-hidden h-full select-none"
      data-harness-editor=""
    >
      {/* 1. Top Titlebar — Clean, quiet titlebar referenced from Image 2 */}
      <div
        className={`titlebar-drag flex h-[50px] shrink-0 items-center justify-between border-b border-line/60 bg-page select-none z-10 gap-3 ${
          !isSidebarOpen ? 'px-3.5' : 'pl-6 pr-3.5'
        } ${isWindows ? 'pr-[140px]' : ''}`}
      >
        {/* Left: Sidebar Toggle + Title + Quiet Status (mirroring RoutinesManager) */}
        <div className="no-drag flex items-center gap-2 min-w-0">
          {!isSidebarOpen && (
            <>
              {isMac && <div className="h-[16px] w-[66px]" />}
              {onToggleSidebar && (
                <button
                  type="button"
                  onClick={onToggleSidebar}
                  className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink cursor-pointer"
                  title={t('expandSidebar') || 'Open Sidebar'}
                >
                  <PanelLeftOpen className="h-4 w-4 stroke-[1.8]" />
                </button>
              )}
              {onNewChat && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink cursor-pointer"
                  title={t('newChat') || 'New Chat'}
                >
                  <Plus className="h-4 w-4 stroke-[2]" />
                </button>
              )}
            </>
          )}

          <h1
            className="truncate text-[14px] font-medium text-ink shrink-0"
            title={`${counts.tiers} 层级 · ${counts.frameworks} 框架 · ${counts.gates} 质量门 · ${counts.roles} 角色`}
          >
            {t('harnessGraphEditor') || 'Agent 架构'}
          </h1>

          {/* Project Switcher */}
          {displayName && (
            <div className="relative inline-flex items-center" ref={projectDropdownRef}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => projects.length > 1 && setIsProjectDropdownOpen((v) => !v)}
                className="gap-1 rounded-full h-[28px] px-3 font-medium text-[12.5px]"
                title={displayPath}
                aria-expanded={isProjectDropdownOpen}
                data-harness-project-switcher=""
              >
                <Folder className="h-3.5 w-3.5 stroke-[1.8]" />
                <span className="truncate max-w-[150px]">{displayName}</span>
                {projects.length > 1 && <ChevronDown className="h-3 w-3 stroke-[2] text-ink-3 ml-0.5" />}
              </Button>

              {isProjectDropdownOpen && projects.length > 1 && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-[12px] bg-surface border border-line shadow-popover p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                  {projects.map((p) => {
                    const isActive = p.id === activeProjectId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setIsProjectDropdownOpen(false);
                          if (!isActive) onSelectProject?.(p.id);
                        }}
                        title={p.path}
                        data-harness-project-option=""
                        className={`flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer rounded-[8px] ${
                          isActive ? 'bg-hover' : 'hover:bg-hover'
                        }`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-inset text-ink-2">
                          <Folder className="h-3.5 w-3.5 stroke-[1.8]" />
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-[13px] leading-tight text-ink truncate">
                            {p.name}
                          </span>
                          <span className="text-[11px] text-ink-3 leading-tight mt-0.5 truncate">
                            {p.path}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {hasSavedSnapshot && isSnapshotInvalid && (
            <span
              className="text-[12px] text-red font-medium flex items-center gap-1"
              title={snapshotErrors.join('; ')}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{t('harnessInvalidSnapshot') || '快照损坏'}</span>
            </span>
          )}

          {feedbackMessage && (
            <span className="text-[12px] text-green font-medium animate-in fade-in duration-200">
              · {feedbackMessage}
            </span>
          )}
        </div>

        {/* Right: Quick Search + Modes + Add Dropdown + Save CTA */}
        <div className="no-drag flex items-center gap-2 shrink-0">
          {/* Quick Node Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none stroke-[1.8]" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={t('harnessFilterPlaceholder') || '搜索节点...'}
              className="w-36 focus:w-52 sm:w-44 sm:focus:w-60 h-[28px] pl-8 pr-7 rounded-full bg-surface text-ink text-[12.5px] placeholder:text-ink-3 outline-none shadow-btn hover:bg-inset focus:bg-surface focus:ring-2 focus:ring-[color:var(--focus)]/25 transition-all duration-150"
              data-harness-filter=""
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink text-[13px] leading-none cursor-pointer"
              >
                ×
              </button>
            )}
          </div>

          {/* Revert override button (when saved) */}
          {hasSavedSnapshot && (
            <button
              type="button"
              onClick={handleDeleteOverride}
              className="flex h-7 w-7 items-center justify-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink cursor-pointer"
              title={t('harnessDeleteOverride') || '恢复内置种子'}
              data-harness-revert=""
            >
              <RotateCcw className="h-4 w-4 stroke-[1.8]" />
            </button>
          )}

          {/* Add Dropdown Pill: Consolidated Add Gate & Add Role */}
          <div className="relative" ref={addMenuRef}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsAddMenuOpen((prev) => !prev)}
              className="gap-1 rounded-full h-[28px] px-3 font-medium text-[12.5px]"
              title={t('harnessAddNode') || '添加节点'}
            >
              <Plus className="h-3.5 w-3.5 stroke-[2]" />
              <span>{t('harnessAdd') || '添加'}</span>
              <ChevronDown className="h-3 w-3 stroke-[2] text-ink-3 ml-0.5" />
            </Button>

            {isAddMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-[12px] bg-surface border border-line shadow-popover p-1 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => {
                    handleOpenAddGateModal();
                    setIsAddMenuOpen(false);
                  }}
                  title={t('harnessAddGate') || '添加质量门'}
                  data-harness-add-gate=""
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-hover text-left transition-colors cursor-pointer rounded-[8px]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-inset text-ink-2">
                    <Shield className="h-3.5 w-3.5 stroke-[1.8]" />
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-[13px] leading-tight text-ink">
                      {t('harnessAddGate') || '添加质量门'}
                    </span>
                    <span className="text-[11px] text-ink-3 leading-tight mt-0.5">
                      质量验证与代码检查
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleOpenAddRoleModal();
                    setIsAddMenuOpen(false);
                  }}
                  title={t('harnessAddRole') || '添加代理角色'}
                  data-harness-add-role=""
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-hover text-left transition-colors cursor-pointer rounded-[8px]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-inset text-ink-2">
                    <Bot className="h-3.5 w-3.5 stroke-[1.8]" />
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-[13px] leading-tight text-ink">
                      {t('harnessAddRole') || '添加代理角色'}
                    </span>
                    <span className="text-[11px] text-ink-3 leading-tight mt-0.5">
                      专项职责与工具调用
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Primary Action Button: Save to Project (matching Image 2) */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            title={t('harnessSaveToProject') || '保存到项目'}
            data-harness-save=""
            className="gap-1.5 rounded-full h-[28px] px-3.5 text-[12.5px] font-medium"
          >
            <Save className="h-3.5 w-3.5 stroke-[1.8]" />
            <span>{t('harnessSaveToProject') || '保存到项目'}</span>
          </Button>

        </div>
      </div>

      {/* 2. Main Graph Area with Viewport Culling & Floating Big Capsule (wrapping small capsules) */}
      <div ref={canvasRef} className="flex-1 relative w-full h-full min-h-0 min-w-0 bg-page">
        {/* Floating Big Capsule wrapping small tier capsules */}
        <div
          className="absolute top-3.5 left-1/2 -translate-x-1/2 z-20 inline-flex items-center h-[38px] p-1 rounded-full bg-field/85 backdrop-blur-md border border-line shadow-card select-none gap-1"
          role="toolbar"
          aria-label={t('harnessTaskTiers') || '任务等级'}
        >
          {TASK_TIERS.map((tier) => {
            const isActive = tierFilter === tier.id;
            const IconComp = tier.icon;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => handleSelectTier(tier.id as TierFilter)}
                className={`inline-flex items-center justify-center gap-1.5 h-[28px] px-3.5 rounded-full text-[12px] transition-all cursor-pointer select-none ${
                  isActive
                    ? 'bg-surface text-ink font-semibold border border-line shadow-btn'
                    : 'text-ink-3 hover:text-ink hover:bg-hover/60 border border-transparent'
                }`}
                title={`切换至 ${tier.label} 画布`}
                data-harness-tier-tab={tier.id}
              >
                <IconComp
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isActive ? 'text-ink stroke-[2]' : 'text-ink-3 stroke-[1.8]'
                  }`}
                />
                <span className="leading-none">{tier.label}</span>
              </button>
            );
          })}
        </div>

        {/* Floating Reset View Pill on the top right */}
        <div className="absolute top-3.5 right-3.5 z-20 hidden md:flex items-center">
          <button
            type="button"
            onClick={() => {
              rfInstance?.fitView({ padding: 0.2, duration: 300 });
            }}
            className="inline-flex items-center gap-1 h-[28px] px-3 rounded-full text-[11px] font-medium text-ink-3 hover:text-ink bg-surface/85 backdrop-blur-md border border-line shadow-card hover:bg-surface transition-colors cursor-pointer"
            data-harness-reset-view=""
            title="居中适应当前画布"
          >
            <span>{t('harnessFitView') || t('harnessResetView') || '适应画布'}</span>
          </button>
        </div>
        <ReactFlow
          colorMode={isDark ? 'dark' : 'light'}
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodesDelete={handleNodesDelete}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          proOptions={{ hideAttribution: true }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onMoveStart={handleMoveStart}
          onMoveEnd={handleMoveEnd}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setHoveredNodeId(null);
          }}
          onInit={(instance) => setRfInstance(instance)}
          fitView
          minZoom={0.2}
          maxZoom={2.2}
          defaultEdgeOptions={{
            type: 'gutter',
            style: { ...restingEdgeStyle },
          }}
          elevateNodesOnSelect={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="color-mix(in srgb, var(--ink) 12%, transparent)"
            className="opacity-100"
          />
        </ReactFlow>

        {/* Floating Focus / HUD Tooltip at Bottom Center */}
        {activeFocusMetrics && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-surface/95 backdrop-blur-md border border-line shadow-card text-ink flex items-center gap-2.5 z-20 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-[12px] font-medium text-ink">
                {(activeFocusMetrics.node.data as any)?.name || activeFocusMetrics.node.id}
              </span>
            </div>
            <div className="h-3 w-[1px] bg-line" />
            <div className="text-[11px] text-ink-3 flex items-center gap-1.5">
              <span>{activeFocusMetrics.incoming} 上游</span>
              <span>·</span>
              <span>{activeFocusMetrics.outgoing} 下游</span>
            </div>
          </div>
        )}

        {/* Embedded Node Inspector Drawer */}
        <HarnessNodeDrawer
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onUpdateNodeData={handleUpdateNodeData}
          onDeleteNode={handleDeleteNode}
          availableNodeIds={nodes.map((n) => n.id)}
          availableModels={availableModels}
        />

        {/* Add Node Modal — simplified and genuine */}
        <HarnessAddNodeModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          initialType={addModalType}
          onAddGate={handleSaveAddGate}
          onAddRole={handleSaveAddRole}
          availableNodeIds={nodes.map((n) => n.id)}
          availableModels={availableModels}
        />
      </div>

      {leavePromptOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/30 p-5 backdrop-blur-[3px]"
          data-harness-unsaved=""
        >
          <div
            className="w-full max-w-sm rounded-[12px] bg-surface border border-line p-5 shadow-overlay flex flex-col gap-3"
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-[14px] font-semibold text-ink">
              {t('harnessUnsavedTitle') || '尚未保存'}
            </h2>
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              {t('harnessUnsavedPrompt') || '架构还有未保存的修改，离开后这些修改会丢失。'}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => finishLeave(false)}
                className="h-8 px-3 rounded-full text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink transition-colors cursor-pointer"
                data-harness-unsaved-stay=""
              >
                {t('harnessUnsavedStay') || '继续编辑'}
              </button>
              <button
                type="button"
                onClick={() => finishLeave(true)}
                className="h-8 px-3 rounded-full text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink transition-colors cursor-pointer"
                data-harness-unsaved-discard=""
              >
                {t('harnessUnsavedDiscard') || '不保存离开'}
              </button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void handleSave().then((saved) => {
                    if (saved) finishLeave(true);
                  });
                }}
                className="h-[28px] rounded-full px-3 text-[12.5px]"
                data-harness-unsaved-save=""
              >
                {t('harnessUnsavedSave') || '保存并离开'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
