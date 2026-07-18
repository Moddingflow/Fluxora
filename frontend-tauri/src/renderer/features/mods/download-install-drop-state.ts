import type { PendingInstallDropPlacement } from './pending-install-orchestrator-state';

interface DropTargetRect {
  top: number;
  height: number;
}

const separatorInsertionEdge = (height: number): number =>
  Math.min(8, Math.max(0, height) / 4);

export const downloadInstallDropPlacementFromPointer = (
  rect: DropTargetRect,
  pointerY: number,
  isSeparator: boolean
): PendingInstallDropPlacement => {
  const midpoint = rect.top + rect.height / 2;
  if (!isSeparator) {
    return pointerY < midpoint ? 'before' : 'after';
  }

  const edge = separatorInsertionEdge(rect.height);
  if (pointerY < rect.top + edge) {
    return 'before';
  }
  if (pointerY > rect.top + rect.height - edge) {
    return 'after';
  }
  return 'inside';
};
