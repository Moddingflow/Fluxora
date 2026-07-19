export type OrderDropPlacement = 'before' | 'after';

export interface SeparatorOrderItem {
  orderId: string;
  order: number;
  isSeparator: boolean;
}

interface OrderTargetOptions {
  collapsedSeparatorOrderIds?: ReadonlySet<string>;
  separatorDropTargets?: 'all' | 'separators';
  separatorMoveMode?: 'block' | 'single';
  treatAfterSeparatorTargetAsBlock?: boolean;
}

interface OrderReorderOptions {
  separatorMoveMode?: 'block' | 'single';
}

export interface OrderItemMove {
  orderId: string;
  targetIndex: number;
}

export const separatorChildCount = <T extends SeparatorOrderItem>(
  items: T[],
  separatorOrderId: string
): number => {
  const separatorIndex = items.findIndex((item) => item.orderId === separatorOrderId);
  if (separatorIndex < 0 || !items[separatorIndex]?.isSeparator) {
    return 0;
  }

  let count = 0;

  for (let index = separatorIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item.isSeparator) {
      break;
    }

    count += 1;
  }

  return count;
};

export const orderItemNestedUnderSeparator = <T extends SeparatorOrderItem>(
  items: T[],
  orderId: string
): boolean => {
  const index = items.findIndex((item) => item.orderId === orderId);
  if (index <= 0 || items[index]?.isSeparator) {
    return false;
  }

  return closestSeparatorIndexBefore(items, index) !== null;
};

export const pruneCollapsedSeparators = <T extends SeparatorOrderItem>(
  items: T[],
  collapsedSeparatorOrderIds: ReadonlySet<string>
): Set<string> => {
  const separators = new Set(
    items.filter((item) => item.isSeparator).map((item) => item.orderId)
  );
  const nextCollapsed = new Set<string>();

  collapsedSeparatorOrderIds.forEach((orderId) => {
    if (separators.has(orderId)) {
      nextCollapsed.add(orderId);
    }
  });

  return nextCollapsed;
};

export const visibleOrderItems = <T extends SeparatorOrderItem>(
  items: T[],
  collapsedSeparatorOrderIds: ReadonlySet<string>
): T[] => {
  const visible: T[] = [];
  let hiddenByCollapsedSeparator = false;

  for (const item of items) {
    if (item.isSeparator) {
      visible.push(item);
      hiddenByCollapsedSeparator = collapsedSeparatorOrderIds.has(item.orderId);
      continue;
    }

    if (!hiddenByCollapsedSeparator) {
      visible.push(item);
    }
  }

  return visible;
};

export const isOrderItemHiddenByCollapsedSeparator = <T extends SeparatorOrderItem>(
  items: T[],
  orderId: string,
  collapsedSeparatorOrderIds: ReadonlySet<string>
): boolean => {
  const index = items.findIndex((item) => item.orderId === orderId);
  if (index <= 0 || items[index]?.isSeparator) {
    return false;
  }

  const separatorIndex = closestSeparatorIndexBefore(items, index);
  return separatorIndex !== null && collapsedSeparatorOrderIds.has(items[separatorIndex].orderId);
};

export const parentSeparatorForOrderItem = <T extends SeparatorOrderItem>(
  items: T[],
  orderId: string
): T | null => {
  const index = items.findIndex((item) => item.orderId === orderId);
  if (index <= 0 || items[index]?.isSeparator) {
    return null;
  }

  const separatorIndex = closestSeparatorIndexBefore(items, index);
  return separatorIndex === null ? null : items[separatorIndex] ?? null;
};

export const orderMoveBlockEnd = <T extends SeparatorOrderItem>(
  items: T[],
  sourceIndex: number
): number => {
  const source = items[sourceIndex];
  if (!source?.isSeparator) {
    return sourceIndex + 1;
  }

  const nextSeparatorIndex = items.findIndex(
    (item, index) => index > sourceIndex && item.isSeparator
  );
  return nextSeparatorIndex >= 0 ? nextSeparatorIndex : items.length;
};

