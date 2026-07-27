import { describe, expect, it, vi } from 'vitest';

import {
  deleteSeparatorSelection,
  separatorDeletionOrderIds
} from '../src/renderer/order-separator-deletion-service';

const items = [
  { orderId: 'sep_visuals', isSeparator: true },
  { orderId: 'mod_skyui', isSeparator: false },
  { orderId: 'sep_audio', isSeparator: true },
  { orderId: 'plugin_weather', isSeparator: false },
  { orderId: 'sep_gameplay', isSeparator: true }
];

describe('order separator deletion service', () => {
  it('uses every selected separator when the context separator belongs to the selection', () => {
    expect(
      separatorDeletionOrderIds(
        items,
        new Set(['sep_gameplay', 'mod_skyui', 'sep_visuals', 'sep_audio']),
        'sep_audio'
      )
    ).toEqual(['sep_visuals', 'sep_audio', 'sep_gameplay']);
  });

  it('uses only the context separator when it does not belong to the selection', () => {
    expect(
      separatorDeletionOrderIds(items, new Set(['sep_visuals', 'sep_audio']), 'sep_gameplay')
    ).toEqual(['sep_gameplay']);
  });

  it('does not create a separator deletion plan for an ordinary row', () => {
    expect(
      separatorDeletionOrderIds(items, new Set(['sep_visuals', 'mod_skyui']), 'mod_skyui')
    ).toEqual([]);
  });

  it('deletes the planned separators in visible order and returns the final native snapshot', async () => {
    const deleteSeparator = vi.fn(async (orderId: string) => [`remaining-after-${orderId}`]);

    await expect(
      deleteSeparatorSelection(['sep_visuals', 'sep_audio', 'sep_audio'], deleteSeparator)
    ).resolves.toEqual(['remaining-after-sep_audio']);
    expect(deleteSeparator.mock.calls).toEqual([['sep_visuals'], ['sep_audio']]);
  });
});
