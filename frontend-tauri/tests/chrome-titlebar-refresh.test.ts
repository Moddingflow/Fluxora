import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppTitlebar } from '../src/renderer/components/chrome/AppTitlebar';

const noop = () => undefined;

describe('app titlebar refresh shortcut', () => {
  it('renders build-scoped AI between refresh and settings shortcuts', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        onClose: noop,
        onHome: noop,
        onMinimize: noop,
        onOpenSettings: noop,
        onRefresh: noop,
        onToggleAi: noop,
        showAi: true,
        onToggleMaximize: noop
      })
    );

    const homeIndex = markup.indexOf('aria-label="Home"');
    const refreshIndex = markup.indexOf('aria-label="Refresh"');
    const aiIndex = markup.indexOf('aria-label="Open Fluxora AI"');
    const settingsIndex = markup.indexOf('aria-label="Open settings"');

    expect(homeIndex).toBeGreaterThanOrEqual(0);
    expect(refreshIndex).toBeGreaterThan(homeIndex);
    expect(aiIndex).toBeGreaterThan(refreshIndex);
    expect(settingsIndex).toBeGreaterThan(aiIndex);
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
    expect(AppTitlebar.toString()).toMatch(/onToggleAi|aiActive|geminiIcon/);
  });
});
