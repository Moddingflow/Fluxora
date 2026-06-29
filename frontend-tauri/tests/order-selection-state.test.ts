import { describe, expect, it } from 'vitest';

import {
  emptyOrderSelectionState,
  selectAllOrderItems,
  selectOrderItem,
  selectOrderItemRange,
  toggleOrderItemSelection
} from '../src/renderer/order-selection-state';

const orderIds = ['sep_visuals', 'mod_skyui', 'mod_smoothcam', 'sep_audio', 'mod_music'];
const longOrderIds = [
  'mod_1',
  'mod_2',
  'mod_3',
  'mod_4',
  'mod_5',
  'mod_6',
  'mod_7',
  'mod_8',
  'mod_9',
  'mod_10',
  'mod_11'
];

const selectedIds = (
  state: { selectedOrderIds: ReadonlySet<string> },
  ids: readonly string[] = orderIds
): string[] => ids.filter((orderId) => state.selectedOrderIds.has(orderId));

describe('order selection state', () => {
  it('keeps ctrl-skipped rows out of the next shift range', () => {
    let state = selectOrderItem(emptyOrderSelectionState(), 'sep_visuals');

    state = selectOrderItemRange(state, 'mod_smoothcam', orderIds, { additive: false });
    expect(selectedIds(state)).toEqual(['sep_visuals', 'mod_skyui', 'mod_smoothcam']);

    state = toggleOrderItemSelection(state, 'mod_skyui', orderIds);
    expect(selectedIds(state)).toEqual(['sep_visuals', 'mod_smoothcam']);

    state = selectOrderItemRange(state, 'mod_music', orderIds, { additive: false });
    expect(selectedIds(state)).toEqual([
      'sep_visuals',
      'mod_smoothcam',
      'sep_audio',
      'mod_music'
    ]);
  });

  it('keeps the first shift range when extending a second range from a ctrl-added row', () => {
    let state = selectOrderItem(emptyOrderSelectionState(), 'mod_1');

    state = selectOrderItemRange(state, 'mod_5', longOrderIds, { additive: false });
    expect(selectedIds(state, longOrderIds)).toEqual([
      'mod_1',
      'mod_2',
      'mod_3',
      'mod_4',
      'mod_5'
    ]);

    state = toggleOrderItemSelection(state, 'mod_7', longOrderIds);
    expect(selectedIds(state, longOrderIds)).toEqual([
      'mod_1',
      'mod_2',
      'mod_3',
      'mod_4',
      'mod_5',
      'mod_7'
    ]);

    state = selectOrderItemRange(state, 'mod_11', longOrderIds, { additive: false });
    expect(selectedIds(state, longOrderIds)).toEqual([
      'mod_1',
      'mod_2',
      'mod_3',
      'mod_4',
      'mod_5',
      'mod_7',
      'mod_8',
      'mod_9',
      'mod_10',
      'mod_11'
    ]);

    state = selectOrderItemRange(state, 'mod_9', longOrderIds, { additive: false });
    expect(selectedIds(state, longOrderIds)).toEqual([
      'mod_1',
      'mod_2',
      'mod_3',
      'mod_4',
      'mod_5',
      'mod_7',
      'mod_8',
      'mod_9'
    ]);
  });

  it('selects every visible order row when selecting all', () => {
    let state = selectOrderItem(emptyOrderSelectionState(), 'mod_smoothcam');

    state = selectAllOrderItems(state, orderIds);

    expect(selectedIds(state)).toEqual(orderIds);
    expect(state.selectedOrderId).toBe('mod_smoothcam');
  });
});
