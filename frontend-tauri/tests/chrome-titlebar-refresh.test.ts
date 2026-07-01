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

  it('renders the Gemini AI shortcut only when the main shell wires it', () => {
    const inactiveMarkup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        onClose: noop,
        onHome: noop,
        onMinimize: noop,
        onOpenSettings: noop,
        onRefresh: noop,
        onToggleMaximize: noop
      })
    );
    const activeMarkup = renderToStaticMarkup(
      React.createElement(AppTitlebar, {
        aiActive: true,
        onClose: noop,
        onHome: noop,
        onMinimize: noop,
        onOpenSettings: noop,
        onRefresh: noop,
        onToggleAi: noop,
        onToggleMaximize: noop
      })
    );

    expect(inactiveMarkup).not.toContain('Open AI chat');
    expect(activeMarkup).toContain('aria-label="Close AI chat"');
    expect(activeMarkup).toContain('aria-keyshortcuts="Control+Shift+G"');
    expect(activeMarkup).toContain('aria-pressed="true"');
    expect(activeMarkup).toContain('titlebar__shortcut--ai');
    expect(activeMarkup).toContain('Gemini%20placeholder');
  });
});
