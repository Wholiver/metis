import { BaseEdge, getBezierPath, Position, useInternalNode, useStore, type EdgeProps } from '@xyflow/react';
import {
  backwardGutterAnchors,
  bulgeDirection,
  edgeFlowKind,
  sameColumnEdgePath,
  type ColumnBox,
} from '../layout';

interface FlowNodeBox {
  id?: string;
  type?: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  measured?: { width?: number | null; height?: number | null };
  internals?: { positionAbsolute?: { x: number; y: number } };
}

function boxOf(node: FlowNodeBox): ColumnBox {
  const absolute = node.internals?.positionAbsolute ?? node.position;
  return {
    x: absolute.x,
    y: absolute.y,
    width: node.measured?.width ?? node.width ?? 288,
    height: node.measured?.height ?? node.height ?? 76,
    type: node.type,
  };
}

/**
 * Draws every harness edge the way framework → gate already looks:
 * a calm bezier that stays in the gutter between two columns.
 * Edges that point back toward a left-hand column, and edges that stay
 * inside one column, are anchored on the inner faces so they do not wrap
 * around the outside of the cards.
 */
export function GutterEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  interactionWidth,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const nodes = useStore((state) => state.nodes);

  if (!sourceNode || !targetNode) return null;

  const sourceBox = boxOf(sourceNode);
  const targetBox = boxOf(targetNode);
  const kind = edgeFlowKind(sourceBox, targetBox);

  let path: string;
  if (kind === 'forward') {
    [path] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  } else if (kind === 'backward') {
    const anchors = backwardGutterAnchors(sourceBox, targetBox);
    [path] = getBezierPath({
      sourceX: anchors.sourceX,
      sourceY: anchors.sourceY,
      sourcePosition: Position.Left,
      targetX: anchors.targetX,
      targetY: anchors.targetY,
      targetPosition: Position.Right,
    });
  } else {
    const direction = bulgeDirection(
      sourceBox,
      nodes.filter((node) => node.id !== source).map((node) => boxOf(node))
    );
    path = sameColumnEdgePath(sourceBox, targetBox, direction);
  }

  return <BaseEdge id={id} path={path} style={style} interactionWidth={interactionWidth ?? 16} />;
}
