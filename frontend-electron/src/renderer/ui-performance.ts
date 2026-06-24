export interface VirtualWindowOptions {
  rowHeight: number;
  visibleRows: number;
  overscanRows: number;
}

export interface VirtualWindow<T> {
  startIndex: number;
  endIndex: number;
  items: T[];
  topSpacer: number;
  bottomSpacer: number;
}

export const createVirtualWindow = <T>(
  items: readonly T[],
  scrollTop: number,
  options: VirtualWindowOptions
): VirtualWindow<T> => {
  const rowHeight = Math.max(1, options.rowHeight);
  const visibleRows = Math.max(1, options.visibleRows);
  const overscanRows = Math.max(0, options.overscanRows);
  const rawStartIndex = Math.floor(Math.max(0, scrollTop) / rowHeight) - overscanRows;
  const maxStartIndex = Math.max(0, items.length - visibleRows);
  const startIndex = Math.min(Math.max(0, rawStartIndex), maxStartIndex);
  const endIndex = Math.min(items.length, startIndex + visibleRows + overscanRows * 2);

  return {
    startIndex,
    endIndex,
    items: items.slice(startIndex, endIndex),
    topSpacer: startIndex * rowHeight,
    bottomSpacer: Math.max(0, (items.length - endIndex) * rowHeight)
  };
};
