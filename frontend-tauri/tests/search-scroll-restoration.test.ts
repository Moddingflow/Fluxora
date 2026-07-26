import { describe, expect, it } from 'vitest';

import { createSearchScrollRestoration } from '../src/renderer/services/search-scroll-restoration';

describe('search scroll restoration', () => {
  it('restores the exact position captured before search became active', () => {
    const restoration = createSearchScrollRestoration();

    restoration.prepareSearchChange('', 'needle', 5777);
    expect(restoration.scrollTopForRenderedSearch('needle')).toBe(0);

    restoration.prepareSearchChange('needle', '', 0);
    expect(restoration.scrollTopForRenderedSearch('')).toBe(5777);
    expect(restoration.scrollTopForRenderedSearch('')).toBeNull();
  });

  it('keeps the original position while the active query changes', () => {
    const restoration = createSearchScrollRestoration();

    restoration.prepareSearchChange('', 'first', 4097);
    expect(restoration.scrollTopForRenderedSearch('first')).toBe(0);
    restoration.prepareSearchChange('first', 'second', 0);
    expect(restoration.scrollTopForRenderedSearch('second')).toBe(0);

    restoration.prepareSearchChange('second', '   ', 0);
    expect(restoration.scrollTopForRenderedSearch('   ')).toBe(4097);
  });
});
