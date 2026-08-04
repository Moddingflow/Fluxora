import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FluxPackInstallConflictDialog } from '../src/renderer/features/fluxpack/FluxPackInstallConflictDialog';
import { FluxPackManualDownloadsDialog } from '../src/renderer/features/fluxpack/FluxPackManualDownloadsDialog';
import { LocalizationProvider } from '../src/localization/react';

const renderRussian = (element: React.ReactElement) => renderToStaticMarkup(
  React.createElement(LocalizationProvider, { language: 'ru-ru' }, element)
);

describe('FluxPack install dialogs', () => {
  it('offers an explicit Delta update or a separate new build when names collide', () => {
    const markup = renderRussian(
      React.createElement(FluxPackInstallConflictDialog, {
        buildName: 'Foundation Edition',
        onCancel: () => undefined,
        onCreateNew: () => undefined,
        onUpdateExisting: () => undefined
      })
    );

    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Foundation Edition');
    expect(markup).toContain('Обновить существующую');
    expect(markup).toContain('Установить как новую');
    expect(markup).toContain('Дельта-обновление');
    expect(markup).toContain('autofocus=""');
  });

  it('keeps the highlighted Nexus download action fixed while manual archives are collected', () => {
    const markup = renderRussian(
      React.createElement(FluxPackManualDownloadsDialog, {
        buildName: 'Foundation Edition',
        onCancel: () => undefined,
        onDownload: () => undefined,
        onInstall: () => undefined,
        onPickArchive: () => undefined,
        selectedArchives: {
          'source-0:nexus:skyrimspecialedition:3863:123': 'D:\\Downloads\\SkyUI.7z'
        },
        sources: [
          {
            acquisitionMode: 'manual',
            archiveFileName: 'SkyUI.7z',
            canAutomaticallyDownload: false,
            displayName: 'SkyUI',
            manualDownloadUrl:
              'https://www.nexusmods.com/skyrimspecialedition/mods/3863?tab=files&file_id=123',
            providerDisplayName: 'Nexus Mods',
            providerId: 'nexus',
            requiresManualDownload: true,
            sourceId: 'source-0:nexus:skyrimspecialedition:3863:123',
            version: '5.2'
          },
          {
            acquisitionMode: 'manual',
            archiveFileName: 'RaceMenu.7z',
            canAutomaticallyDownload: false,
            displayName: 'RaceMenu',
            manualDownloadUrl:
              'https://www.nexusmods.com/skyrimspecialedition/mods/19080?tab=files&file_id=456',
            providerDisplayName: 'Nexus Mods',
            providerId: 'nexus',
            requiresManualDownload: true,
            sourceId: 'source-1:nexus:skyrimspecialedition:19080:456',
            version: '0.4.19'
          }
        ]
      })
    );

    expect(markup).toContain('Ручная загрузка');
    expect(markup).toContain('1 из 2');
    expect(markup).toContain('RaceMenu');
    expect(markup).toContain('Скачать на Nexus Mods');
    expect(markup).toContain('manual-download-dialog__download-action');
    expect(markup).toContain('data-highlighted="true"');
    expect(markup).toContain('data-provider="nexus"');
    expect(markup).toContain('Выбрать загруженный файл');
    expect(markup).toContain('disabled=""');
  });
});
