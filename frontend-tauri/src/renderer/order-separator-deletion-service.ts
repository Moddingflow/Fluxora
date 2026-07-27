export interface SeparatorDeletionOrderItem {
  orderId: string;
  isSeparator: boolean;
}

export const separatorDeletionOrderIds = (
  items: readonly SeparatorDeletionOrderItem[],
  selectedOrderIds: ReadonlySet<string>,
  contextOrderId: string
): string[] => {
  const contextItem = items.find((item) => item.orderId === contextOrderId);
  if (!contextItem?.isSeparator) {
    return [];
  }

  const usesSelection = selectedOrderIds.has(contextOrderId);
  return items
    .filter(
      (item) =>
        item.isSeparator &&
        (usesSelection ? selectedOrderIds.has(item.orderId) : item.orderId === contextOrderId)
    )
    .map((item) => item.orderId);
};

export const deleteSeparatorSelection = async <Snapshot>(
  orderIds: readonly string[],
  deleteSeparator: (orderId: string) => Promise<Snapshot>
): Promise<Snapshot | undefined> => {
  let latestSnapshot: Snapshot | undefined;
  const uniqueOrderIds = new Set(orderIds);

  for (const orderId of uniqueOrderIds) {
    latestSnapshot = await deleteSeparator(orderId);
  }

  return latestSnapshot;
};
