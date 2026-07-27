import { describe, expect, it } from 'vitest';

import {
  modRowPropsEqual,
  modsListSurfacePropsEqual,
  type ModsListSurfaceProps
} from '../src/renderer/features/mods/ModsListSurface';
import {
  pluginRowPropsEqual,
  pluginsListSurfacePropsEqual,
  type PluginsListSurfaceProps
} from '../src/renderer/features/plugins/PluginsListSurface';
import type {
  FluxoraModOrderItem,
  FluxoraPluginOrderItem
} from '../src/shared/fluxora-api';

const noop = () => undefined;

describe('memoized list surface isolation', () => {
  it('keeps 5,000-row surfaces memoized when unrelated root callbacks change', () => {
    const mods = Array.from(
      { length: 5_000 },
      (_, index) => ({ orderId: `mod-${index}` } as FluxoraModOrderItem)
    );
    const plugins = Array.from(
      { length: 5_000 },
      (_, index) => ({ orderId: `plugin-${index}` } as FluxoraPluginOrderItem)
    );
    const modsProps: ModsListSurfaceProps = {
      items: mods,
      presentationRevision: {},
      rowHeight: 40,
      scrollContainerRef: noop,
      virtualizerRef: null,
      onPointerMove: noop,
      onPointerUp: noop,
      onPointerCancel: noop,
      onScrollActivityChange: noop,
      renderItem: () => null
    };
    const pluginsProps: PluginsListSurfaceProps = {
      items: plugins,
      presentationRevision: {},
      rowHeight: 36,
      virtualizerRef: null,
      onPointerMove: noop,
      onPointerUp: noop,
      onPointerCancel: noop,
      onScrollActivityChange: noop,
      renderItem: () => null
    };

    expect(modsListSurfacePropsEqual(modsProps, {
      ...modsProps,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      renderItem: () => 'unrelated root render'
    })).toBe(true);
    expect(pluginsListSurfacePropsEqual(pluginsProps, {
      ...pluginsProps,
      onPointerCancel: () => undefined,
      renderItem: () => 'unrelated download render'
    })).toBe(true);
    expect(modsListSurfacePropsEqual(modsProps, {
      ...modsProps,
      presentationRevision: {}
    })).toBe(false);
    expect(pluginsListSurfacePropsEqual(pluginsProps, {
      ...pluginsProps,
      items: plugins.slice()
    })).toBe(false);
  });

  it('invalidates only the affected pending row presentation key', () => {
    const previousKeys = Array.from({ length: 5_000 }, (_, index) => `row-${index}:queued`);
    const nextKeys = previousKeys.slice();
    nextKeys[2_500] = 'row-2500:extracting';

    const changedModRows = previousKeys.filter((presentationKey, index) =>
      !modRowPropsEqual(
        { children: null, orderId: `row-${index}`, presentationKey },
        {
          children: 'new render tree',
          orderId: `row-${index}`,
          presentationKey: nextKeys[index]!
        }
      )
    );
    const changedPluginRows = previousKeys.filter((presentationKey, index) =>
      !pluginRowPropsEqual(
        { children: null, orderId: `row-${index}`, presentationKey },
        {
          children: 'new render tree',
          orderId: `row-${index}`,
          presentationKey: nextKeys[index]!
        }
      )
    );

    expect(changedModRows).toHaveLength(1);
    expect(changedPluginRows).toHaveLength(1);
  });
});