export const reorderOrderItems = <T extends SeparatorOrderItem>(
  items: T[],
  orderId: string,
  targetIndex: number,
  options: OrderReorderOptions = {}
): T[] | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  if (sourceIndex < 0 || items.length <= 1) {
    return null;
  }

  const blockEnd = orderMoveEnd(items, sourceIndex, options);
  const blockLength = blockEnd - sourceIndex;
  if (blockLength <= 1) {
    const clampedTarget = clampIndex(targetIndex, 0, items.length - 1);
    if (sourceIndex === clampedTarget) {
      return null;
    }

    const nextItems = [...items];
    const [moving] = nextItems.splice(sourceIndex, 1);
    nextItems.splice(clampedTarget, 0, moving);
    return withSequentialOrder(nextItems);
  }

  if (targetIndex >= sourceIndex && targetIndex < blockEnd) {
    return null;
  }

  const maxDestination = items.length - blockLength;
  const desiredDestination =
    targetIndex > sourceIndex ? targetIndex + 1 - blockLength : targetIndex;
  const destination = clampIndex(desiredDestination, 0, maxDestination);
  if (destination === sourceIndex) {
    return null;
  }

  const nextItems = [...items];
  const moving = nextItems.splice(sourceIndex, blockLength);
  nextItems.splice(destination, 0, ...moving);
  return withSequentialOrder(nextItems);
};

export const reorderOrderItemSelection = <T extends SeparatorOrderItem>(
  items: T[],
  sourceOrderId: string,
  selectedOrderIds: ReadonlySet<string>,
  targetOrderId: string,
  placement: OrderDropPlacement = 'after',
  options: OrderTargetOptions = {}
): T[] | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === sourceOrderId);
  const targetIndex = items.findIndex((item) => item.orderId === targetOrderId);
  const source = items[sourceIndex];
  const target = items[targetIndex];
  if (sourceIndex < 0 || targetIndex < 0 || !source || !target) {
    return null;
  }

  const movingOrderIds = selectedOrderIds.has(sourceOrderId)
    ? new Set(items.filter((item) => selectedOrderIds.has(item.orderId)).map((item) => item.orderId))
    : new Set([sourceOrderId]);
  if (movingOrderIds.size === 0 || movingOrderIds.has(targetOrderId)) {
    return null;
  }

  if (
    source.isSeparator &&
    options.separatorDropTargets === 'separators' &&
    !target.isSeparator
  ) {
    return null;
  }

  const slotIndex = dropSlotIndex(items, targetIndex, placement, options);
  const moving = items.filter((item) => movingOrderIds.has(item.orderId));
  const remaining = items.filter((item) => !movingOrderIds.has(item.orderId));
  const destination = items
    .slice(0, slotIndex)
    .filter((item) => !movingOrderIds.has(item.orderId)).length;
  const nextItems = [...remaining];
  nextItems.splice(destination, 0, ...moving);

  if (nextItems.every((item, index) => item.orderId === items[index]?.orderId)) {
    return null;
  }

  return withSequentialOrder(nextItems);
};

export const orderItemMovePlan = <T extends SeparatorOrderItem>(
  items: T[],
  desiredItems: T[],
  movingOrderIds: ReadonlySet<string>,
  applyMove: (currentItems: T[], orderId: string, targetIndex: number) => T[] | null
): OrderItemMove[] | null => {
  if (
    items.length !== desiredItems.length ||
    items.some((item) => !desiredItems.some((candidate) => candidate.orderId === item.orderId))
  ) {
    return null;
  }

  const orderedMovingIds = desiredItems
    .filter((item) => movingOrderIds.has(item.orderId))
    .map((item) => item.orderId);
  if (orderedMovingIds.length === 0) {
    return items.every((item, index) => item.orderId === desiredItems[index]?.orderId) ? [] : null;
  }

  const currentFirstIndex = items.findIndex((item) => movingOrderIds.has(item.orderId));
  const desiredFirstIndex = desiredItems.findIndex((item) => movingOrderIds.has(item.orderId));
  const moveOrderIds =
    desiredFirstIndex > currentFirstIndex ? [...orderedMovingIds].reverse() : orderedMovingIds;
  const moves: OrderItemMove[] = [];
  let currentItems = items;

  for (const orderId of moveOrderIds) {
    const sourceIndex = currentItems.findIndex((item) => item.orderId === orderId);
    const targetIndex = desiredItems.findIndex((item) => item.orderId === orderId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return null;
    }
    if (sourceIndex === targetIndex) {
      continue;
    }

    const nextItems = applyMove(currentItems, orderId, targetIndex);
    if (!nextItems) {
      return null;
    }
    currentItems = nextItems;
    moves.push({ orderId, targetIndex });
  }

  return currentItems.every(
    (item, index) => item.orderId === desiredItems[index]?.orderId
  )
    ? moves
    : null;
};

