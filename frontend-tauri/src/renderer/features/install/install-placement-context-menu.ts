export interface InstallPlacementContextMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface ContextMenuViewport {
  width: number;
  height: number;
}

const menuWidth = 224;
const menuItemHeight = 30;
const menuPaddingY = 12;
const viewportPadding = 8;

export const installPlacementContextMenuPositionFromPoint = (
  preferredLeft: number,
  preferredTop: number,
  itemCount: number,
  viewport: ContextMenuViewport
): InstallPlacementContextMenuPosition => {
  const estimatedHeight = menuPaddingY + Math.max(1, itemCount) * menuItemHeight;
  const maxLeft = Math.max(viewportPadding, viewport.width - menuWidth - viewportPadding);
  const maxTop = Math.max(viewportPadding, viewport.height - estimatedHeight - viewportPadding);
  const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));
  const top = Math.max(viewportPadding, Math.min(preferredTop, maxTop));

  return {
    left,
    top,
    maxHeight: Math.max(
      64,
      Math.min(estimatedHeight, viewport.height - top - viewportPadding)
    )
  };
};

export const installPlacementContextMenuPositionFromAnchor = (
  anchor: Pick<DOMRect, 'right' | 'top'>,
  itemCount: number,
  viewport: ContextMenuViewport
): InstallPlacementContextMenuPosition =>
  installPlacementContextMenuPositionFromPoint(
    anchor.right - menuWidth,
    anchor.top + viewportPadding,
    itemCount,
    viewport
  );
