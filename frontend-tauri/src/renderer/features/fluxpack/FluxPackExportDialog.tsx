import { PackageOpen, X } from '../../design-system/icons/lucide-compat';
import { useEffect, useState } from 'react';

import type { FluxoraFluxPackPackageType } from '../../../shared/fluxora-api';
import { Checkbox } from '../../design-system';
import { FluxPackPackageTypeSelect } from './FluxPackPackageTypeSelect';

export interface FluxPackExportOptions {
  packageType: FluxoraFluxPackPackageType;
  includeGeneratedAssets: boolean;
}

export interface FluxPackExportDialogProps {
  buildName: string;
  defaultPackageType: FluxoraFluxPackPackageType;
  onCancel: () => void;
  onConfirm: (options: FluxPackExportOptions) => void;
  outputPath: string;
}

export function FluxPackExportDialog({
  buildName,
  defaultPackageType,
  onCancel,
  onConfirm,
  outputPath
}: FluxPackExportDialogProps) {
  const [packageType, setPackageType] =
    useState<FluxoraFluxPackPackageType>(defaultPackageType);
  const [includeGeneratedAssets, setIncludeGeneratedAssets] = useState(false);
  const isFullPackage = packageType === 'full';

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
          <FluxPackPackageTypeSelect onChange={setPackageType} value={packageType} />
          <div className="fluxpack-export-dialog__package-hint">
            {isFullPackage ? (
              <span>Полная — все моды и локальные файлы внутри одного автономного FluxPack.</span>
            ) : (
              <span>Рецепт — моды загружаются из Nexus Mods и других указанных источников.</span>
            )}
            <span>Максимальное сжатие применяется автоматически.</span>
          </div>
          <Checkbox
            checked={isFullPackage || includeGeneratedAssets}
            className="fluxpack-export-dialog__generated-assets"
            disabled={isFullPackage}
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
            onClick={() =>
              onConfirm({
                packageType,
                includeGeneratedAssets: isFullPackage || includeGeneratedAssets
              })
            }
            type="button"
          >
            Упаковать
          </button>
        </footer>
      </section>
    </div>
  );
}
