import type { FluxoraPluginOrderItem } from '../../../shared/fluxora-api';
import { pluginOrderItemMovePlan } from '../../plugin-workspace-state';
import {
  findCreatedPluginSeparatorOrderId,
  planPluginSeparatorCreation,
  reorderSelectedPluginsIntoSeparator
} from './plugin-separator-state';

export interface PluginSeparatorMutationApi {
  createSeparator: (
    title: string,
    targetIndex: number
  ) => Promise<FluxoraPluginOrderItem[]>;
  deleteSeparator: (orderId: string) => Promise<FluxoraPluginOrderItem[]>;
  move: (
    orderId: string,
    targetIndex: number
  ) => Promise<FluxoraPluginOrderItem[]>;
}

export interface CreatePluginSeparatorForSelectionOptions {
  api: PluginSeparatorMutationApi;
  contextOrderId: string;
  items: FluxoraPluginOrderItem[];
  selectedOrderIds: ReadonlySet<string>;
  title: string;
}

export interface CreatePluginSeparatorForSelectionResult {
  items: FluxoraPluginOrderItem[];
  separatorOrderId: string;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createPluginSeparatorForSelection = async ({
  api,
  contextOrderId,
  items,
  selectedOrderIds,
  title
}: CreatePluginSeparatorForSelectionOptions): Promise<CreatePluginSeparatorForSelectionResult> => {
  const plan = planPluginSeparatorCreation(items, selectedOrderIds, contextOrderId);
  if (!plan) {
    throw new Error('Select at least one plugin before creating a separator.');
  }

  const createdItems = await api.createSeparator(title, plan.targetIndex);
  const separatorOrderId = findCreatedPluginSeparatorOrderId(items, createdItems);
  if (!separatorOrderId) {
    throw new Error('The created plugin separator was not returned by the native core.');
  }

  const selectedPluginOrderIds = new Set(plan.selectedPluginOrderIds);
  const movableOrderIds = new Set(
    createdItems
      .filter(
        (item) =>
          item.isPlugin &&
          !item.isLocked &&
          selectedPluginOrderIds.has(item.orderId)
      )
      .map((item) => item.orderId)
  );

  try {
    const desiredItems = reorderSelectedPluginsIntoSeparator(
      createdItems,
      separatorOrderId,
      selectedPluginOrderIds
    );
    if (!desiredItems) {
      throw new Error('The selected plugins could not be placed in the new separator.');
    }

    const movePlan = pluginOrderItemMovePlan(
      createdItems,
      desiredItems,
      movableOrderIds
    );
    if (!movePlan) {
      throw new Error('The selected plugin move plan is not valid.');
    }

    let confirmedItems = createdItems;
    for (const move of movePlan) {
      confirmedItems = await api.move(move.orderId, move.targetIndex);
    }

    return {
      items: confirmedItems,
      separatorOrderId
    };
  } catch (error) {
    try {
      let rollbackItems = await api.deleteSeparator(separatorOrderId);
      const rollbackPlan = pluginOrderItemMovePlan(
        rollbackItems,
        items,
        movableOrderIds
      );
      if (!rollbackPlan) {
        throw new Error('The prior plugin order could not be reconstructed.');
      }

      for (const move of rollbackPlan) {
        rollbackItems = await api.move(move.orderId, move.targetIndex);
      }
    } catch (rollbackError) {
      throw new Error(
        `${errorText(error)} Automatic rollback also failed: ${errorText(rollbackError)}`
      );
    }

    throw error;
  }
};
