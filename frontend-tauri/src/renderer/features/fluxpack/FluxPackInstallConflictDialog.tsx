import { PackageCheck, X } from '../../design-system/icons/lucide-compat';
import { useEffect } from 'react';

export interface FluxPackInstallConflictDialogProps {
  buildName: string;
  onCancel: () => void;
  onCreateNew: () => void;
  onUpdateExisting: () => void;
}

export function FluxPackInstallConflictDialog({
  buildName,
  onCancel,
  onCreateNew,
  onUpdateExisting
}: FluxPackInstallConflictDialogProps) {
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
        aria-labelledby="fluxpack-install-conflict-title"
        aria-modal="true"
        className="fluxpack-export-dialog fluxpack-install-conflict-dialog"
        role="dialog"
      >
        <header className="fluxpack-export-dialog__header">
          <div className="fluxpack-export-dialog__title">
            <PackageCheck aria-hidden="true" size={17} />
            <strong id="fluxpack-install-conflict-title">Сборка уже существует</strong>
          </div>
          <button
            aria-label="Закрыть выбор установки"
            className="icon-button"
            onClick={onCancel}
            title="Закрыть"
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="fluxpack-export-dialog__body fluxpack-install-conflict-dialog__body">
          <strong title={buildName}>{buildName}</strong>
          <p>
            Delta-обновление сохранит совпадающие моды и архивы. Либо установите отдельную
            копию с новым именем.
          </p>
        </div>

        <footer className="fluxpack-export-dialog__actions">
          <button className="tool-button" onClick={onCreateNew} type="button">
            Установить как новую
          </button>
          <button autoFocus className="primary-button" onClick={onUpdateExisting} type="button">
            Обновить существующую
          </button>
        </footer>
      </section>
    </div>
  );
}
