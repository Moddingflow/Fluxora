import type { FluxoraModOrderItem } from '../../../shared/fluxora-api';

export interface CreateModSeparatorAtEndOptions {
  createSeparator: (
    title: string,
    targetIndex: number
  ) => Promise<FluxoraModOrderItem[]>;
  items: readonly FluxoraModOrderItem[];
  title: string;
}

export interface CreateModSeparatorAtEndResult {
  items: FluxoraModOrderItem[];
  separatorOrderId: string;
}

const appendOrderTargetIndex = -1;

export const createModSeparatorAtEnd = async ({
  createSeparator,
  items,
  title
}: CreateModSeparatorAtEndOptions): Promise<CreateModSeparatorAtEndResult> => {
  const previousOrderIds = new Set(items.map((item) => item.orderId));
  const createdItems = await createSeparator(title, appendOrderTargetIndex);
  const createdSeparator = createdItems.find(
    (item) => item.isSeparator && !previousOrderIds.has(item.orderId)
  );

  if (!createdSeparator) {
    throw new Error('The created mod separator was not returned by the native core.');
  }
  if (createdItems.at(-1)?.orderId !== createdSeparator.orderId) {
    throw new Error('The native core did not create the mod separator at the end of the order.');
  }

  return {
    items: createdItems,
    separatorOrderId: createdSeparator.orderId
  };
};
