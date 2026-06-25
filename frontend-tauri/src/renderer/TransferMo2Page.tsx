import {
  FolderOpen,
  HardDrive,
  Home,
  Play,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  X,
  XCircle
} from 'lucide-react';

import { ProgressBar } from './design-system';
import { modOrganizerIcon } from './design-system/assets';
import {
  findTransferDriveForPath,
  formatTransferBytes,
  transferAnalysisStatus,
  transferProgressSummary
} from './settings-workspace-state';
import { shortPath } from './services/path-display-service';
import type {
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraProject,
  FluxoraTransferDriveOption
} from '../shared/fluxora-api';
import type { TransferMode, TransferStepId } from './TransferSettingsPanel';

export type TransferDriveListState = 'idle' | 'loading' | 'ready' | 'error';

interface TransferMo2PageProps {
  bridgeReady: boolean;
  transferAvailable: boolean;
  busyLabel: string | null;
  isRunning: boolean;
  cancellationSupported: boolean;
  cancelRequested: boolean;
  sourceDirectory: string;
  destinationRootDirectory: string;
  defaultDestinationRoot: string;
  mode: TransferMode;
  hasSelectedProject: boolean;
  selectedStep: TransferStepId;
  analysis: FluxoraModOrganizerImportAnalysis | null;
  progress: FluxoraModOrganizerImportProgress | null;
  error: string | null;
  result: FluxoraProject | null;
  drives: FluxoraTransferDriveOption[];
  driveState: TransferDriveListState;
  onSelectStep: (step: TransferStepId) => void;
  onModeChange: (mode: TransferMode) => void;
  onBrowseSource: () => void;
  onSelectDestinationDrive: (drive: FluxoraTransferDriveOption) => void;
  onRefreshDrives: () => void;
  onAnalyze: () => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
  onOpenBuild: () => void;
}

const clampPercent = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value ?? 0 : 0));

const transferStepOrder: TransferStepId[] = ['source', 'destination', 'review'];

const stepTitle = (step: TransferStepId): string => {
  switch (step) {
    case 'source':
      return 'Папка сборки';
    case 'destination':
      return 'Диск назначения';
    case 'review':
    default:
      return 'Проверка';
  }
};

const driveUsagePercent = (drive: FluxoraTransferDriveOption): number => {
  if (drive.totalBytes <= 0) {
    return 0;
  }

  return clampPercent(((drive.totalBytes - drive.availableBytes) / drive.totalBytes) * 100);
};

const driveKindTone = (drive: FluxoraTransferDriveOption): 'fast' | 'steady' | 'archive' | 'unknown' => {
  if (drive.driveKind === 'nvme' || drive.driveKind === 'ssd') {
    return 'fast';
  }
  if (drive.driveKind === 'hdd') {
    return 'archive';
  }
  if (drive.driveKind === 'removable') {
    return 'steady';
  }
  return 'unknown';
};

