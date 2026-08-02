import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Home,
  Layers,
  RefreshCw,
  UploadCloud,
  XCircle
} from './design-system/icons/lucide-compat';

import { FacetSpinner, ProgressBar, WizardStepper } from './design-system';
import { fluxoraLogo, modOrganizerIcon } from './design-system/assets';
import {
  findTransferDriveForPath,
  formatTransferBytes,
  transferAnalysisStatus
} from './settings-workspace-state';
import {
  normalizeMo2TransferDestinationRoot,
  normalizeMo2TransferTargetProjectDirectory
} from './mo2-transfer-request';
import { shortPath } from './services/path-display-service';
import type {
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraProject,
  FluxoraTransferDriveOption
} from '../shared/fluxora-api';
import type { TransferStepId } from './TransferSettingsPanel';

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
  selectedStep: TransferStepId;
  analysis: FluxoraModOrganizerImportAnalysis | null;
  progress: FluxoraModOrganizerImportProgress | null;
  error: string | null;
  result: FluxoraProject | null;
  drives: FluxoraTransferDriveOption[];
  driveState: TransferDriveListState;
  onSelectStep: (step: TransferStepId) => void;
  onBrowseSource: () => void | Promise<unknown>;
  onSelectDestinationDrive: (drive: FluxoraTransferDriveOption) => void;
  onRefreshDrives: () => void;
  onAnalyze: () => void | Promise<unknown>;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}

const clampPercent = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value ?? 0 : 0));

const transferStepOrder: TransferStepId[] = ['source', 'destination', 'review'];

const transferStepMeta: Record<
  TransferStepId,
  {
    title: string;
    short: string;
    hint: string;
    icon: ReactNode;
  }
> = {
  source: {
    title: 'Папка сборки',
    short: 'Папка',
    hint: 'Выберите существующую сборку Mod Organizer 2',
    icon: <FolderOpen size={20} aria-hidden="true" />
  },
  destination: {
    title: 'Диск установки',
    short: 'Диск',
    hint: 'Куда создать папку Fluxora Builds',
    icon: <HardDrive size={20} aria-hidden="true" />
  },
  review: {
    title: 'Проверка',
    short: 'Проверка',
    hint: 'Проверьте путь, игру и место перед переносом',
    icon: <Check size={20} aria-hidden="true" />
  }
};

const pathLeaf = (rawPath: string): string => {
  const trimmed = rawPath.trim().replace(/[\\/]+$/, '');
  if (!trimmed) {
    return '';
  }

  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
};

