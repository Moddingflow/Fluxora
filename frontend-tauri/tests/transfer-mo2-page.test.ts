import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TransferMo2Page } from '../src/renderer/TransferMo2Page';
import type { TransferStepId } from '../src/renderer/TransferSettingsPanel';

type TransferMo2PageProps = ComponentProps<typeof TransferMo2Page>;

const gib = (value: number): number => value * 1024 * 1024 * 1024;
const noop = () => {};
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const drives: TransferMo2PageProps['drives'] = [
  {
    id: 'c',
    rootPath: 'C:\\',
    label: 'Локальный диск (C:)',
    volumeName: 'Windows',
    fileSystem: 'NTFS',
    totalBytes: gib(1000),
    availableBytes: gib(151),
    driveKind: 'nvme',
    mediaLabel: 'NVMe M.2',
    busType: 'NVMe',
    friendlyName: 'KINGSTON SNV2S1000G',
    isSystem: true
  },
  {
    id: 'd',
    rootPath: 'D:\\',
    label: 'Локальный диск (D:)',
    volumeName: 'Archive',
    fileSystem: 'NTFS',
    totalBytes: gib(2000),
    availableBytes: gib(816),
    driveKind: 'hdd',
    mediaLabel: 'HDD',
    busType: 'SATA',
    friendlyName: 'ST1000LM035-1RK172',
    isSystem: false
  }
];

const baseProps: TransferMo2PageProps = {
  bridgeReady: true,
  transferAvailable: true,
  busyLabel: null,
  isRunning: false,
  cancellationSupported: false,
  cancelRequested: false,
  sourceDirectory: 'E:\\Foundation Edition',
  destinationRootDirectory: 'C:\\',
  defaultDestinationRoot: 'C:\\',
  selectedStep: 'review',
  analysis: {
    sourceDirectory: 'E:\\Foundation Edition',
    destinationRootDirectory: 'C:\\',
    targetProjectDirectory: 'C:\\Fluxora Builds\\Foundation Edition',
    targetConfigPath: 'C:\\Fluxora Builds\\Foundation Edition\\fluxora.json',
    projectName: 'Foundation Edition',
    profileName: 'Foundation Edition',
    templateId: 'skyrim-se',
    gameName: 'Skyrim Special Edition',
    gamePath: 'E:\\Steam\\Skyrim Special Edition',
    totalBytes: gib(109),
    availableBytes: gib(151),
    modCount: 621,
    separatorCount: 0,
    hasEnoughSpace: true,
    willOverwrite: false,
    canImport: true,
    statusMessage: 'Сборка готова к переносу.',
    warningMessage: '',
    operationId: 'op_transfer_review'
  },
  progress: null,
  error: null,
  result: null,
  drives,
  driveState: 'ready',
  onSelectStep: noop,
  onBrowseSource: noop,
  onSelectDestinationDrive: noop,
  onRefreshDrives: noop,
  onAnalyze: noop,
  onStart: noop,
  onCancel: noop,
  onClose: noop
};

const renderTransferPage = (
  selectedStep: TransferStepId,
  overrides: Partial<TransferMo2PageProps> = {}
): string =>
  renderToStaticMarkup(React.createElement(TransferMo2Page, { ...baseProps, selectedStep, ...overrides }));

