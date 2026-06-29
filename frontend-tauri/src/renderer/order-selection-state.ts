export interface OrderSelectionState {
  selectedOrderId: string | null;
  selectedOrderIds: ReadonlySet<string>;
  selectionAnchorOrderId: string | null;
  rangeExcludedOrderIds: ReadonlySet<string>;
  rangeBaseOrderIds: ReadonlySet<string>;
}

interface RangeSelectionOptions {
  additive: boolean;
}

export const emptyOrderSelectionState = (): OrderSelectionState => ({
  selectedOrderId: null,
  selectedOrderIds: new Set<string>(),
  selectionAnchorOrderId: null,
  rangeExcludedOrderIds: new Set<string>(),
  rangeBaseOrderIds: new Set<string>()
});

export const selectOrderItem = (
  state: OrderSelectionState,
  orderId: string | null
): OrderSelectionState => {
  if (!orderId) {
    return emptyOrderSelectionState();
  }

  return {
    ...state,
    selectedOrderId: orderId,
    selectedOrderIds: new Set([orderId]),
    selectionAnchorOrderId: orderId,
    rangeExcludedOrderIds: new Set<string>(),
    rangeBaseOrderIds: new Set<string>()
  };
};

export const toggleOrderItemSelection = (
  state: OrderSelectionState,
  orderId: string,
  orderedOrderIds: readonly string[]
): OrderSelectionState => {
  const selectedOrderIds = new Set(state.selectedOrderIds);
  const rangeExcludedOrderIds = new Set(state.rangeExcludedOrderIds);
  const wasSelected = selectedOrderIds.has(orderId);

  if (wasSelected) {
    selectedOrderIds.delete(orderId);
    rangeExcludedOrderIds.add(orderId);
  } else {
    selectedOrderIds.add(orderId);
    rangeExcludedOrderIds.delete(orderId);
  }

  const selectedOrderId = selectedOrderIds.has(orderId)
    ? orderId
    : firstSelectedOrderId(orderedOrderIds, selectedOrderIds);
  const rangeBaseOrderIds = wasSelected
    ? pruneOrderIdSet(state.rangeBaseOrderIds, orderedOrderIds)
    : pruneOrderIdSet(selectedOrderIds, orderedOrderIds);

  return {
    ...state,
    selectedOrderId,
    selectedOrderIds,
    selectionAnchorOrderId: wasSelected ? state.selectionAnchorOrderId ?? orderId : orderId,
    rangeExcludedOrderIds: pruneOrderIdSet(rangeExcludedOrderIds, orderedOrderIds),
    rangeBaseOrderIds
  };
};

export const selectOrderItemRange = (
  state: OrderSelectionState,
  orderId: string,
  orderedOrderIds: readonly string[],
  options: RangeSelectionOptions
): OrderSelectionState => {
  const anchorOrderId = anchorForRange(state, orderId, orderedOrderIds);
  const rangeOrderIds = orderIdRange(anchorOrderId, orderId, orderedOrderIds);
  const rangeExcludedOrderIds = new Set(state.rangeExcludedOrderIds);
  rangeExcludedOrderIds.delete(orderId);
  const rangeBaseOrderIds = pruneOrderIdSet(
    options.additive ? state.selectedOrderIds : state.rangeBaseOrderIds,
    orderedOrderIds
  );

  const selectedOrderIds = options.additive
    ? new Set(state.selectedOrderIds)
    : new Set(rangeBaseOrderIds);

  rangeOrderIds.forEach((rangeOrderId) => {
    if (!rangeExcludedOrderIds.has(rangeOrderId)) {
      selectedOrderIds.add(rangeOrderId);
    }
  });

  return {
    ...state,
    selectedOrderId: orderId,
    selectedOrderIds,
    selectionAnchorOrderId: anchorOrderId,
    rangeExcludedOrderIds: pruneOrderIdSet(rangeExcludedOrderIds, orderedOrderIds),
    rangeBaseOrderIds
  };
};

export const selectAllOrderItems = (
  state: OrderSelectionState,
  orderedOrderIds: readonly string[]
): OrderSelectionState => {
  const selectedOrderIds = new Set(orderedOrderIds);
  const selectedOrderId =
    state.selectedOrderId && selectedOrderIds.has(state.selectedOrderId)
      ? state.selectedOrderId
      : orderedOrderIds[0] ?? null;

  return {
    ...state,
    selectedOrderId,
    selectedOrderIds,
    selectionAnchorOrderId: selectedOrderId,
    rangeExcludedOrderIds: new Set<string>(),
    rangeBaseOrderIds: new Set<string>()
  };
};

export const pruneOrderSelection = (
  state: OrderSelectionState,
  orderedOrderIds: readonly string[],
  fallbackOrderId: string | null
): OrderSelectionState => {
  const selectedOrderIds = pruneOrderIdSet(state.selectedOrderIds, orderedOrderIds);
  const selectionAnchorOrderId =
    state.selectionAnchorOrderId && orderedOrderIds.includes(state.selectionAnchorOrderId)
      ? state.selectionAnchorOrderId
      : fallbackOrderId;
  const selectedOrderId =
    state.selectedOrderId && selectedOrderIds.has(state.selectedOrderId)
      ? state.selectedOrderId
      : firstSelectedOrderId(orderedOrderIds, selectedOrderIds) ?? fallbackOrderId;

  if (selectedOrderIds.size === 0 && selectedOrderId) {
    selectedOrderIds.add(selectedOrderId);
  }

  return {
    ...state,
    selectedOrderId,
    selectedOrderIds,
    selectionAnchorOrderId,
    rangeExcludedOrderIds: pruneOrderIdSet(state.rangeExcludedOrderIds, orderedOrderIds),
    rangeBaseOrderIds: pruneOrderIdSet(state.rangeBaseOrderIds, orderedOrderIds)
  };
};

const anchorForRange = (
  state: OrderSelectionState,
  fallbackOrderId: string,
  orderedOrderIds: readonly string[]
): string => {
  if (state.selectionAnchorOrderId && orderedOrderIds.includes(state.selectionAnchorOrderId)) {
    return state.selectionAnchorOrderId;
  }

  if (state.selectedOrderId && orderedOrderIds.includes(state.selectedOrderId)) {
    return state.selectedOrderId;
  }

  return fallbackOrderId;
};

const orderIdRange = (
  anchorOrderId: string,
  targetOrderId: string,
  orderedOrderIds: readonly string[]
): string[] => {
  const anchorIndex = orderedOrderIds.indexOf(anchorOrderId);
  const targetIndex = orderedOrderIds.indexOf(targetOrderId);

  if (anchorIndex < 0 || targetIndex < 0) {
    return [targetOrderId];
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedOrderIds.slice(start, end + 1);
};

const firstSelectedOrderId = (
  orderedOrderIds: readonly string[],
  selectedOrderIds: ReadonlySet<string>
): string | null => orderedOrderIds.find((orderId) => selectedOrderIds.has(orderId)) ?? null;

const pruneOrderIdSet = (
  orderIds: ReadonlySet<string>,
  orderedOrderIds: readonly string[]
): Set<string> => {
  const allowedOrderIds = new Set(orderedOrderIds);
  const pruned = new Set<string>();

  orderIds.forEach((orderId) => {
    if (allowedOrderIds.has(orderId)) {
      pruned.add(orderId);
    }
  });

  return pruned;
};