const combineTargetPath = (rootPath: string, buildName: string): string => {
  const root = normalizeMo2TransferDestinationRoot(rootPath);
  if (!root || !buildName.trim()) {
    return '';
  }

  return `${root}\\${buildName.trim()}`;
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

const flowChipLabel = (label: string): string => (label.length > 13 ? `${label.slice(0, 10)}...` : label);

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
  selectedStep,
  analysis,
  progress,
  error,
  result,
  drives,
  driveState,
  onSelectStep,
  onBrowseSource,
  onSelectDestinationDrive,
  onRefreshDrives,
  onAnalyze,
  onStart,
  onCancel,
  onClose
}: TransferMo2PageProps) => {
  const analysisStatus = transferAnalysisStatus(analysis);
  const requiredBytes = analysis?.totalBytes ?? progress?.totalBytes ?? 0;
  const canBrowseSource = bridgeReady && transferAvailable && !isRunning && !busyLabel;
  const canAnalyze =
    bridgeReady &&
    transferAvailable &&
    !isRunning &&
    !busyLabel &&
    Boolean(sourceDirectory.trim()) &&
    Boolean(destinationRootDirectory.trim());
  const canStart = canAnalyze && Boolean(analysis) && analysisStatus === 'ready';
  const isAutoChecking = busyLabel === 'Проверяем перенос' && !analysis;
  const selectedDrive = findTransferDriveForPath(drives, destinationRootDirectory);
  const sourceLabel = sourceDirectory ? shortPath(sourceDirectory) : 'Выберите папку Mod Organizer 2';
  const destinationLabel = destinationRootDirectory
    ? shortPath(destinationRootDirectory)
    : defaultDestinationRoot
      ? shortPath(defaultDestinationRoot)
      : 'Fluxora выберет диск из списка';
  const buildName = analysis?.projectName || pathLeaf(sourceDirectory) || 'Foundation Edition';
  const gameName = analysis?.gameName || 'Игра будет определена после проверки';
  const targetProjectDirectory = normalizeMo2TransferTargetProjectDirectory(
    analysis?.targetProjectDirectory,
    analysis?.destinationRootDirectory || destinationRootDirectory || defaultDestinationRoot,
    buildName
  ) || combineTargetPath(destinationRootDirectory || defaultDestinationRoot, buildName);
  const currentStepIndex = transferStepOrder.indexOf(selectedStep);
  const previousStepRef = useRef(selectedStep);
  const previousIndex = transferStepOrder.indexOf(previousStepRef.current);
  const motionDirection = currentStepIndex >= previousIndex ? 'forward' : 'back';

  useEffect(() => {
    previousStepRef.current = selectedStep;
  }, [selectedStep]);

  const completedSteps = useMemo(
    () => ({
      source: Boolean(sourceDirectory.trim()),
      destination: Boolean(destinationRootDirectory.trim()),
      review: Boolean(analysis && analysisStatus === 'ready')
    }),
    [analysis, analysisStatus, destinationRootDirectory, sourceDirectory]
  );

  const stepMotionStyle = {
    '--transfer-step-from': motionDirection === 'forward' ? '20px' : '-20px'
  } as CSSProperties;

  const goToNextStep = async () => {
    if (selectedStep === 'source') {
      if (!sourceDirectory.trim()) {
        await onBrowseSource();
        return;
      }
      onSelectStep('destination');
      return;
    }

    if (selectedStep === 'destination') {
      if (!sourceDirectory.trim()) {
        onSelectStep('source');
        return;
      }

      if (canAnalyze) {
        await onAnalyze();
      }
      return;
    }

    if (!canStart && canAnalyze) {
      await onAnalyze();
      return;
    }

    if (canStart) {
      onStart();
    }
  };

  const goToPreviousStep = () => {
    const nextIndex = Math.max(0, currentStepIndex - 1);
    onSelectStep(transferStepOrder[nextIndex]);
  };

  const renderFlowChip = (label: string, image: string, accent = false) => (
    <span className="transfer-flow-chip" data-accent={accent}>
      <img src={image} alt="" />
      <span>{flowChipLabel(label)}</span>
    </span>
  );

  const renderRail = (activeStep: TransferStepId) => {
    return (
      <aside className="transfer-wizard-rail" aria-label="Шаги переноса сборки">
        <div className="transfer-flow">
          {renderFlowChip('Mod Organizer 2', modOrganizerIcon)}
          <ChevronRight size={15} aria-hidden="true" />
          {renderFlowChip('Fluxora', fluxoraLogo, true)}
        </div>

        <WizardStepper
          activeStepId={activeStep}
          ariaLabel="Transfer steps"
          className="transfer-rail-steps"
          disabled={isRunning}
          onStepSelect={(stepId) => onSelectStep(stepId as TransferStepId)}
          steps={transferStepOrder.map((step) => ({
            hint: transferStepMeta[step].hint,
            id: step,
            label: transferStepMeta[step].title,
            state: completedSteps[step] && step !== activeStep ? 'complete' : 'pending'
          }))}
        />

        <div className="transfer-rail-spacer" />
      </aside>
    );
  };

  const renderStepHeader = (step: TransferStepId) => {
    const meta = transferStepMeta[step];
    const index = transferStepOrder.indexOf(step) + 1;

    return (
      <header className="transfer-step-header">
        <span className="transfer-step-header__icon">{meta.icon}</span>
        <div>
          <span>Шаг {index}</span>
          <h2>{meta.title}</h2>
        </div>
      </header>
    );
  };

  const renderFieldShell = (
    label: string,
    icon: ReactNode,
    value: string,
    options: { title?: string; onClick?: () => void | Promise<unknown>; disabled?: boolean } = {}
  ) => (
    <div className="transfer-form-field">
      <label>{label}</label>
      <button
        className="transfer-field-button"
        type="button"
        title={options.title ?? value}
        disabled={options.disabled}
        onClick={options.onClick}
      >
        {icon}
        <strong>{value}</strong>
      </button>
    </div>
  );

  const renderSourceStep = () => (
    <div className="transfer-step-stack">
      <p>
        Выберите папку существующей сборки Mod Organizer 2. Fluxora возьмет название из этой
        папки, а исходная сборка останется на месте и не будет изменена.
      </p>
      {renderFieldShell(
        'Папка сборки',
        <FolderOpen size={15} aria-hidden="true" />,
        sourceDirectory ? sourceLabel : 'Выбрать папку со сборкой',
        {
          title: sourceDirectory || 'Выберите папку Mod Organizer 2',
          onClick: onBrowseSource,
          disabled: !canBrowseSource
        }
      )}
      {sourceDirectory ? (
        <div className="transfer-source-note">
          <Layers size={15} aria-hidden="true" />
          <span title={buildName}>Название после переноса: {buildName}</span>
        </div>
      ) : null}
    </div>
  );

  const renderDriveList = () => (
    <section className="transfer-drive-section transfer-drive-section--wizard" aria-label="Диски назначения">
      <header>
        <div>
          <strong>Установить на:</strong>
          <span>{destinationLabel}</span>
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
            <dt>Итоговый путь</dt>
            <dd title={targetProjectDirectory}>{targetProjectDirectory || 'Диск еще не выбран'}</dd>
          </div>
          <div>
            <dt>Игра</dt>
            <dd>{gameName}</dd>
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

  const renderDestinationStep = () => (
    <div className="transfer-step-stack transfer-step-stack--install">
      <p>
        Выберите диск, куда Fluxora перенесет сборку. На выбранном диске будет создана папка
        Fluxora Builds, а внутри нее сборка {buildName}.
      </p>
      {renderFieldShell(
        'Итоговая структура',
        <FolderOpen size={15} aria-hidden="true" />,
        targetProjectDirectory || 'Выберите диск назначения',
        {
          title: targetProjectDirectory || destinationLabel,
          disabled: true
        }
      )}
      {renderDriveList()}
    </div>
  );

  const renderReviewStep = () => (
    <div className="transfer-step-stack transfer-step-stack--install">
      <p>
        Проверка подтвердит структуру MO2, рассчитает размер переноса и покажет итоговую папку перед
        запуском копирования.
      </p>
      <section className="transfer-review-card transfer-review-card--compact" aria-label="Проверка переноса">
        {analysis ? (
          renderReviewSummary()
        ) : (
          <div className="settings-note" data-status="ready" aria-busy={isAutoChecking}>
            <strong>{isAutoChecking ? 'Проверяем перенос' : 'Проверка еще не запущена'}</strong>
            <span>
              Выберите диск установки и нажмите «Проверить», чтобы рассчитать размер и итоговый путь.
            </span>
          </div>
        )}
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

  const footerPrimaryLabel =
    selectedStep === 'source'
      ? sourceDirectory.trim()
        ? 'Выбрать диск'
        : 'Выбрать папку'
      : selectedStep === 'destination'
        ? 'Проверить'
        : 'Перенести';
  const footerPrimaryIcon =
    selectedStep === 'source' ? (
      sourceDirectory.trim() ? (
        <ChevronRight size={14} aria-hidden="true" />
      ) : (
        <FolderOpen size={15} aria-hidden="true" />
      )
    ) : selectedStep === 'destination' ? (
      <RefreshCw size={15} aria-hidden="true" />
    ) : (
      <UploadCloud size={15} aria-hidden="true" />
    );
  const primaryDisabled =
    selectedStep === 'source'
      ? !sourceDirectory.trim() && !canBrowseSource
      : selectedStep === 'destination'
        ? !canAnalyze
        : !canStart;
  const showPrimaryButton = selectedStep !== 'review' || canStart;

  const renderWizardFooter = () => (
    <footer className="transfer-wizard-footer">
      <span className="transfer-footer-spacer" />
      <button className="transfer-footer-button transfer-footer-button--ghost" type="button" onClick={onClose}>
        Отмена
      </button>
      <button
        className="transfer-footer-button transfer-footer-button--secondary"
        type="button"
        disabled={currentStepIndex === 0}
        onClick={goToPreviousStep}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        Назад
      </button>
      {showPrimaryButton ? (
        <button
          className="transfer-footer-button transfer-footer-button--primary"
          type="button"
          disabled={primaryDisabled}
          onClick={() => void goToNextStep()}
        >
          {footerPrimaryLabel}
          {footerPrimaryIcon}
        </button>
      ) : null}
    </footer>
  );

  const renderSetup = () => (
    <section className="transfer-operation-page transfer-operation-page--wizard" aria-label="Перенос сборки">
      <div className="transfer-wizard-page">
        {renderRail(selectedStep)}
        <div className="transfer-wizard-main">
          <div className="transfer-wizard-scroll">
            <section
              key={selectedStep}
              className="transfer-step-card"
              data-direction={motionDirection}
              style={stepMotionStyle}
            >
              {renderStepHeader(selectedStep)}
              {renderStepContent()}
              {error ? (
                <div className="settings-note" data-status="error" role="alert">
                  <strong>Нужно внимание</strong>
                  <span>{error}</span>
                </div>
              ) : null}
            </section>
          </div>
          {renderWizardFooter()}
        </div>
      </div>
    </section>
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
    const currentStepText =
      visibleProgress.currentStep || visibleProgress.phase || 'Перенос выполняется';
    const pageTitle = result
      ? 'Перенос завершен'
      : error
        ? 'Перенос требует внимания'
        : analysis?.projectName || visibleProgress.currentItem || 'Mod Organizer';

    return (
      <section className="transfer-operation-page transfer-operation-page--wizard" aria-label="Перенос сборки">
        <div className="transfer-wizard-page">
          {renderRail('review')}
          <div className="transfer-wizard-main">
            <div className="transfer-wizard-scroll">
              <section className="transfer-progress-card">
                <FacetSpinner className="transfer-operation-spinner" size={76} />
                <div className="transfer-operation-copy">
                  <p className="eyebrow">Перенос сборки</p>
                  <h2>{pageTitle}</h2>
                  <span className="transfer-operation-current-step">{currentStepText}</span>
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

                {error ? (
                  <div className="settings-note" data-status="error" role="alert">
                    <strong>Нужно внимание</strong>
                    <span>{error}</span>
                  </div>
                ) : null}
              </section>
            </div>

            <footer className="transfer-wizard-footer">
              <span className="transfer-footer-spacer" />
              {isRunning ? (
                <button
                  className="transfer-footer-button transfer-footer-button--danger"
                  type="button"
                  disabled={!cancellationSupported || cancelRequested}
                  aria-busy={cancelRequested}
                  onClick={onCancel}
                >
                  <XCircle size={15} aria-hidden="true" />
                  {cancelRequested ? 'Отменяем и очищаем' : 'Отменить и очистить'}
                </button>
              ) : (
                result ? null : (
                  <button
                    className="transfer-footer-button transfer-footer-button--secondary"
                    type="button"
                    onClick={onClose}
                  >
                    <Home size={15} aria-hidden="true" />
                    В библиотеку
                  </button>
                )
              )}
            </footer>
          </div>
        </div>
      </section>
    );
  };

  return progress || result ? renderProgress() : renderSetup();
};
