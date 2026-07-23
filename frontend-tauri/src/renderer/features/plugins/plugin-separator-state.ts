import type { FluxoraPluginOrderItem } from '../../../shared/fluxora-api';

export interface PluginSeparatorCreationPlan {
  selectedPluginOrderIds: string[];
  targetIndex: number;
}

export const planPluginSeparatorCreation = (
  items: readonly FluxoraPluginOrderItem[],
  selectedOrderIds: ReadonlySet<string>,
  contextOrderId: string
): PluginSeparatorCreationPlan | null => {
  const contextItem = items.find((item) => item.orderId === contextOrderId);
  if (!contextItem?.isPlugin) {
    return null;
  }

  const effectiveSelection = selectedOrderIds.has(contextOrderId)
    ? selectedOrderIds
    : new Set([contextOrderId]);
  const selectedPluginOrderIds = items
    .filter((item) => item.isPlugin && effectiveSelection.has(item.orderId))
    .map((item) => item.orderId);
  if (selectedPluginOrderIds.length === 0) {
    return null;
  }

  const selectedPluginOrderIdSet = new Set(selectedPluginOrderIds);
  const targetIndex = items.findIndex((item) => selectedPluginOrderIdSet.has(item.orderId));

  return targetIndex < 0
    ? null
    : {
        selectedPluginOrderIds,
        targetIndex
      };
};

export const findCreatedPluginSeparatorOrderId = (
  previousItems: readonly FluxoraPluginOrderItem[],
  createdItems: readonly FluxoraPluginOrderItem[]
): string | null => {
  const previousOrderIds = new Set(previousItems.map((item) => item.orderId));
  return (
    createdItems.find(
      (item) => item.isSeparator && !previousOrderIds.has(item.orderId)
    )?.orderId ?? null
  );
};

export const reorderSelectedPluginsIntoSeparator = (
  items: readonly FluxoraPluginOrderItem[],
  separatorOrderId: string,
  selectedOrderIds: ReadonlySet<string>
): FluxoraPluginOrderItem[] | null => {
  const separatorItem = items.find(
    (item) => item.orderId === separatorOrderId && item.isSeparator
  );
  if (!separatorItem) {
    return null;
  }

  const movableSelectedItems = items.filter(
    (item) => item.isPlugin && !item.isLocked && selectedOrderIds.has(item.orderId)
  );
  if (movableSelectedItems.length === 0) {
    return items.map((item, order) => ({ ...item, order }));
  }

  const movableOrderIds = new Set(movableSelectedItems.map((item) => item.orderId));
  const remainingItems = items.filter((item) => !movableOrderIds.has(item.orderId));
  const separatorIndex = remainingItems.findIndex(
    (item) => item.orderId === separatorOrderId
  );
  if (separatorIndex < 0) {
    return null;
  }

  let lastLockedPluginIndex = -1;
  remainingItems.forEach((item, index) => {
    if (item.isPlugin && item.isLocked) {
      lastLockedPluginIndex = index;
    }
  });
  const insertionIndex = Math.max(separatorIndex + 1, lastLockedPluginIndex + 1);
  const reordered = [
    ...remainingItems.slice(0, insertionIndex),
    ...movableSelectedItems,
    ...remainingItems.slice(insertionIndex)
  ];

  return reordered.map((item, order) => ({ ...item, order }));
};