export const TransferMo2Page = ({
  bridgeReady,
  transferAvailable,
  busyLabel,
  isRunning,
  cancellationSupported,
  cancelRequested,
  sourceDirectory,
  destinationRootDirectory,
  defaultDestinationRoot,
  mode,
  hasSelectedProject,
  selectedStep,
  analysis,
  progress,
  error,
  result,
  drives,
  driveState,
  onSelectStep,
  onModeChange,
  onBrowseSource,
  onSelectDestinationDrive,
  onRefreshDrives,
  onAnalyze,
  onStart,
  onCancel,
  onClose,
  onOpenBuild
}: TransferMo2PageProps) => {
  const analysisStatus = transferAnalysisStatus(analysis);
  const requiredBytes = analysis?.totalBytes ?? progress?.totalBytes ?? 0;
  const canAnalyze =
    bridgeReady &&
    transferAvailable &&
    !isRunning &&
    !busyLabel &&
    Boolean(sourceDirectory.trim()) &&
    Boolean(destinationRootDirectory.trim());
  const canStart =
    canAnalyze &&
    Boolean(analysis) &&
    analysisStatus === 'ready' &&
    (mode === 'create' || hasSelectedProject);
  const selectedDrive = findTransferDriveForPath(drives, destinationRootDirectory);
  const sourceLabel = sourceDirectory ? shortPath(sourceDirectory) : 'Выберите папку Mod Organizer 2';
  const destinationLabel = destinationRootDirectory
    ? shortPath(destinationRootDirectory)
    : defaultDestinationRoot
      ? shortPath(defaultDestinationRoot)
      : 'Fluxora выберет диск из списка';
  const stepState = (step: TransferStepId): 'active' | 'done' | 'blocked' | 'idle' => {
    if (selectedStep === step) {
      return 'active';
    }
    if (step === 'source') {
      return sourceDirectory ? 'done' : 'idle';
    }
    if (step === 'destination') {
      return destinationRootDirectory ? 'done' : sourceDirectory ? 'active' : 'blocked';
    }
    if (!sourceDirectory || !destinationRootDirectory) {
      return 'blocked';
    }
    return analysis ? (analysisStatus === 'ready' ? 'done' : 'blocked') : 'idle';
  };

  const renderStepper = () => (
    <div className="transfer-stepper transfer-stepper--splash" aria-label="Transfer steps">
      {transferStepOrder.map((step) => {
        const state = stepState(step);
        return (
          <button
            key={step}
            type="button"
            data-state={state}
            disabled={state === 'blocked' || isRunning}
            onClick={() => onSelectStep(step)}
          >
            <span>{transferStepOrder.indexOf(step) + 1}</span>
            <strong>{stepTitle(step)}</strong>
          </button>
        );
      })}
    </div>
  );

  const renderDriveList = () => (
    <section className="transfer-drive-section" aria-label="Диски назначения">
      <header>
        <div>
          <strong>Установить на:</strong>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Обновить список дисков"
          disabled={isRunning || driveState === 'loading'}
          onClick={onRefreshDrives}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="transfer-drive-list" data-state={driveState}>
        {drives.map((drive) => {
          const isSelected = drive.rootPath.toLowerCase() === destinationRootDirectory.trim().toLowerCase();
          const hasEnoughSpace = requiredBytes <= 0 || drive.availableBytes >= requiredBytes;
          const usage = driveUsagePercent(drive);
          return (
            <button
              key={drive.id}
              type="button"
              className="transfer-drive-row"
              data-selected={isSelected}
              data-space={hasEnoughSpace ? 'ok' : 'low'}
              data-tone={driveKindTone(drive)}
              disabled={isRunning}
              onClick={() => onSelectDestinationDrive(drive)}
            >
              <span className="transfer-drive-row__icon">
                <HardDrive size={17} aria-hidden="true" />
              </span>
              <span className="transfer-drive-row__main">
                <strong>{drive.label}</strong>
                <small>
                  {drive.mediaLabel}
                  {drive.fileSystem ? `, ${drive.fileSystem}` : ''}
                  {drive.friendlyName ? `, ${drive.friendlyName}` : ''}
                </small>
              </span>
              <span className="transfer-drive-row__space">
                <strong>доступно {formatTransferBytes(drive.availableBytes)}</strong>
                <small>
                  {requiredBytes > 0
                    ? `нужно ${formatTransferBytes(requiredBytes)}`
                    : 'нужно посчитать'}
                </small>
              </span>
              <span className="transfer-drive-row__meter" aria-hidden="true">
                <span style={{ width: `${usage}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      {drives.length === 0 ? (
        <div className="settings-note" data-status={driveState === 'error' ? 'error' : 'ready'}>
          <strong>{driveState === 'error' ? 'Диски не загрузились' : 'Диски пока не найдены'}</strong>
          <span>Fluxora оставит выбор папки недоступным, пока main process не вернет список томов.</span>
        </div>
      ) : null}
    </section>
  );

  const renderSourceStep = () => (
    <div className="transfer-setup-grid transfer-setup-grid--source">
      <section className="transfer-picker-card transfer-picker-card--source" data-active={selectedStep === 'source'}>
        <div>
          <FolderOpen size={18} aria-hidden="true" />
          <span>
            <strong>Папка сборки</strong>
            <small>{sourceLabel}</small>
          </span>
        </div>
        <button
          className="tool-button"
          type="button"
          disabled={isRunning || Boolean(busyLabel) || !bridgeReady || !transferAvailable}
          onClick={onBrowseSource}
        >
          Выбрать
        </button>
      </section>

      <section className="transfer-mode-card">
        <div>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>Режим переноса</strong>
            <small>Оригинальная папка MO2 не очищается и не изменяется</small>
          </span>
        </div>
        <div className="segmented-control transfer-mode-toggle" aria-label="Transfer mode">
          <button
            type="button"
            data-active={mode === 'create'}
            disabled={isRunning}
            onClick={() => onModeChange('create')}
          >
            Новая сборка
          </button>
          <button
            type="button"
            data-active={mode === 'replace'}
            disabled={isRunning || !hasSelectedProject}
            onClick={() => onModeChange('replace')}
          >
            Заменить выбранную
          </button>
        </div>
      </section>
    </div>
  );

  const renderDestinationStep = () => (
    <div className="transfer-setup-grid transfer-setup-grid--destination">
      {renderDriveList()}
    </div>
  );

  const renderReviewSummary = () => {
    const availableBytes = analysis?.availableBytes ?? selectedDrive?.availableBytes;
    const requiredSpaceText = requiredBytes > 0 ? `нужно ${formatTransferBytes(requiredBytes)}` : 'нужно проверить';
    const spaceText =
      availableBytes === undefined
        ? requiredSpaceText
        : `${requiredSpaceText}, доступно ${formatTransferBytes(availableBytes)}`;
    const warningText =
      analysis && analysisStatus !== 'ready'
        ? analysis.warningMessage || analysis.statusMessage || 'Перенос сейчас недоступен.'
        : null;

    return (
      <div className="transfer-analysis" data-status={analysisStatus}>
        <dl className="settings-facts transfer-review-facts">
          <div>
            <dt>Папка сборки</dt>
            <dd title={sourceDirectory || sourceLabel}>{sourceLabel}</dd>
          </div>
          <div>
            <dt>Выбранный диск</dt>
            <dd title={destinationRootDirectory || destinationLabel}>{selectedDrive?.label || destinationLabel}</dd>
          </div>
          <div>
            <dt>Место</dt>
            <dd>{spaceText}</dd>
          </div>
        </dl>
        {warningText ? (
          <div className="settings-note" data-status="error">
            <strong>{analysis?.statusMessage || 'Перенос недоступен'}</strong>
            <span>{warningText}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderReviewStep = () => (
    <div className="transfer-setup-grid transfer-setup-grid--review">
      <section className="transfer-review-card transfer-review-card--compact" aria-label="Проверка переноса">
        {renderReviewSummary()}
      </section>
    </div>
  );

  const renderStepContent = () => {
    switch (selectedStep) {
      case 'destination':
        return renderDestinationStep();
      case 'review':
        return renderReviewStep();
      case 'source':
      default:
        return renderSourceStep();
    }
  };

  const renderSetup = () => (
    <div className="transfer-page-panel transfer-page-panel--setup">
      <button className="icon-button transfer-page-close" type="button" title="Закрыть" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>

      <header className="transfer-page-hero">
        <div className="settings-service-main">
          <span className="settings-service-icon settings-service-icon--mo2">
            <img src={modOrganizerIcon} alt="" />
          </span>
          <span className="settings-service-copy">
            <strong>Mod Organizer</strong>
            <span>Перенос копией без изменения оригинальной сборки</span>
          </span>
        </div>
      </header>

      {renderStepper()}

      {renderStepContent()}

      {error ? (
        <div className="settings-note" data-status="error" role="alert">
          <strong>Нужно внимание</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="settings-actions settings-actions--footer transfer-actions">
        <button
          className="tool-button"
          type="button"
          disabled={!canAnalyze}
          onClick={onAnalyze}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Проверить
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!canStart}
          onClick={onStart}
        >
          <UploadCloud size={16} aria-hidden="true" />
          Перенести
        </button>
      </div>
    </div>
  );

  const renderProgress = () => {
    const visibleProgress =
      progress ??
      (result
        ? {
            operationId: result.id,
            phase: 'done',
            currentStep: 'Готово',
            currentItem: result.name,
            overallPercent: 100,
            copyPercent: 100,
            databasePercent: 100,
            copiedBytes: requiredBytes,
            totalBytes: requiredBytes
          }
        : null);

    if (!visibleProgress) {
      return renderSetup();
    }

    const percent = clampPercent(visibleProgress.overallPercent);
    const copyPercent = clampPercent(visibleProgress.copyPercent);
    const databasePercent = clampPercent(visibleProgress.databasePercent);
    const phase = visibleProgress.phase.toLocaleLowerCase();
    const isPreparing = percent < 5 || phase.includes('prepar');
    const isCopying = phase.includes('copy') || (copyPercent > 0 && copyPercent < 100);
    const isDatabase = phase.includes('database') || (databasePercent > 0 && databasePercent < 100);
    const stepRows = [
      {
        label: 'Подготовка',
        detail: 'Проверяем план переноса и папку назначения',
        state: isPreparing ? 'active' : 'done'
      },
      {
        label: 'Копирование файлов',
        detail: `${copyPercent}% файлов перенесено`,
        state: isCopying ? 'active' : copyPercent >= 100 ? 'done' : 'idle'
      },
      {
        label: 'Профили и база',
        detail: `${databasePercent}% данных записано`,
        state: isDatabase ? 'active' : databasePercent >= 100 ? 'done' : 'idle'
      },
      {
        label: 'Финализация',
        detail: 'Обновляем каталог Fluxora',
        state: percent >= 100 ? 'done' : percent >= 98 ? 'active' : 'idle'
      }
    ];
    const pageTitle = result
      ? 'Перенос завершен'
      : error
        ? 'Перенос требует внимания'
        : analysis?.projectName || visibleProgress.currentItem || 'Mod Organizer';

    return (
      <div className="transfer-page-panel transfer-page-panel--progress">
        <div className="transfer-operation-orbit" aria-hidden="true">
          <span />
          <UploadCloud size={28} />
        </div>
        <div className="transfer-operation-copy">
          <p className="eyebrow">Перенос сборки</p>
          <h2>{pageTitle}</h2>
          <span>{visibleProgress.currentStep || visibleProgress.phase || 'Перенос выполняется'}</span>
          {visibleProgress.currentItem ? <small>{visibleProgress.currentItem}</small> : null}
        </div>

        <div className="transfer-operation-meter">
          <strong>{percent}%</strong>
          <ProgressBar
            aria-label="MO2 transfer progress"
            className="transfer-progress-bar"
            value={percent}
          />
        </div>

        <div className="transfer-operation-steps" aria-label="Текущие шаги переноса">
          {stepRows.map((step) => (
            <div key={step.label} data-state={step.state}>
              <span aria-hidden="true" />
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          ))}
        </div>

        {error ? (
          <div className="settings-note" data-status="error" role="alert">
            <strong>Нужно внимание</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="settings-actions settings-actions--footer">
          {isRunning ? (
            <button
              className="danger-button"
              type="button"
              disabled={!cancellationSupported || cancelRequested}
              aria-busy={cancelRequested}
              onClick={onCancel}
            >
              <XCircle size={16} aria-hidden="true" />
              {cancelRequested ? 'Отменяем и очищаем' : 'Отменить и очистить'}
            </button>
          ) : (
            <>
              {result ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={onOpenBuild}
                >
                  <Play size={16} aria-hidden="true" />
                  Открыть сборку
                </button>
              ) : null}
              <button
                className="tool-button"
                type="button"
                onClick={onClose}
              >
                <Home size={16} aria-hidden="true" />
                В библиотеку
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="transfer-operation-page transfer-operation-page--wizard" aria-label="Перенос сборки">
      {progress || result ? renderProgress() : renderSetup()}
    </section>
  );
};
