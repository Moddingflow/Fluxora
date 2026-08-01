import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { AppTitlebar } from '../src/renderer/components/chrome/AppTitlebar';

const noop = () => undefined;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const renderTitlebar = (update: Parameters<typeof AppTitlebar>[0]['update']) =>
  renderToStaticMarkup(
    React.createElement(AppTitlebar, {
      update,
      onClose: noop,
      onMinimize: noop,
      onToggleMaximize: noop
    })
  );

describe('app update titlebar control', () => {
  it('shows the licensed vector download action only when an update is available', () => {
    const available = renderTitlebar({
      state: 'available',
      version: '2.4.0',
      onActivate: vi.fn()
    });
    const hidden = renderTitlebar({ state: 'hidden' });

    expect(available).toContain('aria-label="Скачать и установить обновление Fluxora 2.4.0"');
    expect(available).toContain('data-update-state="available"');
    const componentSource = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        'src',
        'renderer',
        'features',
        'update',
        'AppUpdateToolbarButton.tsx'
      ),
      'utf8'
    );
    expect(componentSource).toContain("../../../../../Icons/hard-drive-download.svg");
    expect(hidden).not.toContain('data-update-control');
  });

  it('reports download progress and waiting state without replacing the toolbar control', () => {
    const downloading = renderTitlebar({
      state: 'downloading',
      version: '2.4.0',
      progressPercent: 37,
      onCancel: vi.fn()
    });
    const waiting = renderTitlebar({
      state: 'waitingForOperations',
      version: '2.4.0',
      progressPercent: 100,
      onCancel: vi.fn()
    });

    expect(downloading).toContain('aria-label="Загрузка обновления Fluxora 2.4.0: 37%. Отменить"');
    expect(downloading).toContain('aria-busy="true"');
    expect(downloading).toContain('data-update-progress="37"');
    expect(downloading).not.toContain('disabled=""');
    expect(waiting).toContain(
      'title="Обновление Fluxora 2.4.0 ожидает завершения операций. Отменить"'
    );
    expect(waiting).toContain('data-update-state="waitingForOperations"');
    expect(waiting).toContain('class="titlebar__shortcut titlebar__shortcut--update"');
  });

  it('keeps a user-triggered retryable error inline with a useful tooltip', () => {
    const markup = renderTitlebar({
      state: 'error',
      version: '2.4.0',
      errorMessage: 'Соединение прервано',
      retryable: true,
      onActivate: vi.fn()
    });

    expect(markup).toContain(
      'aria-label="Не удалось установить обновление Fluxora 2.4.0. Соединение прервано. Повторить"'
    );
    expect(markup).toContain(
      'title="Не удалось установить обновление Fluxora 2.4.0. Соединение прервано. Повторить"'
    );
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('role="alert"');
  });

  it('keeps a permanent failure focusable as a status without a false retry action', () => {
    const markup = renderTitlebar({
      state: 'error',
      version: '2.4.0',
      errorMessage: 'Подпись обновления недействительна',
      retryable: false
    });

    expect(markup).toContain(
      'aria-label="Не удалось установить обновление Fluxora 2.4.0. Подпись обновления недействительна. Повтор недоступен"'
    );
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('<div aria-label="Не удалось установить обновление Fluxora 2.4.0.');
    expect(markup).not.toContain('Повторить');
    expect(markup).toContain('role="alert"');
  });

  it('uses a fixed 30px target, semantic green status and reduced-motion-safe progress', () => {
    const styles = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        'src',
        'renderer',
        'features',
        'update',
        'app-update.css'
      ),
      'utf8'
    );

    expect(styles).toMatch(
      /\.titlebar__shortcut\.titlebar__shortcut--update\s*\{[^}]*width:\s*30px;[^}]*min-width:\s*30px;[^}]*height:\s*30px;/s
    );
    expect(styles).toMatch(
      /\.titlebar__shortcut\.titlebar__shortcut--update\s*\{[^}]*--flx-update-green:\s*#4ade80;[^}]*color:\s*var\(--flx-update-green\);/s
    );
    expect(styles).toContain('.titlebar__update-progress > span');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
  });
});
