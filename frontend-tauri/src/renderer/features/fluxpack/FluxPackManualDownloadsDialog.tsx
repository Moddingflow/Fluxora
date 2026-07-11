import { Check, Download, FileArchive, X } from 'lucide-react';
import { useEffect } from 'react';

import type { FluxoraFluxPackSourceInstallPlan } from '../../../shared/fluxora-api';

export interface FluxPackManualDownloadsDialogProps {
  buildName: string;
  onCancel: () => void;
  onDownload: (source: FluxoraFluxPackSourceInstallPlan) => void;
  onInstall: () => void;
  onPickArchive: (source: FluxoraFluxPackSourceInstallPlan) => void;
  selectedArchives: Readonly<Record<string, string>>;
  sources: FluxoraFluxPackSourceInstallPlan[];
}

export function FluxPackManualDownloadsDialog({
  buildName,
  onCancel,
  onDownload,
  onInstall,
  onPickArchive,
  selectedArchives,
  sources
}: FluxPackManualDownloadsDialogProps) {
  const completedCount = sources.filter((source) => Boolean(selectedArchives[source.sourceId])).length;
  const currentSource =
    sources.find((source) => !selectedArchives[source.sourceId]) ?? sources.at(-1) ?? null;
  const allSelected = sources.length > 0 && completedCount === sources.length;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  if (!currentSource) {
    return null;
  }

  return (
    <div className="delete-confirmation-backdrop" role="presentation">
      <section
        aria-labelledby="fluxpack-manual-download-title"
        aria-modal="true"
        className="fluxpack-manual-download-dialog"
        role="dialog"
      >
        <header className="fluxpack-export-dialog__header">
          <div className="fluxpack-export-dialog__title">
            <Download aria-hidden="true" size={17} />
            <strong id="fluxpack-manual-download-title">Ручная загрузка</strong>
          </div>
          <button
            aria-label="Закрыть ручную загрузку"
            className="icon-button"
            onClick={onCancel}
            title="Закрыть"
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="fluxpack-manual-download-dialog__body">
          <div className="fluxpack-manual-download-dialog__queue">
            <div className="fluxpack-manual-download-dialog__summary">
              <strong title={buildName}>{buildName}</strong>
              <span>{completedCount} из {sources.length}</span>
            </div>
            <div className="fluxpack-manual-download-dialog__sources" role="list">
              {sources.map((source) => {
                const archivePath = selectedArchives[source.sourceId];
                return (
                  <div
                    className="fluxpack-manual-download-dialog__source"
                    data-complete={Boolean(archivePath)}
                    key={source.sourceId}
                    role="listitem"
                  >
                    <span aria-hidden="true">
                      {archivePath ? <Check size={14} /> : <FileArchive size={14} />}
                    </span>
                    <div>
                      <strong>{source.displayName}</strong>
                      <small>{archivePath || source.archiveFileName || source.providerDisplayName}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="fluxpack-manual-download-dialog__action-panel"
            data-provider={currentSource.providerId}
          >
            <span>{currentSource.providerDisplayName}</span>
            <strong>{currentSource.displayName}</strong>
            <small>{currentSource.version || currentSource.archiveFileName}</small>
            <button
              autoFocus
              className="manual-download-dialog__download-action"
              data-highlighted={currentSource.providerId === 'nexus' ? 'true' : undefined}
              data-provider={currentSource.providerId}
              disabled={!currentSource.manualDownloadUrl}
              onClick={() => onDownload(currentSource)}
              type="button"
            >
              <Download aria-hidden="true" size={17} />
              Скачать на {currentSource.providerDisplayName}
            </button>
            <button
              className="tool-button manual-download-dialog__pick-action"
              onClick={() => onPickArchive(currentSource)}
              type="button"
            >
              Выбрать загруженный файл
            </button>
          </div>
        </div>

        <footer className="fluxpack-export-dialog__actions">
          <button className="tool-button" onClick={onCancel} type="button">
            Отмена
          </button>
          <button className="primary-button" disabled={!allSelected} onClick={onInstall} type="button">
            Начать установку
          </button>
        </footer>
      </section>
    </div>
  );
}
