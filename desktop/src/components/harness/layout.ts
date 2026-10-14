import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

export type LayoutDirection = 'LR' | 'TB';

/**
 * Computes hierarchical layout using Dagre.
 */
export function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = 'LR',
  options?: { nodeSep?: number; rankSep?: number }
): Node[] {
  const g = new dagre.graphlib.Graph();
  const isHorizontal = direction === 'LR';

  g.setGraph({
    rankdir: direction,
    nodesep: options?.nodeSep ?? (isHorizontal ? 36 : 40),
    ranksep: options?.rankSep ?? (isHorizontal ? 135 : 95),
    marginx: 60,
    marginy: 60,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Define realistic card sizes for Dagre layout
  nodes.forEach((node) => {
    const width = 288;
    const height = 76;
    g.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    const width = 288;
    const height = 76;

    return {
      ...node,
      position: {
        x: Math.round(dagreNode.x - width / 2),
        y: Math.round(dagreNode.y - height / 2),
      },
    };
  });
}

/**
 * Trace connected subgraph (both ancestors and descendants) for a focused node.
 */
export function getConnectedSubgraph(
  focusedNodeId: string | null,
  edges: Edge[]
): { connectedNodeIds: Set<string>; connectedEdgeIds: Set<string> } {
  const connectedNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  if (!focusedNodeId) {
    return { connectedNodeIds, connectedEdgeIds };
  }

  connectedNodeIds.add(focusedNodeId);

  // 1-hop upstream and downstream traversal
  edges.forEach((edge) => {
    if (edge.source === focusedNodeId || edge.target === focusedNodeId) {
      connectedEdgeIds.add(edge.id);
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }
  });

  // Second hop for richer context (e.g. Tier -> Framework -> Gate)
  const firstHopNodes = new Set(connectedNodeIds);
  edges.forEach((edge) => {
    if (firstHopNodes.has(edge.source) || firstHopNodes.has(edge.target)) {
      connectedEdgeIds.add(edge.id);
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }
  });

  return { connectedNodeIds, connectedEdgeIds };
}

/**
 * Filter nodes and edges by Tier hierarchy.
 */
export function getTierPipeline(
  tierId: string,
  nodes: Node[],
  edges: Edge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>([tierId]);
  const edgeIds = new Set<string>();

  // 1. Tier -> Frameworks and direct Tier -> Gates/Roles
  const frameworks = new Set<string>();
  const gates = new Set<string>();
  const roles = new Set<string>();

  edges.forEach((e) => {
    if (e.source === tierId) {
      const edgeType = e.data?.edgeType;
      const targetNode = nodes.find((n) => n.id === e.target);
      const targetType = targetNode?.type;

      if (edgeType === 'tier-framework' || targetType === 'framework' || (!edgeType && !targetType)) {
        nodeIds.add(e.target);
        frameworks.add(e.target);
        edgeIds.add(e.id);
      } else if (edgeType === 'tier-gate' || targetType === 'gate') {
        nodeIds.add(e.target);
        gates.add(e.target);
        edgeIds.add(e.id);
      } else if (targetType === 'role') {
        nodeIds.add(e.target);
        roles.add(e.target);
        edgeIds.add(e.id);
      }
    }
  });

  // 2. Frameworks -> Gates
  edges.forEach((e) => {
    if (frameworks.has(e.source) && (e.data?.edgeType === 'framework-gate' || !e.data?.edgeType)) {
      nodeIds.add(e.target);
      gates.add(e.target);
      edgeIds.add(e.id);
    }
  });

  // 3. Gates -> Roles
  edges.forEach((e) => {
    if (gates.has(e.source) && (e.data?.edgeType === 'gate-role' || !e.data?.edgeType)) {
      nodeIds.add(e.target);
      roles.add(e.target);
      edgeIds.add(e.id);
    }
  });

  // 4. Role delegations, closed over the tier.
  // Forward chains (scope-coordinator → manager → synthesizer) stay in the
  // tier. A delegation into an already-included role is drawn too
  // (coordinator → goal-checker) without adopting that source's other
  // targets, so a smaller tier does not inherit a foreign fan-out.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let grew = true;
  while (grew) {
    grew = false;
    edges.forEach((e) => {
      if (!isRoleDelegationEdge(e, nodeById)) return;
      const sourceIn = roles.has(e.source);
      const targetIn = roles.has(e.target);
      if (!sourceIn && !targetIn) return;
      nodeIds.add(e.source);
      nodeIds.add(e.target);
      edgeIds.add(e.id);
      if (sourceIn && !targetIn) {
        roles.add(e.target);
        grew = true;
      }
    });
  }

  return { nodeIds, edgeIds };
}

function isRoleDelegationEdge(edge: Edge, nodeById: Map<string, Node>): boolean {
  const edgeType = edge.data?.edgeType;
  if (edgeType === 'role-delegation') return true;
  if (edgeType) return false;
  return nodeById.get(edge.source)?.type === 'role' && nodeById.get(edge.target)?.type === 'role';
}

/** Cards whose centers are this close share a column. */
export const SAME_COLUMN_PX = 48;
/** How far a same-column curve bows into the gutter between columns. */
export const COLUMN_BULGE_PX = 40;

export interface ColumnBox {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
}

export function columnCenter(box: Pick<ColumnBox, 'x' | 'width'>): number {
  return box.x + box.width / 2;
}

export type EdgeFlowKind = 'forward' | 'backward' | 'same-column';

/**
 * Forward edges already sit in the gutter (source on the left, target on the
 * right). Backward edges leave the right-hand card's right side and wrap
 * off-canvas unless they are flipped onto the inner faces.
 */
export function edgeFlowKind(source: ColumnBox, target: ColumnBox): EdgeFlowKind {
  const delta = columnCenter(source) - columnCenter(target);
  if (Math.abs(delta) < SAME_COLUMN_PX) return 'same-column';
  return delta > 0 ? 'backward' : 'forward';
}

export function backwardGutterAnchors(source: ColumnBox, target: ColumnBox): {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
} {
  return {
    sourceX: source.x,
    sourceY: source.y + source.height / 2,
    targetX: target.x + target.width,
    targetY: target.y + target.height / 2,
  };
}

/** -1 bows left, +1 bows right, toward the nearest column of the same node type. */
export function bulgeDirection(
  node: Pick<ColumnBox, 'x' | 'width' | 'type'>,
  others: Array<Pick<ColumnBox, 'x' | 'width' | 'type'>>
): -1 | 1 {
  const mine = columnCenter(node);
  let bestSame = Infinity;
  let dirSame: -1 | 1 | 0 = 0;
  let bestAny = Infinity;
  let dirAny: -1 | 1 = 1;

  others.forEach((other) => {
    const delta = columnCenter(other) - mine;
    if (Math.abs(delta) < SAME_COLUMN_PX) return;
    const distance = Math.abs(delta);
    const dir: -1 | 1 = delta > 0 ? 1 : -1;
    if (distance < bestAny) {
      bestAny = distance;
      dirAny = dir;
    }
    if (node.type && other.type === node.type && distance < bestSame) {
      bestSame = distance;
      dirSame = dir;
    }
  });

  return dirSame === 0 ? dirAny : dirSame;
}

export const HARNESS_CARD_WIDTH = 288;
export const HARNESS_CARD_HEIGHT = 76;

export interface OccupiedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowViewportBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * First open slot inside the visible canvas that a new card can occupy
 * without covering an existing card. The right inset keeps the slot clear
 * of the inspector drawer. If the viewport is full, the slot drops below
 * the lowest card.
 */
/** A card stays on the canvas when it belongs to the tier, or was added locally and not yet linked. */
export function isKeptCanvasNode(
  nodeId: string,
  pipelineIds: Set<string> | null,
  localIds: ReadonlySet<string>
): boolean {
  if (!pipelineIds) return true;
  return pipelineIds.has(nodeId) || localIds.has(nodeId);
}

export function findOpenCardPosition(
  occupied: OccupiedBox[],
  viewport: FlowViewportBox,
  options?: { width?: number; height?: number; gap?: number; topInset?: number; rightInset?: number }
): { x: number; y: number } {
  const width = options?.width ?? HARNESS_CARD_WIDTH;
  const height = options?.height ?? HARNESS_CARD_HEIGHT;
  const gap = options?.gap ?? 24;
  const topInset = options?.topInset ?? 56;
  const rightInset = options?.rightInset ?? 0;

  const overlaps = (x: number, y: number) =>
    occupied.some(
      (box) =>
        x < box.x + box.width + gap &&
        x + width + gap > box.x &&
        y < box.y + box.height + gap &&
        y + height + gap > box.y
    );

  const left = viewport.x + 16;
  const top = viewport.y + topInset;
  const right = viewport.x + viewport.width - rightInset - width - 16;
  const bottom = viewport.y + viewport.height - height - 16;

  if (right >= left && bottom >= top) {
    const stepX = 48;
    const stepY = height + gap;
    for (let y = top; y <= bottom + 0.5; y += stepY) {
      for (let x = left; x <= right + 0.5; x += stepX) {
        if (!overlaps(x, y)) return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }

  let y = top;
  occupied.forEach((box) => {
    y = Math.max(y, box.y + box.height + gap);
  });
  const x = Number.isFinite(left) ? left : viewport.x + 16;
  let guard = 0;
  while (overlaps(x, y) && guard < 40) {
    y += height + gap;
    guard += 1;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function sameColumnEdgePath(source: ColumnBox, target: ColumnBox, direction: -1 | 1): string {
  const sourceFace = direction > 0 ? source.x + source.width : source.x;
  const targetFace = direction > 0 ? target.x + target.width : target.x;
  const y1 = source.y + source.height / 2;
  const y2 = target.y + target.height / 2;
  const controlX = (sourceFace + targetFace) / 2 + direction * COLUMN_BULGE_PX;
  return `M${sourceFace},${y1} C${controlX},${y1} ${controlX},${y2} ${targetFace},${y2}`;
}
