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
import { useLocalization } from '../localization/react';

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
  const { t } = useLocalization();
  const transferStepMeta: Record<
    TransferStepId,
    { title: string; hint: string; icon: ReactNode }
  > = {
    source: {
      title: t('transfer.step.source.title'),
      hint: t('transfer.step.source.hint'),
      icon: <FolderOpen size={20} aria-hidden="true" />
    },
    destination: {
      title: t('transfer.step.destination.title'),
      hint: t('transfer.step.destination.hint'),
      icon: <HardDrive size={20} aria-hidden="true" />
    },
    review: {
      title: t('transfer.step.review.title'),
      hint: t('transfer.step.review.hint'),
      icon: <Check size={20} aria-hidden="true" />
    }
  };
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
  const isAutoChecking = busyLabel === t('transfer.checking') && !analysis;
  const selectedDrive = findTransferDriveForPath(drives, destinationRootDirectory);
  const sourceLabel = sourceDirectory ? shortPath(sourceDirectory) : t('transfer.source.placeholder');
  const destinationLabel = destinationRootDirectory
    ? shortPath(destinationRootDirectory)
    : defaultDestinationRoot
      ? shortPath(defaultDestinationRoot)
      : t('transfer.destination.placeholder');
  const buildName = analysis?.projectName || pathLeaf(sourceDirectory) || t('transfer.defaultBuildName');
  const gameName = analysis?.gameName || t('transfer.gamePending');
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
      <aside className="transfer-wizard-rail" aria-label={t('transfer.stepsAria')}>
        <div className="transfer-flow">
          {renderFlowChip(t('transfer.mo2'), modOrganizerIcon)}
          <ChevronRight size={15} aria-hidden="true" />
          {renderFlowChip('Fluxora', fluxoraLogo, true)}
        </div>

        <WizardStepper
          activeStepId={activeStep}
          ariaLabel={t('transfer.stepsAria')}
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
          <span>{t('transfer.stepNumber', { number: index })}</span>
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
      <p>{t('transfer.source.description')}</p>
      {renderFieldShell(
        t('transfer.step.source.title'),
        <FolderOpen size={15} aria-hidden="true" />,
        sourceDirectory ? sourceLabel : t('transfer.source.choose'),
        {
          title: sourceDirectory || t('transfer.source.placeholder'),
          onClick: onBrowseSource,
          disabled: !canBrowseSource
        }
      )}
      {sourceDirectory ? (
        <div className="transfer-source-note">
          <Layers size={15} aria-hidden="true" />
          <span title={buildName}>{t('transfer.source.renamed', { name: buildName })}</span>
        </div>
      ) : null}
    </div>
  );

  const renderDriveList = () => (
    <section className="transfer-drive-section transfer-drive-section--wizard" aria-label={t('transfer.drivesAria')}>
      <header>
        <div>
          <strong>{t('transfer.installOn')}</strong>
          <span>{destinationLabel}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          title={t('transfer.refreshDrives')}
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
                <strong>{t('transfer.availableSpace', { bytes: formatTransferBytes(drive.availableBytes) })}</strong>
                <small>
                  {requiredBytes > 0
                    ? t('transfer.requiredSpace', { bytes: formatTransferBytes(requiredBytes) })
                    : t('transfer.requiredCalculate')}
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
          <strong>{driveState === 'error' ? t('transfer.drivesError') : t('transfer.drivesEmpty')}</strong>
          <span>{t('transfer.drivesWaiting')}</span>
        </div>
      ) : null}
    </section>
  );

  const renderReviewSummary = () => {
    const availableBytes = analysis?.availableBytes ?? selectedDrive?.availableBytes;
    const requiredSpaceText = requiredBytes > 0
      ? t('transfer.requiredSpace', { bytes: formatTransferBytes(requiredBytes) })
      : t('transfer.spaceNeedsCheck');
    const spaceText =
      availableBytes === undefined
        ? requiredSpaceText
        : t('transfer.spaceSummary', {
            required: requiredSpaceText,
            available: formatTransferBytes(availableBytes)
          });
    const warningText =
      analysis && analysisStatus !== 'ready'
        ? analysis.warningMessage || analysis.statusMessage || t('transfer.unavailable')
        : null;

    return (
      <div className="transfer-analysis" data-status={analysisStatus}>
        <dl className="settings-facts transfer-review-facts">
          <div>
            <dt>{t('transfer.review.source')}</dt>
            <dd title={sourceDirectory || sourceLabel}>{sourceLabel}</dd>
          </div>
          <div>
            <dt>{t('transfer.review.drive')}</dt>
            <dd title={destinationRootDirectory || destinationLabel}>{selectedDrive?.label || destinationLabel}</dd>
          </div>
          <div>
            <dt>{t('transfer.review.target')}</dt>
            <dd title={targetProjectDirectory}>{targetProjectDirectory || t('transfer.review.noDrive')}</dd>
          </div>
          <div>
            <dt>{t('transfer.review.game')}</dt>
            <dd>{gameName}</dd>
          </div>
          <div>
            <dt>{t('transfer.review.space')}</dt>
            <dd>{spaceText}</dd>
          </div>
        </dl>
        {warningText ? (
          <div className="settings-note" data-status="error">
            <strong>{analysis?.statusMessage || t('transfer.unavailable')}</strong>
            <span>{warningText}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderDestinationStep = () => (
    <div className="transfer-step-stack transfer-step-stack--install">
      <p>{t('transfer.destination.description', { name: buildName })}</p>
      {renderFieldShell(
        t('transfer.destination.structure'),
        <FolderOpen size={15} aria-hidden="true" />,
        targetProjectDirectory || t('transfer.destination.choose'),
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
      <p>{t('transfer.review.description')}</p>
      <section className="transfer-review-card transfer-review-card--compact" aria-label={t('transfer.review.aria')}>
        {analysis ? (
          renderReviewSummary()
        ) : (
          <div className="settings-note" data-status="ready" aria-busy={isAutoChecking}>
            <strong>{isAutoChecking ? t('transfer.checking') : t('transfer.notChecked')}</strong>
            <span>{t('transfer.review.instructions')}</span>
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
        ? t('transfer.footer.selectDrive')
        : t('transfer.footer.selectFolder')
      : selectedStep === 'destination'
        ? t('transfer.footer.check')
        : t('transfer.footer.transfer');
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
        {t('transfer.cancel')}
      </button>
      <button
        className="transfer-footer-button transfer-footer-button--secondary"
        type="button"
        disabled={currentStepIndex === 0}
        onClick={goToPreviousStep}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {t('transfer.back')}
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
    <section className="transfer-operation-page transfer-operation-page--wizard" aria-label={t('transfer.pageAria')}>
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
                  <strong>{t('transfer.attention')}</strong>
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
            currentStep: t('transfer.doneStep'),
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
      visibleProgress.currentStep || visibleProgress.phase || t('transfer.inProgress');
    const pageTitle = result
      ? t('transfer.completed')
      : error
        ? t('transfer.needsAttention')
        : analysis?.projectName || visibleProgress.currentItem || t('transfer.mo2');

    return (
      <section className="transfer-operation-page transfer-operation-page--wizard" aria-label={t('transfer.pageAria')}>
        <div className="transfer-wizard-page">
          {renderRail('review')}
          <div className="transfer-wizard-main">
            <div className="transfer-wizard-scroll">
              <section className="transfer-progress-card">
                <FacetSpinner className="transfer-operation-spinner" size={76} />
                <div className="transfer-operation-copy">
                  <p className="eyebrow">{t('transfer.eyebrow')}</p>
                  <h2>{pageTitle}</h2>
                  <span className="transfer-operation-current-step">{currentStepText}</span>
                  {visibleProgress.currentItem ? <small>{visibleProgress.currentItem}</small> : null}
                </div>

                <div className="transfer-operation-meter">
                  <strong>{percent}%</strong>
                  <ProgressBar
                    aria-label={t('transfer.progressAria')}
                    className="transfer-progress-bar"
                    value={percent}
                  />
                </div>

                {error ? (
                  <div className="settings-note" data-status="error" role="alert">
                    <strong>{t('transfer.attention')}</strong>
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
                  {cancelRequested ? t('transfer.cancelling') : t('transfer.cancelAndClean')}
                </button>
              ) : (
                result ? null : (
                  <button
                    className="transfer-footer-button transfer-footer-button--secondary"
                    type="button"
                    onClick={onClose}
                  >
                    <Home size={15} aria-hidden="true" />
                    {t('transfer.toLibrary')}
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
