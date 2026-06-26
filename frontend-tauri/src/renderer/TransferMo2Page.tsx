import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Home,
  Layers,
  Play,
  RefreshCw,
  UploadCloud,
  XCircle
} from 'lucide-react';

import { ProgressBar } from './design-system';
import { appIconPlaceholder, fluxoraLogo, modOrganizerIcon, skyrimIcon } from './design-system/assets';
import {
  findTransferDriveForPath,
  formatTransferBytes,
  transferAnalysisStatus
} from './settings-workspace-state';
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
  onOpenBuild: () => void;
}

const clampPercent = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value ?? 0 : 0));

const transferStepOrder: TransferStepId[] = ['name', 'game', 'path', 'install'];

const transferStepMeta: Record<
  TransferStepId,
  {
    title: string;
    short: string;
    hint: string;
    icon: ReactNode;
  }
> = {
  name: {
    title: 'Название сборки',
    short: 'Название',
    hint: 'Как сборка будет называться в библиотеке Fluxora',
    icon: <Layers size={20} aria-hidden="true" />
  },
  game: {
    title: 'Игра',
    short: 'Игра',
    hint: 'Для какой игры предназначена эта сборка',
    icon: <Gamepad2 size={20} aria-hidden="true" />
  },
  path: {
    title: 'Путь к игре',
    short: 'Путь',
    hint: 'Исполняемый файл, который Fluxora будет запускать',
    icon: <HardDrive size={20} aria-hidden="true" />
  },
  install: {
    title: 'Папка установки',
    short: 'Папка',
    hint: 'Куда Fluxora развернет перенесенную сборку',
    icon: <FolderOpen size={20} aria-hidden="true" />
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
  const root = rootPath.trim().replace(/[\\/]+$/, '');
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
  onClose,
  onOpenBuild
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
  const selectedDrive = findTransferDriveForPath(drives, destinationRootDirectory);
  const sourceLabel = sourceDirectory ? shortPath(sourceDirectory) : 'Выберите папку Mod Organizer 2';
  const destinationLabel = destinationRootDirectory
    ? shortPath(destinationRootDirectory)
    : defaultDestinationRoot
      ? shortPath(defaultDestinationRoot)
      : 'Fluxora выберет диск из списка';
  const buildName = analysis?.projectName || pathLeaf(sourceDirectory) || 'Foundation Edition';
  const profileName = analysis?.profileName || buildName;
  const gameName = analysis?.gameName || 'Игра будет определена после проверки';
  const gamePath = analysis?.gamePath || 'Путь будет определен после проверки сборки';
  const gameIcon = gameName.toLocaleLowerCase().includes('skyrim') ? skyrimIcon : appIconPlaceholder;
  const targetProjectDirectory =
    analysis?.targetProjectDirectory ||
    combineTargetPath(destinationRootDirectory || defaultDestinationRoot, buildName);
  const currentStepIndex = transferStepOrder.indexOf(selectedStep);
  const previousStepRef = useRef(selectedStep);
  const previousIndex = transferStepOrder.indexOf(previousStepRef.current);
  const motionDirection = currentStepIndex >= previousIndex ? 'forward' : 'back';

  useEffect(() => {
    previousStepRef.current = selectedStep;
  }, [selectedStep]);

  const completedSteps = useMemo(
    () => ({
      name: Boolean(sourceDirectory.trim()),
      game: Boolean(analysis?.gameName),
      path: Boolean(analysis?.gamePath),
      install: Boolean(analysis && analysisStatus === 'ready')
    }),
    [analysis, analysisStatus, sourceDirectory]
  );

  const stepMotionStyle = {
    '--transfer-step-from': motionDirection === 'forward' ? '20px' : '-20px'
  } as CSSProperties;

  const goToNextStep = async () => {
    if (selectedStep === 'name') {
      if (!sourceDirectory.trim()) {
        await onBrowseSource();
        return;
      }
      onSelectStep('game');
      return;
    }

    if (selectedStep === 'game') {
      if (!analysis && canAnalyze) {
        await onAnalyze();
      }
      onSelectStep('path');
      return;
    }

    if (selectedStep === 'path') {
      onSelectStep('install');
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
    const activeIndex = Math.max(0, transferStepOrder.indexOf(activeStep));

    return (
      <aside className="transfer-wizard-rail" aria-label="Шаги переноса сборки">
        <div className="transfer-flow">
          {renderFlowChip('Mod Organizer 2', modOrganizerIcon)}
          <ChevronRight size={15} aria-hidden="true" />
          {renderFlowChip('Fluxora', fluxoraLogo, true)}
        </div>

        <nav className="transfer-rail-steps" aria-label="Transfer steps">
          <span
            className="transfer-rail-indicator"
            style={{ transform: `translateY(${activeIndex * 64}px)` }}
            aria-hidden="true"
          />
          {transferStepOrder.map((step, index) => {
            const active = step === activeStep;
            const done = completedSteps[step] && !active;
            const meta = transferStepMeta[step];

            return (
              <button
                key={step}
                className="transfer-rail-row"
                type="button"
                aria-current={active ? 'step' : undefined}
                data-active={active}
                data-complete={done}
                disabled={isRunning}
                onClick={() => onSelectStep(step)}
              >
                <span className="transfer-rail-row__number">
                  {done ? <Check size={13} aria-hidden="true" /> : index + 1}
                </span>
                <span className="transfer-rail-row__copy">
                  <strong>{meta.title}</strong>
                  <small>{meta.hint}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="transfer-rail-spacer" />
        <div className="transfer-rail-game">
          <img src={gameIcon} alt="" />
          <span>
            <small>Игра</small>
            <strong>{analysis?.gameName || 'Не определена'}</strong>
          </span>
        </div>
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

  const renderNameStep = () => (
    <div className="transfer-step-stack">
      <p>
        Дайте сборке имя - под ним она появится в библиотеке Fluxora. Исходная сборка Mod
        Organizer 2 останется на месте и не будет изменена.
      </p>
      {renderFieldShell(
        'Название',
        <Layers size={15} aria-hidden="true" />,
        sourceDirectory ? buildName : 'Выберите папку Mod Organizer 2',
        {
          title: sourceDirectory || 'Выберите папку Mod Organizer 2',
          onClick: onBrowseSource,
          disabled: !canBrowseSource
        }
      )}
      {sourceDirectory ? (
        <div className="transfer-source-note">
          <FolderOpen size={15} aria-hidden="true" />
          <span title={sourceDirectory}>{sourceLabel}</span>
        </div>
      ) : null}
    </div>
  );

  const renderGameStep = () => (
    <div className="transfer-step-stack transfer-step-stack--wide">
      <p>
        Fluxora определит игру по данным сборки MO2 и использует ее для профиля, порядка загрузки и
        запуска перенесенной сборки.
      </p>
      <section className="transfer-game-card" data-ready={Boolean(analysis?.gameName)}>
        <img src={gameIcon} alt="" />
        <span>
          <small>Обнаруженная игра</small>
          <strong>{gameName}</strong>
          <em>{analysis?.templateId || 'Нажмите проверку, если игра еще не определена'}</em>
        </span>
        <button
          className="tool-button"
          type="button"
          disabled={!canAnalyze}
          onClick={() => void onAnalyze()}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Проверить
        </button>
      </section>
      {analysis?.modCount !== undefined ? (
        <div className="transfer-micro-facts">
          <span>
            <small>Моды</small>
            <strong>{analysis.modCount}</strong>
          </span>
          <span>
            <small>Профиль</small>
            <strong>{profileName}</strong>
          </span>
          <span>
            <small>Статус</small>
            <strong>{analysis.statusMessage || 'Проверено'}</strong>
          </span>
        </div>
      ) : null}
    </div>
  );

  const renderPathStep = () => (
    <div className="transfer-step-stack">
      <p>
        Укажите путь к исполняемому файлу игры - Fluxora будет запускать игру через него с активной
        перенесенной сборкой.
      </p>
      {renderFieldShell(
        'Исполняемый файл игры',
        <HardDrive size={15} aria-hidden="true" />,
        gamePath,
        {
          title: gamePath,
          disabled: true
        }
      )}
      <div className="transfer-source-note">
        <Gamepad2 size={15} aria-hidden="true" />
        <span>Путь приходит из анализа MO2 и остается под контролем native bridge.</span>
      </div>
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

  const renderInstallStep = () => (
    <div className="transfer-step-stack transfer-step-stack--install">
      <p>
        Выберите папку, в которую Fluxora развернет перенесенную сборку. Внутри будет создана сборка
        с данными, профилем и порядком загрузки из Mod Organizer 2.
      </p>
      {renderFieldShell(
        'Папка установки',
        <FolderOpen size={15} aria-hidden="true" />,
        targetProjectDirectory || 'Выберите диск назначения',
        {
          title: targetProjectDirectory || destinationLabel,
          disabled: true
        }
      )}
      {renderDriveList()}
      <section className="transfer-review-card transfer-review-card--compact" aria-label="Проверка переноса">
        {renderReviewSummary()}
      </section>
    </div>
  );

  const renderStepContent = () => {
    switch (selectedStep) {
      case 'game':
        return renderGameStep();
      case 'path':
        return renderPathStep();
      case 'install':
        return renderInstallStep();
      case 'name':
      default:
        return renderNameStep();
    }
  };

  const footerPrimaryLabel =
    selectedStep === 'install'
      ? canStart
        ? 'Перенести'
        : 'Проверить'
      : 'Далее';
  const footerPrimaryIcon =
    selectedStep === 'install' ? (
      canStart ? (
        <UploadCloud size={15} aria-hidden="true" />
      ) : (
        <RefreshCw size={15} aria-hidden="true" />
      )
    ) : (
      <ChevronRight size={14} aria-hidden="true" />
    );
  const primaryDisabled =
    selectedStep === 'name'
      ? !sourceDirectory.trim() && !canBrowseSource
      : selectedStep === 'install'
        ? !canStart && !canAnalyze
        : !sourceDirectory.trim();

  const renderWizardFooter = () => (
    <footer className="transfer-wizard-footer">
      <span className="transfer-footer-progress">Шаг {currentStepIndex + 1} из {transferStepOrder.length}</span>
      <span className="transfer-footer-dots" aria-hidden="true">
        {transferStepOrder.map((step) => (
          <span key={step} data-active={step === selectedStep} data-complete={completedSteps[step]} />
        ))}
      </span>
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
      <button
        className="transfer-footer-button transfer-footer-button--primary"
        type="button"
        disabled={primaryDisabled}
        onClick={() => void goToNextStep()}
      >
        {footerPrimaryLabel}
        {footerPrimaryIcon}
      </button>
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
      <section className="transfer-operation-page transfer-operation-page--wizard" aria-label="Перенос сборки">
        <div className="transfer-wizard-page">
          {renderRail('install')}
          <div className="transfer-wizard-main">
            <div className="transfer-wizard-scroll">
              <section className="transfer-progress-card">
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
              </section>
            </div>

            <footer className="transfer-wizard-footer">
              <span className="transfer-footer-progress">Шаг 4 из 4</span>
              <span className="transfer-footer-dots" aria-hidden="true">
                {transferStepOrder.map((step) => (
                  <span key={step} data-active={step === 'install'} data-complete />
                ))}
              </span>
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
                <>
                  {result ? (
                    <button
                      className="transfer-footer-button transfer-footer-button--primary"
                      type="button"
                      onClick={onOpenBuild}
                    >
                      Открыть сборку
                      <Play size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    className="transfer-footer-button transfer-footer-button--secondary"
                    type="button"
                    onClick={onClose}
                  >
                    <Home size={15} aria-hidden="true" />
                    В библиотеку
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      </section>
    );
  };

  return progress || result ? renderProgress() : renderSetup();
};
