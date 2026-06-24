import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TransferMo2Page } from '../src/renderer/TransferMo2Page';
import type { TransferStepId } from '../src/renderer/TransferSettingsPanel';

type TransferMo2PageProps = ComponentProps<typeof TransferMo2Page>;

const gib = (value: number): number => value * 1024 * 1024 * 1024;
const noop = () => {};

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
  cancellationSupported: true,
  sourceDirectory: 'E:\\Foundation Edition',
  destinationRootDirectory: 'C:\\',
  defaultDestinationRoot: 'C:\\',
  mode: 'create',
  hasSelectedProject: true,
  selectedStep: 'review',
  analysis: {
    sourceDirectory: 'E:\\Foundation Edition',
    destinationRootDirectory: 'C:\\',
    targetProjectDirectory: 'C:\\Fluxora\\Foundation Edition',
    targetConfigPath: 'C:\\Fluxora\\Foundation Edition\\fluxora.json',
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
  onModeChange: noop,
  onBrowseSource: noop,
  onSelectDestinationDrive: noop,
  onRefreshDrives: noop,
  onAnalyze: noop,
  onStart: noop,
  onCancel: noop,
  onClose: noop,
  onOpenBuild: noop
};

const renderTransferPage = (
  selectedStep: TransferStepId,
  overrides: Partial<TransferMo2PageProps> = {}
): string =>
  renderToStaticMarkup(React.createElement(TransferMo2Page, { ...baseProps, selectedStep, ...overrides }));

describe('TransferMo2Page', () => {
  it('shows only the compact transfer summary on the review step', () => {
    const html = renderTransferPage('review');

    expect(html).toContain('Папка сборки');
    expect(html).toContain('Foundation Edition');
    expect(html).toContain('Выбранный диск');
    expect(html).toContain('Локальный диск (C:)');
    expect(html).toContain('нужно 109 GB, доступно 151 GB');
    expect(html).not.toContain('Установить на:');
    expect(html).not.toContain('Локальный диск (D:)');
    expect(html).not.toContain('Режим переноса');
    expect(html).not.toContain('Новая сборка');
    expect(html).not.toContain('Проверка пройдена');
    expect(html).not.toContain('Игра');
    expect(html).not.toContain('Моды');
  });

  it('keeps drive selection scoped to the destination step', () => {
    const html = renderTransferPage('destination');

    expect(html).toContain('Установить на:');
    expect(html).toContain('Локальный диск (D:)');
    expect(html).not.toContain('Режим переноса');
    expect(html).not.toContain('Проверка пройдена');
  });

  it('keeps folder and mode controls scoped to the source step', () => {
    const html = renderTransferPage('source');

    expect(html).toContain('Foundation Edition');
    expect(html).toContain('Выбрать');
    expect(html).toContain('Режим переноса');
    expect(html).not.toContain('Установить на:');
    expect(html).not.toContain('Локальный диск (D:)');
    expect(html).not.toContain('Проверка пройдена');
  });
});
