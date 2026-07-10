import { PackageOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { FluxoraFluxPackCompressionMode } from '../../../shared/fluxora-api';
import { Checkbox } from '../../design-system';
import { FluxPackCompressionSelect } from './FluxPackCompressionSelect';

export interface FluxPackExportOptions {
  compressionMode: FluxoraFluxPackCompressionMode;
  includeGeneratedAssets: boolean;
}

export interface FluxPackExportDialogProps {
  buildName: string;
  defaultCompressionMode: FluxoraFluxPackCompressionMode;
  onCancel: () => void;
  onConfirm: (options: FluxPackExportOptions) => void;
  outputPath: string;
}

export function FluxPackExportDialog({
  buildName,
  defaultCompressionMode,
  onCancel,
  onConfirm,
  outputPath
}: FluxPackExportDialogProps) {
  const [compressionMode, setCompressionMode] =
    useState<FluxoraFluxPackCompressionMode>(defaultCompressionMode);
  const [includeGeneratedAssets, setIncludeGeneratedAssets] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="delete-confirmation-backdrop" role="presentation">
      <section
        aria-labelledby="fluxpack-export-title"
        aria-modal="true"
        className="fluxpack-export-dialog"
        role="dialog"
      >
        <header className="fluxpack-export-dialog__header">
          <div className="fluxpack-export-dialog__title">
            <PackageOpen aria-hidden="true" size={17} />
            <strong id="fluxpack-export-title">Упаковать сборку</strong>
          </div>
          <button
            aria-label="Закрыть окно упаковки"
            className="icon-button"
            onClick={onCancel}
            title="Закрыть"
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="fluxpack-export-dialog__body">
          <div className="fluxpack-export-dialog__target">
            <strong>{buildName}</strong>
            <span title={outputPath}>{outputPath}</span>
          </div>
          <FluxPackCompressionSelect onChange={setCompressionMode} value={compressionMode} />
          <Checkbox
            checked={includeGeneratedAssets}
            className="fluxpack-export-dialog__generated-assets"
            label={
              <>
                <strong>Добавить сгенерированные файлы</strong>
                <span>Nemesis, DynDOLOD и другие</span>
              </>
            }
            onCheckedChange={setIncludeGeneratedAssets}
          />
        </div>

        <footer className="fluxpack-export-dialog__actions">
          <button className="tool-button" onClick={onCancel} type="button">
            Отмена
          </button>
          <button
            autoFocus
            className="primary-button"
            onClick={() => onConfirm({ compressionMode, includeGeneratedAssets })}
            type="button"
          >
            Упаковать
          </button>
        </footer>
      </section>
    </div>
  );
}
