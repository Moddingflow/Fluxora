import { describe, expect, it } from 'vitest';

import { centeredModRevealScrollTop } from '../src/renderer/features/mods/use-post-install-mod-reveal';

describe('post-install mod reveal', () => {
  it('centers a virtualized row and clamps the first and last rows to the list bounds', () => {
    const geometry = {
      itemCount: 100,
      rowHeight: 48,
      viewportHeight: 480
    };

    expect(centeredModRevealScrollTop({ ...geometry, itemIndex: 0 })).toBe(0);
    expect(centeredModRevealScrollTop({ ...geometry, itemIndex: 50 })).toBe(2184);
    expect(centeredModRevealScrollTop({ ...geometry, itemIndex: 99 })).toBe(4320);
  });
});