export const targetIndexForOrderDrop = <T extends SeparatorOrderItem>(
  items: T[],
  sourceOrderId: string,
  targetOrderId: string,
  placement: OrderDropPlacement = 'after',
  options: OrderTargetOptions = {}
): number | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === sourceOrderId);
  const targetIndex = items.findIndex((item) => item.orderId === targetOrderId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return null;
  }

  const source = items[sourceIndex];
  const target = items[targetIndex];
  if (!source || !target) {
    return null;
  }

  if (
    source.isSeparator &&
    options.separatorDropTargets === 'separators' &&
    !target.isSeparator
  ) {
    return null;
  }

  const blockEnd = orderMoveEnd(items, sourceIndex, options);
  const slotIndex = dropSlotIndex(items, targetIndex, placement, options);

  if (slotIndex >= sourceIndex && slotIndex <= blockEnd) {
    return null;
  }

  return slotIndex > sourceIndex ? slotIndex - 1 : slotIndex;
};

export const targetIndexForOrderMove = <T extends SeparatorOrderItem>(
  items: T[],
  orderId: string,
  direction: -1 | 1,
  options: OrderTargetOptions = {}
): number | null => {
  const sourceIndex = items.findIndex((item) => item.orderId === orderId);
  const source = items[sourceIndex];
  if (sourceIndex < 0 || !source) {
    return null;
  }

  if (source.isSeparator) {
    return targetIndexForSeparatorMove(items, sourceIndex, direction, options);
  }

  const visibleItems = options.collapsedSeparatorOrderIds
    ? visibleOrderItems(items, options.collapsedSeparatorOrderIds)
    : items;
  const visibleSourceIndex = visibleItems.findIndex((item) => item.orderId === orderId);
  if (visibleSourceIndex < 0) {
    return null;
  }

  const target = visibleItems[visibleSourceIndex + direction];
  if (!target) {
    return null;
  }

  return targetIndexForOrderDrop(
    items,
    orderId,
    target.orderId,
    direction < 0 ? 'before' : 'after',
    options
  );
};

const targetIndexForSeparatorMove = <T extends SeparatorOrderItem>(
  items: T[],
  sourceIndex: number,
  direction: -1 | 1,
  options: OrderTargetOptions
): number | null => {
  if (direction < 0) {
    const previousIndex = sourceIndex - 1;
    if (previousIndex < 0) {
      return null;
    }

    const previousSeparatorIndex = closestSeparatorIndexBefore(items, previousIndex);
    return previousSeparatorIndex ?? (options.separatorDropTargets === 'separators' ? null : previousIndex);
  }

  const sourceBlockEnd = orderMoveBlockEnd(items, sourceIndex);
  if (sourceBlockEnd >= items.length) {
    return null;
  }

  const nextBlockEnd = orderMoveBlockEnd(items, sourceBlockEnd);
  return nextBlockEnd - 1;
};

const orderMoveEnd = <T extends SeparatorOrderItem>(
  items: T[],
  sourceIndex: number,
  options: OrderReorderOptions
): number => {
  const source = items[sourceIndex];
  if (source?.isSeparator && options.separatorMoveMode === 'single') {
    return sourceIndex + 1;
  }

  return orderMoveBlockEnd(items, sourceIndex);
};

const dropSlotIndex = <T extends SeparatorOrderItem>(
  items: T[],
  targetIndex: number,
  placement: OrderDropPlacement,
  options: OrderTargetOptions
): number => {
  if (placement === 'before') {
    return targetIndex;
  }

  const target = items[targetIndex];
  if (
    target?.isSeparator &&
    (options.treatAfterSeparatorTargetAsBlock ||
      options.collapsedSeparatorOrderIds?.has(target.orderId))
  ) {
    return orderMoveBlockEnd(items, targetIndex);
  }

  return targetIndex + 1;
};

const closestSeparatorIndexBefore = <T extends SeparatorOrderItem>(
  items: T[],
  fromIndex: number
): number | null => {
  for (let cursor = fromIndex; cursor >= 0; cursor -= 1) {
    if (items[cursor]?.isSeparator) {
      return cursor;
    }
  }

  return null;
};

const clampIndex = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const withSequentialOrder = <T extends SeparatorOrderItem>(items: T[]): T[] =>
  items.map((item, order) => (item.order === order ? item : { ...item, order }));
