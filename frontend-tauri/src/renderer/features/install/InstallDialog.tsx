import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  File,
  FolderOpen,
  FolderTree,
  Play,
  RefreshCw,
  X
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import installModIcon from '../../../../../Icons/package-plus.svg';
import {
  buildArchivePlacementRows,
  createPlacementOverrideForDrop,
  normalizeInstallModName,
  toggleFomodOption,
  validateInstallModName,
  type EvaluatedFomodWizard,
  type InstallModOrderPlacement,
  type InstallSource,
  type PlacementOverrideMap
} from '../../install-workspace-state';
import { createVirtualWindow } from '../../ui-performance';
import type { InstallNameSource } from './install-name-state';
import type {
  FluxoraContentLayoutPreview,
  FluxoraExistingModInstallMode,
  FluxoraFomodInstaller,
  FluxoraInstallPlan
} from '../../../shared/fluxora-api';

export type InstallDialogPhase =
  | 'detecting'
  | 'fomod'
  | 'options'
  | 'conflict'
  | 'details'
  | 'error';

export type InstallDialogInstallerKind = 'pending' | 'standard' | 'fomod';

export interface InstallDialogState {
  phase: InstallDialogPhase;
  source: InstallSource;
  operationId: string;
  installerKind: InstallDialogInstallerKind;
  fomodInstaller: FluxoraFomodInstaller | null;
  selectedFomodOptionIds: string[];
  fomodStepIndex: number;
  activeFomodOptionId: string | null;
  layoutPreview: FluxoraContentLayoutPreview | null;
  installPlan: FluxoraInstallPlan | null;
  modName: string;
  modNameSource: InstallNameSource;
  modOrderPlacement: InstallModOrderPlacement | null;
  existingModMode: FluxoraExistingModInstallMode;
  placementOverrides: PlacementOverrideMap;
  draggedSourcePath: string | null;
  validationMessage: string | null;
  errorMessage: string | null;
  isSubmitting: boolean;
}

interface InstallDialogProps {
  archiveTreeScrollTop: number;
  evaluation: EvaluatedFomodWizard | null;
  existingModName: string | null;
  installDialog: InstallDialogState | null;
  onArchiveTreeScrollTopChange: (scrollTop: number) => void;
  onClose: () => void;
  onContinueFromFomod: () => void;
  onMoveFomodStep: (direction: 1 | -1) => void;
  onOpenDetails: () => void;
  onPatch: (patch: Partial<InstallDialogState>) => void;
  onResolveExistingMod: (decision: 1 | 2 | 'installNew') => void;
  onSubmitInstallOptions: () => void;
}

const archiveTreeRowHeight = 32;
const archiveTreeVisibleRows = 32;
const archiveTreeOverscanRows = 10;
type InstallIconStyle = CSSProperties & { '--install-icon': string };

const useFomodImageSource = (imagePath: string) => {
  const normalizedPath = imagePath.trim();
  const [failedPath, setFailedPath] = useState('');
  let source = '';

  if (normalizedPath && failedPath !== normalizedPath) {
    try {
      source = window.fluxora.downloads.toFomodPreviewImageUrl(normalizedPath);
    } catch {
      source = '';
    }
  }

  return {
    source,
    markFailed: () => setFailedPath(normalizedPath)
  };
};

function FomodOptionImage({ imagePath }: { imagePath: string }) {
  const image = useFomodImageSource(imagePath);
  if (!image.source) {
    return null;
  }

  return (
    <span className="fomod-option__thumb" aria-hidden="true">
      <img src={image.source} alt="" onError={image.markFailed} />
    </span>
  );
}

function FomodPreviewImage({ imagePath }: { imagePath: string }) {
  const image = useFomodImageSource(imagePath);
  if (!image.source) {
    return null;
  }

  return (
    <div className="install-fomod-preview__image">
      <img src={image.source} alt="" onError={image.markFailed} />
    </div>
  );
}

