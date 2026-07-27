import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DownloadDuplicateDecisionDialog } from '../src/renderer/features/downloads/DownloadDuplicateDecisionDialog';
import type { FluxoraDownloadEntry } from '../src/shared/fluxora-api';

const duplicateEntry = (
  direction: 'upgrade' | 'downgrade' | 'mixed' | 'same-file'
): FluxoraDownloadEntry => ({
  id: `pending-${direction}`,
  name: 'SkyUI 1.0.0',
  fileName: 'SkyUI 1.0.0.7z',
  localPath: `C:\\Builds\\Skyrim\\downloads\\pending-${direction}.nxm`,
  source: 'nexus',
  archiveId: null,
  buildStatus: null,
  transferState: 'awaiting-decision',
  transferMessage: 'Нужно решение',
  sizeText: '',
  createdAtText: 'today',
  progressPercent: 0,
  progressText: '',
  etaText: '',
  downloadSpeedText: '',
  isDownloading: false,
  hasKnownProgress: false,
  hasResolvedFileName: true,
  canResume: false,
  canInstall: false,
  canDelete: false,
  duplicateDecision: {
    decisionId: `decision-${direction}`,
    direction,
    incomingFile: {
      id: 'incoming',
      fileId: '101',
      fileName: 'SkyUI 1.0.1.7z',
      version: '1.0.1'
    },
    existingFiles: [{
      id: 'existing',
      fileId: '100',
      fileName: 'SkyUI 1.0.0.7z',
      version: '1.0.0'
    }]
  }
});

const renderDialog = (entry: FluxoraDownloadEntry): string =>
  renderToStaticMarkup(React.createElement(DownloadDuplicateDecisionDialog, {
    entry,
    isResolving: false,
    errorMessage: null,
    onResolve: () => undefined
  }));

describe('download duplicate decision dialog', () => {
  it('renders an accessible modal with all three decisions and file versions', () => {
    const markup = renderDialog(duplicateEntry('upgrade'));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Заменить');
    expect(markup).toContain('Сохранить оба');
    expect(markup).toContain('Отмена');
    expect(markup).toContain('SkyUI 1.0.1.7z');
    expect(markup).toContain('SkyUI 1.0.0.7z');
  });

  it('shows explicit downgrade and mixed-history warnings', () => {
    expect(renderDialog(duplicateEntry('downgrade'))).toContain(
      'Вы скачиваете более старую версию'
    );
    expect(renderDialog(duplicateEntry('mixed'))).toContain(
      'одновременно есть более старые и более новые версии'
    );
  });

  it('shows one plain archive name and only the replace action for an identical archive', () => {
    const markup = renderDialog(duplicateEntry('same-file'));

    expect(markup).toContain('Точно такой же архив уже есть в Downloads');
    expect(markup).toContain('Заменить');
    expect(markup.match(/SkyUI 1\.0\.1\.7z/g)).toHaveLength(1);
    expect(markup).not.toContain('— 1.0.1');
    expect(markup).not.toContain('Запрошенный файл');
    expect(markup).not.toContain('Готовый архив');
    expect(markup).not.toContain('Пропустить');
    expect(markup).not.toContain('Этот файл уже скачан');
    expect(markup).not.toContain('Выбрать способ установки');
    expect(markup).not.toContain('Отмена');
    expect(markup).not.toContain('Сохранить оба');
  });
});
