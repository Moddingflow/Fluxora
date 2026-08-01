import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppUpdateSettingsControl } from '../src/renderer/features/update/AppUpdateSettingsControl';

describe('application update settings control', () => {
  it('offers a manual check and reports the installed version when current', () => {
    const markup = renderToStaticMarkup(React.createElement(AppUpdateSettingsControl, {
      update: {
        state: 'upToDate',
        currentVersion: '0.0.1',
        onCheck: vi.fn()
      }
    }));

    expect(markup).toContain('Обновления Fluxora');
    expect(markup).toContain('Установлена последняя версия 0.0.1');
    expect(markup).toContain('Проверить обновления');
    expect(markup).not.toContain('disabled=""');
  });

  it('disables duplicate checks and exposes a bounded retryable failure', () => {
    const checking = renderToStaticMarkup(React.createElement(AppUpdateSettingsControl, {
      update: {
        state: 'checking',
        currentVersion: '0.0.1',
        onCheck: vi.fn()
      }
    }));
    const failed = renderToStaticMarkup(React.createElement(AppUpdateSettingsControl, {
      update: {
        state: 'error',
        currentVersion: '0.0.1',
        errorMessage: 'Сервер обновлений пока недоступен',
        onCheck: vi.fn()
      }
    }));

    expect(checking).toContain('Проверка обновлений…');
    expect(checking).toContain('disabled=""');
    expect(failed).toContain('Сервер обновлений пока недоступен');
    expect(failed).toContain('Повторить проверку');
  });
});
