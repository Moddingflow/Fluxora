import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UpdateStageProgressPanel } from '../src/installer/components/UpdateStageProgressPanel';
import { LocalizationProvider } from '../src/localization/react';
import {
  createDownloadSpeedSampler,
  projectAppUpdateProgress
} from '../src/renderer/features/update/app-update-progress';
import { AppUpdateWindowView } from '../src/renderer/features/update/AppUpdateWindow';

describe('dedicated application updater progress', () => {
  it('renders exactly two explicit stages with download speed and percentages', () => {
    const markup = renderToStaticMarkup(React.createElement(UpdateStageProgressPanel, {
      currentVersion: '2.3.0',
      downloadLabel: 'Скачивание',
      downloadMeta: '12,4 МБ/с',
      downloadPercent: 38,
      installLabel: 'Установка',
      installMeta: 'Ожидание',
      installPercent: 0,
      status: 'Скачивание обновления',
      targetVersion: '2.4.0',
      title: 'Обновление Fluxora'
    }));

    expect(markup.match(/role="progressbar"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Скачивание"');
    expect(markup).toContain('aria-label="Установка"');
    expect(markup).toContain('12,4 МБ/с');
    expect(markup).toContain('38%');
    expect(markup).toContain('0%');
  });

  it('keeps download progress monotonic through drain and updater handoff', () => {
    expect(projectAppUpdateProgress({
      state: 'downloading',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0',
      downloadedBytes: 40,
      totalBytes: 100
    })).toMatchObject({ downloadPercent: 40, installPercent: 0 });
    expect(projectAppUpdateProgress({
      state: 'waitingForOperations',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0',
      downloadedBytes: 100,
      totalBytes: 100
    })).toMatchObject({ downloadPercent: 100, installPercent: 0 });
    expect(projectAppUpdateProgress({
      state: 'launchingUpdater',
      currentVersion: '2.3.0',
      availableVersion: '2.4.0'
    })).toMatchObject({ downloadPercent: 100, installPercent: 0 });
  });

  it('derives transfer speed from byte deltas without counting resumed bytes twice', () => {
    const sampler = createDownloadSpeedSampler();

    expect(sampler.sample(80 * 1024 * 1024, 1_000)).toBeUndefined();
    expect(sampler.sample(85 * 1024 * 1024, 2_000)).toBe(5 * 1024 * 1024);
    expect(sampler.sample(85 * 1024 * 1024, 3_000)).toBe(0);
    expect(sampler.sample(10 * 1024 * 1024, 4_000)).toBeUndefined();
  });

  it('shows localized speed and two stages without exposing a native workflow code', () => {
    const running = renderToStaticMarkup(
      <LocalizationProvider language="ru-ru">
        <AppUpdateWindowView
          downloadSpeed={12_400_000}
          onDismiss={() => undefined}
          onRetry={() => undefined}
          status={{
            state: 'downloading',
            currentVersion: '2.4.0',
            availableVersion: '2.5.0',
            downloadedBytes: 42,
            totalBytes: 100,
            progressPercent: 42
          }}
        />
      </LocalizationProvider>
    );
    expect(running.match(/role="progressbar"/g)).toHaveLength(2);
    expect(running).toContain('Скачивание');
    expect(running).toContain('Установка');
    expect(running).toContain('12,4 MB/s');
    expect(running).toContain('42%');

    const failed = renderToStaticMarkup(
      <LocalizationProvider language="ru-ru">
        <AppUpdateWindowView
          onDismiss={() => undefined}
          onRetry={() => undefined}
          status={{
            state: 'error',
            currentVersion: '2.4.0',
            availableVersion: '2.5.0',
            error: {
              code: 'updater.workflowFailed',
              message: 'updater.workflowFailed',
              retryable: true
            }
          }}
        />
      </LocalizationProvider>
    );
    expect(failed).toContain('Обновление не завершено');
    expect(failed).not.toContain('updater.workflowFailed');
  });
});