export function InstallDialog({
  archiveTreeScrollTop,
  evaluation,
  existingModName,
  installDialog,
  onArchiveTreeScrollTopChange,
  onClose,
  onContinueFromFomod,
  onMoveFomodStep,
  onOpenDetails,
  onPatch,
  onResolveExistingMod,
  onSubmitInstallOptions
}: InstallDialogProps) {
  const modNameInputRef = useRef<HTMLInputElement>(null);
  const modNameSelectionRef = useRef<{
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
  }>({ start: 0, end: 0, direction: 'none' });
  const modNameInputFocusedRef = useRef(false);

  useLayoutEffect(() => {
    const input = modNameInputRef.current;
    if (!input || !installDialog) {
      modNameInputFocusedRef.current = false;
      return;
    }
    if (installDialog.modNameSource === 'user' || !modNameInputFocusedRef.current) {
      return;
    }

    const selection = modNameSelectionRef.current;
    const maxOffset = input.value.length;
    input.focus({ preventScroll: true });
    input.setSelectionRange(
      Math.min(selection.start, maxOffset),
      Math.min(selection.end, maxOffset),
      selection.direction
    );
  }, [installDialog?.modName, installDialog?.modNameSource]);

  if (!installDialog) {
    return null;
  }

  const renderInstallFomodSidebar = () => {
    if (!installDialog.fomodInstaller || !evaluation || evaluation.visibleSteps.length === 0) {
      return null;
    }

    const currentStepIndex = Math.min(
      installDialog.fomodStepIndex,
      evaluation.visibleSteps.length - 1
    );

    return (
      <nav className="install-step-sidebar" aria-label="FOMOD steps">
        <header className="install-step-sidebar__header">
          <strong>Installation steps</strong>
        </header>
        <div className="install-step-sidebar__list">
          {evaluation.visibleSteps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isComplete = index < currentStepIndex && step.isSelectionValid;
            return (
              <button
                key={`${step.stepIndex}:${step.stepName}`}
                type="button"
                aria-current={isActive ? 'step' : undefined}
                data-active={isActive}
                data-complete={isComplete}
                onClick={() =>
                  onPatch({
                    fomodStepIndex: index,
                    activeFomodOptionId: null,
                    validationMessage: null
                  })
                }
              >
                <span aria-hidden="true">
                  {isComplete ? <Check size={14} /> : isActive ? <ChevronRight size={14} /> : null}
                </span>
                <strong>{step.stepName}</strong>
              </button>
            );
          })}
        </div>
        <footer className="install-step-sidebar__footer">
          Step {currentStepIndex + 1} of {evaluation.visibleSteps.length}
        </footer>
      </nav>
    );
  };

  const renderInstallFomodStep = () => {
    if (!installDialog.fomodInstaller || !evaluation) {
      return null;
    }

    const visibleStepCount = evaluation.visibleSteps.length;
    const currentStepIndex = Math.min(
      installDialog.fomodStepIndex,
      Math.max(visibleStepCount - 1, 0)
    );
    const currentStep = evaluation.visibleSteps[currentStepIndex];
    const canMoveNext = currentStepIndex < visibleStepCount - 1;
    const stepOptions = currentStep?.groups.flatMap((group) => group.options) ?? [];
    const activeOption =
      stepOptions.find((option) => option.option.id === installDialog.activeFomodOptionId) ?? null;
    const detailsOption =
      activeOption ?? stepOptions.find((option) => option.isSelected) ?? stepOptions[0] ?? null;
    const previewImage =
      detailsOption?.option.imagePath || installDialog.fomodInstaller.moduleImagePath || '';

    return (
      <div className="install-fomod-wizard">
        <div className="install-fomod-body">
          <section className="install-fomod-options">
            <div className="install-section-heading">
              <h3>{currentStep?.stepName ?? 'Options'}</h3>
            </div>

            {installDialog.validationMessage ? (
              <div className="install-validation" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{installDialog.validationMessage}</span>
              </div>
            ) : null}

            <div
              key={`fomod-step-${currentStep?.stepIndex ?? 'empty'}`}
              className="fomod-group-list"
            >
              {currentStep?.groups.map((group, groupIndex) => {
                const groupIdentity = `fomod-step-${currentStep.stepIndex}-group-${groupIndex}`;
                return (
                  <section
                    key={groupIdentity}
                    className="fomod-group"
                    data-invalid={!group.isSelectionValid}
                  >
                    <header>
                      <strong>{group.group.name || 'Options'}</strong>
                    </header>
                    <div className="fomod-options">
                      {group.options.map((option, optionIndex) => {
                        const isRadio =
                          group.group.type === 'SelectExactlyOne' ||
                          group.group.type === 'SelectAtMostOne';
                        return (
                          <label
                            key={`${groupIdentity}-option-${optionIndex}`}
                            className="fomod-option"
                            data-selected={option.isSelected}
                            data-disabled={!option.canToggle}
                            data-highlighted={detailsOption?.option.id === option.option.id}
                            data-previous={option.wasPreviouslySelected}
                            onMouseEnter={() =>
                              onPatch({ activeFomodOptionId: option.option.id })
                            }
                            onFocus={() =>
                              onPatch({ activeFomodOptionId: option.option.id })
                            }
                          >
                            <span className="fomod-option__control">
                              <input
                                type={isRadio ? 'radio' : 'checkbox'}
                                name={groupIdentity}
                                checked={option.isSelected}
                                disabled={!option.canToggle}
                                onChange={(event) =>
                                  onPatch({
                                    selectedFomodOptionIds: toggleFomodOption(
                                      installDialog.fomodInstaller!,
                                      installDialog.selectedFomodOptionIds,
                                      option.option.id,
                                      event.target.checked
                                    ),
                                    activeFomodOptionId: option.option.id,
                                    validationMessage: null
                                  })
                                }
                              />
                              {!isRadio && option.isSelected ? (
                                <Check size={12} strokeWidth={3} aria-hidden="true" />
                              ) : null}
                            </span>
                            <FomodOptionImage imagePath={option.option.imagePath} />
                            <span className="fomod-option__text">
                              <strong>{option.option.name || 'Option'}</strong>
                              <small>{option.effectiveType}</small>
                              {option.wasPreviouslySelected ? (
                                <small className="fomod-option__previous">Previously selected</small>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

          <aside className="install-fomod-preview" aria-label="FOMOD option details">
            <FomodPreviewImage imagePath={previewImage} />
            <div className="install-fomod-preview__copy">
              <p className="eyebrow">{activeOption ? 'Option details' : 'Current choice'}</p>
              <strong>{detailsOption?.option.name ?? installDialog.fomodInstaller.moduleName}</strong>
              <span>
                {detailsOption?.option.description ||
                  installDialog.fomodInstaller.moduleVersion ||
                  'No description provided.'}
              </span>
            </div>
          </aside>
        </div>

        <footer className="install-dialog-actions install-grid-actions">
          <div className="install-dialog-action-group">
            <button
              className="tool-button"
              type="button"
              disabled={currentStepIndex === 0}
              onClick={() => onMoveFomodStep(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Previous
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={installDialog.isSubmitting}
              onClick={() => (canMoveNext ? onMoveFomodStep(1) : onContinueFromFomod())}
            >
              {canMoveNext ? (
                <>
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {installDialog.isSubmitting ? 'Подготовка…' : 'Установить'}
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    );
  };

  const renderInstallOptions = () => {
    const validation = installDialog.validationMessage ?? validateInstallModName(installDialog.modName);
    const installTitle =
      normalizeInstallModName(installDialog.modName) ||
      installDialog.source.displayName ||
      installDialog.source.fileName;

    return (
      <div className="install-simple">
        <label className="field install-name-field">
          <span>Mod name</span>
          <input
            ref={modNameInputRef}
            aria-label={`Mod name for ${installTitle}`}
            value={installDialog.modName}
            disabled={installDialog.isSubmitting}
            onBlur={() => {
              modNameInputFocusedRef.current = false;
            }}
            onFocus={(event) => {
              modNameInputFocusedRef.current = true;
              modNameSelectionRef.current = {
                start: event.currentTarget.selectionStart ?? 0,
                end: event.currentTarget.selectionEnd ?? 0,
                direction: event.currentTarget.selectionDirection ?? 'none'
              };
            }}
            onSelect={(event) => {
              modNameSelectionRef.current = {
                start: event.currentTarget.selectionStart ?? 0,
                end: event.currentTarget.selectionEnd ?? 0,
                direction: event.currentTarget.selectionDirection ?? 'none'
              };
            }}
            onChange={(event) =>
              onPatch({
                modName: event.target.value,
                modNameSource: 'user',
                validationMessage: null
              })
            }
          />
        </label>

        {validation ? (
          <div className="install-validation" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{validation}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderInstallDetecting = () => (
    <div className="install-detecting-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Определяем тип установщика</span>
      <div className="install-detecting-skeleton__content" aria-hidden="true">
        <span className="workspace-skeleton install-detecting-skeleton__title" />
        <span className="workspace-skeleton install-detecting-skeleton__line" />
        <span className="workspace-skeleton install-detecting-skeleton__line install-detecting-skeleton__line--short" />
      </div>
    </div>
  );

  const renderExistingModConflict = () => {
    const conflictName =
      existingModName ||
      normalizeInstallModName(installDialog.modName) ||
      installDialog.source.displayName ||
      installDialog.source.fileName;

    return (
      <div className="install-existing-mod">
        <section className="install-existing-mod__message" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Уже есть мод с таким же названием</strong>
            <span>{conflictName}</span>
          </div>
        </section>
        <div className="install-existing-mod__choices" aria-label="Existing mod install mode">
          <button
            type="button"
            disabled={installDialog.isSubmitting}
            onClick={() => onResolveExistingMod(1)}
          >
            <strong>Заменить</strong>
            <span>Полностью заменяет мод.</span>
          </button>
          <button
            type="button"
            disabled={installDialog.isSubmitting}
            onClick={() => onResolveExistingMod(2)}
          >
            <strong>Объединить</strong>
            <span>Перезаписывает только файлы с одинаковыми названиями.</span>
          </button>
          <button
            type="button"
            disabled={installDialog.isSubmitting}
            onClick={() => onResolveExistingMod('installNew')}
          >
            <strong>Это другой мод</strong>
            <span>Устанавливает отдельную копию с уникальным именем.</span>
          </button>
        </div>
      </div>
    );
  };

  const renderInstallDetails = () => {
    const preview = installDialog.layoutPreview;
    const rows = preview
      ? buildArchivePlacementRows(preview, installDialog.placementOverrides)
      : [];
    const draggedEntry = installDialog.draggedSourcePath
      ? preview?.entries.find(
          (entry) => entry.sourcePath === installDialog.draggedSourcePath
        )
      : null;
    const visibleArchiveWindow = createVirtualWindow(rows, archiveTreeScrollTop, {
      rowHeight: archiveTreeRowHeight,
      visibleRows: archiveTreeVisibleRows,
      overscanRows: archiveTreeOverscanRows
    });

    return (
      <div className="install-details-tree">
        <header className="install-section-heading">
          <div>
            <p className="eyebrow">Archive details</p>
            <h3>Placement tree</h3>
          </div>
          <div className="mods-toolbar">
            <button
              className="tool-button"
              type="button"
              onClick={() =>
                onPatch({
                  placementOverrides: {},
                  validationMessage: null
                })
              }
            >
              <RefreshCw size={15} aria-hidden="true" />
              Reset
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => onPatch({ phase: 'options', validationMessage: null })}
            >
              Apply
            </button>
          </div>
        </header>
        {preview && preview.validationFindings.length > 0 ? (
          <div className="install-findings">
            {preview.validationFindings.map((finding) => (
              <span key={`${finding.path}:${finding.message}`} data-blocker={finding.blocksInstall}>
                {finding.path || finding.classification}: {finding.message}
              </span>
            ))}
          </div>
        ) : null}
        <div
          className={`archive-tree${preview ? '' : ' archive-tree--pending'}`}
          role="tree"
          aria-label="Archive placement tree"
          onScroll={(event) => onArchiveTreeScrollTopChange(event.currentTarget.scrollTop)}
        >
          {preview ? (
            <>
              {visibleArchiveWindow.topSpacer > 0 ? (
                <div style={{ height: visibleArchiveWindow.topSpacer }} aria-hidden="true" />
              ) : null}
              {visibleArchiveWindow.items.map((row) => {
                const canDrop =
                  draggedEntry !== undefined &&
                  draggedEntry !== null &&
                  createPlacementOverrideForDrop(draggedEntry, row) !== null;
                const hasOverride =
                  row.entry !== null && installDialog.placementOverrides[row.entry.sourcePath] !== undefined;
                return (
                  <div
                    key={row.key}
                    className="archive-tree-row"
                    role="treeitem"
                    tabIndex={0}
                    aria-level={row.depth + 1}
                    draggable={row.entry?.manualOverrideAllowed === true}
                    data-directory={row.isDirectory}
                    data-drop={canDrop}
                    data-override={hasOverride}
                    onDragStart={(event) => {
                      if (!row.entry?.manualOverrideAllowed) {
                        event.preventDefault();
                        return;
                      }

                      event.dataTransfer.setData('text/plain', row.entry.sourcePath);
                      onPatch({ draggedSourcePath: row.entry.sourcePath });
                    }}
                    onDragEnd={() => onPatch({ draggedSourcePath: null })}
                    onDragOver={(event) => {
                      if (canDrop) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourcePath =
                        event.dataTransfer.getData('text/plain') || installDialog.draggedSourcePath || '';
                      const sourceEntry = preview.entries.find(
                        (entry) => entry.sourcePath === sourcePath
                      );
                      if (!sourceEntry) {
                        onPatch({ draggedSourcePath: null });
                        return;
                      }

                      const override = createPlacementOverrideForDrop(sourceEntry, row);
                      if (!override) {
                        onPatch({ draggedSourcePath: null });
                        return;
                      }

                      onPatch({
                        draggedSourcePath: null,
                        placementOverrides: {
                          ...installDialog.placementOverrides,
                          [override.sourcePath]: {
                            target: override.target,
                            targetRelativePath: override.targetRelativePath
                          }
                        },
                        validationMessage: null
                      });
                    }}
                    style={{ paddingLeft: `${12 + row.depth * 18}px` }}
                  >
                    {row.isDirectory ? (
                      <FolderOpen size={15} aria-hidden="true" />
                    ) : (
                      <File size={15} aria-hidden="true" />
                    )}
                    <span>{row.name}</span>
                    <small>{row.isDirectory ? row.target || 'folder' : row.entry?.classification}</small>
                  </div>
                );
              })}
              {visibleArchiveWindow.bottomSpacer > 0 ? (
                <div style={{ height: visibleArchiveWindow.bottomSpacer }} aria-hidden="true" />
              ) : null}
            </>
          ) : (
            <div
              className="archive-tree-row"
              role="treeitem"
              tabIndex={0}
              aria-level={1}
              data-directory={false}
            >
              <File size={15} aria-hidden="true" />
              <span>{installDialog.source.fileName || installDialog.source.displayName}</span>
              <small>archive</small>
            </div>
          )}
        </div>
      </div>
    );
  };

  const dialogTitle =
    normalizeInstallModName(installDialog.modName) ||
    installDialog.source.displayName ||
    installDialog.source.fileName ||
    'Install mod';
  const dialogAriaLabel = `Install ${dialogTitle}`;

  return (
    <div className="install-modal-backdrop" role="presentation">
      <section
        className="install-modal-layout"
        data-phase={installDialog.phase}
        role="dialog"
        aria-modal="true"
        aria-label={dialogAriaLabel}
        aria-busy={installDialog.phase === 'detecting'}
      >
        {installDialog.phase === 'fomod' ? renderInstallFomodSidebar() : null}
        <div className="install-dialog" data-phase={installDialog.phase}>
          <header className="install-dialog-header">
            <div className="install-dialog-title">
              <span
                className="install-dialog-title-icon"
                aria-hidden="true"
                style={{ '--install-icon': `url("${installModIcon}")` } as InstallIconStyle}
              />
              <strong>{dialogTitle}</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Закрыть окно установки"
              disabled={installDialog.isSubmitting}
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="install-dialog-body">
            {installDialog.phase === 'detecting' ? renderInstallDetecting() : null}
            {installDialog.phase === 'fomod' ? renderInstallFomodStep() : null}
            {installDialog.phase === 'options' ? renderInstallOptions() : null}
            {installDialog.phase === 'conflict' ? renderExistingModConflict() : null}
            {installDialog.phase === 'details' ? renderInstallDetails() : null}
            {installDialog.phase === 'error' ? (
              <div className="install-error" role="alert">
                <AlertTriangle size={20} aria-hidden="true" />
                <strong>Install flow failed</strong>
                <span>{installDialog.errorMessage ?? 'Operation failed.'}</span>
              </div>
            ) : null}
          </div>

          {installDialog.phase === 'options' || installDialog.phase === 'error' ? (
            <footer className="install-dialog-actions">
              {installDialog.phase === 'options' ? (
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => {
                    onArchiveTreeScrollTopChange(0);
                    onOpenDetails();
                  }}
                >
                  <FolderTree size={15} aria-hidden="true" />
                  Подробнее
                </button>
              ) : (
                <span />
              )}
              <div className="install-dialog-action-group">
                {installDialog.phase === 'error' ? (
                  <button
                    className="tool-button"
                    type="button"
                    onClick={onClose}
                  >
                    Close
                  </button>
                ) : null}
                {installDialog.phase === 'options' ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      installDialog.isSubmitting ||
                      Boolean(validateInstallModName(installDialog.modName))
                    }
                    onClick={onSubmitInstallOptions}
                  >
                    <Play size={16} aria-hidden="true" />
                    {installDialog.isSubmitting ? 'Подготовка…' : 'Установить'}
                  </button>
                ) : null}
              </div>
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}
