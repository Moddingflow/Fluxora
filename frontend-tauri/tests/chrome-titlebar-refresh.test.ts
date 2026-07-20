import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppTitlebar } from '../src/renderer/components/chrome/AppTitlebar';

const noop = () => undefined;

describe('app titlebar refresh shortcut', () => {
  it('renders refresh between home and settings shortcuts', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        onClose: noop,
        onHome: noop,
        onMinimize: noop,
        onOpenSettings: noop,
        onRefresh: noop,
        onToggleMaximize: noop
      })
    );

    const homeIndex = markup.indexOf('aria-label="Home"');
    const refreshIndex = markup.indexOf('aria-label="Refresh"');
    const settingsIndex = markup.indexOf('aria-label="Open settings"');

    expect(homeIndex).toBeGreaterThanOrEqual(0);
    expect(refreshIndex).toBeGreaterThan(homeIndex);
    expect(settingsIndex).toBeGreaterThan(refreshIndex);
  });

  it('does not expose AI from the global titlebar', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        onClose: noop,
        onHome: noop,
        onMinimize: noop,
        onOpenSettings: noop,
        onRefresh: noop,
        onToggleMaximize: noop
      })
    );
    expect(markup).not.toMatch(/AI chat|Control\+Shift\+G|titlebar__shortcut--ai/);
    expect(AppTitlebar.toString()).not.toMatch(/onToggleAi|aiActive|geminiIcon/);
  });
});