describe('TransferMo2Page', () => {
  it('renders the transfer destination step with drive choices and the Fluxora Builds structure', () => {
    const html = renderTransferPage('destination');

    expect(html).toContain('Диск установки');
    expect(html).toContain('Итоговая структура');
    expect(html).toContain('C:\\Fluxora Builds\\Foundation Edition');
    expect(html).toContain('Установить на:');
    expect(html).toContain('Локальный диск (C:)');
    expect(html).toContain('Локальный диск (D:)');
    expect(html).toContain('Проверить');
    expect(html).not.toContain('Режим переноса');
    expect(html).not.toContain('Новая сборка');
    expect(html).not.toContain('Заменить выбранную');
  });

  it('keeps a preselected destination drive on the disk step until explicit verification', () => {
    const html = renderTransferPage('destination', {
      analysis: null,
      busyLabel: null,
      destinationRootDirectory: 'C:\\'
    });

    expect(html).toContain('Диск установки');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('Локальный диск (C:)');
    expect(html).toContain('Проверить');
    expect(html).not.toContain('Проверяем перенос');
    expect(html).not.toContain('Проверка еще не запущена');
  });

  it('does not duplicate the Fluxora Builds folder in the destination preview', () => {
    const html = renderTransferPage('destination', {
      analysis: null,
      destinationRootDirectory: 'D:\\Fluxora Builds',
      defaultDestinationRoot: 'D:\\Fluxora Builds'
    });

    expect(html).toContain('D:\\Fluxora Builds\\Foundation Edition');
    expect(html).not.toContain('D:\\Fluxora Builds\\Fluxora Builds');
  });

  it('keeps source picking scoped to the source step', () => {
    const html = renderTransferPage('source');

    expect(html).toContain('Папка сборки');
    expect(html).toContain('Название после переноса');
    expect(html).toContain('Foundation Edition');
    expect(html).toContain('E:\\Foundation Edition');
    expect(html).not.toContain('Установить на:');
    expect(html).not.toContain('Локальный диск (D:)');
  });

  it('shows transfer verification facts on the review step without creation-only steps', () => {
    const html = renderTransferPage('review');

    expect(html).toContain('Проверка');
    expect(html).toContain('Итоговый путь');
    expect(html).toContain('C:\\Fluxora Builds\\Foundation Edition');
    expect(html).toContain('Skyrim Special Edition');
    expect(html).toContain('нужно 109 GB, доступно 151 GB');
    expect(html).not.toContain('<dt>Профиль</dt>');
    expect(html).not.toContain('<dt>Моды</dt>');
    expect(html).not.toContain('<dd>621</dd>');
    expect(html).not.toContain('Название сборки');
    expect(html).not.toContain('Путь к игре');
    expect(html).not.toContain('Исполняемый файл игры');
    expect(html).not.toContain('E:\\Steam\\Skyrim Special Edition');
  });

  it('repairs stale analysis paths that point directly at the selected drive', () => {
    const html = renderTransferPage('review', {
      destinationRootDirectory: 'E:\\',
      analysis: {
        ...baseProps.analysis!,
        destinationRootDirectory: 'E:\\',
        targetProjectDirectory: 'E:\\Foundation Edition-2'
      }
    });

    expect(html).toContain('E:\\Fluxora Builds\\Foundation Edition-2');
    expect(html).not.toContain('<dd title="E:\\Foundation Edition-2">');
  });

  it('keeps review facts as a single column constrained to the step copy width', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const reviewFactRules = styles.match(/\.transfer-review-facts\s*\{[^}]+\}/g) ?? [];

    expect(reviewFactRules.length).toBeGreaterThan(0);
    for (const rule of reviewFactRules) {
      expect(rule).toContain('grid-template-columns: minmax(0, 1fr);');
      expect(rule).toContain('width: min(100%, 66ch);');
      expect(rule).not.toContain('repeat(3');
    }
  });

  it('shows the running verification state on the review step while analysis is pending', () => {
    const html = renderTransferPage('review', {
      analysis: null,
      busyLabel: 'Проверяем перенос'
    });

    expect(html).toContain('Проверяем перенос');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Нажмите "Проверить"');
  });

  it('does not auto-skip the destination step before explicit verification', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain("setTransferStep('destination');");
    expect(app).toContain("transferStep === 'review'");
    expect(app).not.toContain("setTransferStep(destinationRootDirectory ? 'review' : 'destination')");
    expect(app).not.toContain("setTransferStep(sourceDirectory ? 'review' : 'source')");
    expect(app).not.toContain("(transferStep === 'destination' || transferStep === 'review')");
    expect(app).not.toContain("await analyzeMo2Transfer(path, destinationRootDirectory, 'review')");
    expect(app).not.toContain("await analyzeMo2Transfer(sourceDirectory, drive.rootPath, 'review')");
  });

  it('starts transfer with the analyzed Fluxora Builds destination root', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('normalizeMo2TransferAnalysis(analysis, destinationRootDirectory)');
    expect(app).toContain('normalizedAnalysis.destinationRootDirectory');
    expect(app).toContain(
      'createMo2TransferImportRequest(\n      sourceDirectory,\n      importDestinationRootDirectory\n    )'
    );
    expect(app).toContain('setTransferDestinationRootDirectory(importDestinationRootDirectory);');
  });

  it('keeps an imported build visible when the catalog refresh times out', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');

    expect(app).toContain('keepMergedProjectOnError?: boolean;');
    expect(app).toContain('mergeProjectIntoCatalog(current, mergeProject)');
    expect(app).toContain('keepMergedProjectOnError: true');
    expect(app).toContain("setCatalogState('ready');");
    expect(facade).toContain('const projectsListTimeoutMs = 30_000;');
    expect(facade).toContain('projectsListTimeoutMs');
  });

  it('keeps the progress view free of duplicate safety notes', () => {
    const html = renderTransferPage('review', {
      progress: {
        operationId: 'op_transfer_import',
        phase: 'copying',
        currentStep: 'Копирую моды',
        currentItem: 'prisonercrafts.tri',
        overallPercent: 0,
        copyPercent: 1,
        databasePercent: 0,
        copiedBytes: 0,
        totalBytes: gib(109)
      }
    });

    expect(html).toContain('Копирую моды');
    expect(html).toContain('transfer-operation-current-step');
    expect(html).toContain('flx-facet-spinner');
    expect(html.match(/role="progressbar"/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('transfer-operation-steps');
    expect(html).not.toContain('Копирование файлов');
    expect(html).not.toContain('Профили и база');
    expect(html).not.toContain('Оригинальная папка MO2 не изменяется');
  });

  it('enables cancel cleanup while a cancellable transfer is running', () => {
    const html = renderTransferPage('review', {
      isRunning: true,
      cancellationSupported: true,
      progress: {
        operationId: 'op_transfer_import',
        phase: 'copying',
        currentStep: 'Копирую моды',
        currentItem: 'SkyUI',
        overallPercent: 24,
        copyPercent: 30,
        databasePercent: 0,
        copiedBytes: gib(26),
        totalBytes: gib(109)
      }
    });

    expect(html).toContain('Отменить и очистить');
    expect(html).not.toContain('class="transfer-footer-button transfer-footer-button--danger" type="button" disabled=""');
  });

  it('locks cancel cleanup after the request is accepted', () => {
    const html = renderTransferPage('review', {
      isRunning: true,
      cancellationSupported: true,
      cancelRequested: true,
      progress: {
        operationId: 'op_transfer_import',
        phase: 'canceling',
        currentStep: 'Отменяем и очищаем',
        currentItem: 'Временная папка переноса',
        overallPercent: 24,
        copyPercent: 30,
        databasePercent: 0,
        copiedBytes: gib(26),
        totalBytes: gib(109)
      }
    });

    expect(html).toContain('Отменяем и очищаем');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
  });

  it('keeps the completed transfer view free of post-transfer action buttons', () => {
    const html = renderTransferPage('review', {
      result: {
        id: 'C:\\Fluxora\\Builds\\Foundation Edition.json',
        name: 'Foundation Edition',
        templateId: 'skyrim-se',
        uiTemplateId: 'skyrim',
        gameName: 'Skyrim Special Edition',
        gamePath: 'C:\\Games\\Skyrim Special Edition',
        installRootDirectory: 'C:\\Fluxora Builds',
        projectDirectory: 'C:\\Fluxora Builds\\Foundation Edition',
        configPath: 'C:\\Fluxora\\Builds\\Foundation Edition.json'
      }
    });

    expect(html).toContain('Перенос завершен');
    expect(html).not.toContain('Открыть сборку');
    expect(html).not.toContain('Запустить сборку');
    expect(html).not.toContain('В библиотеку');
  });
});
