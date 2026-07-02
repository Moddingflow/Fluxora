import {
  AlertTriangle,
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
import type { CSSProperties } from 'react';

import installModIcon from '../../../../../Icons/package-plus.svg';
import {
  buildArchivePlacementRows,
  createPlacementOverrideForDrop,
  fomodGroupTypeLabel,
  normalizeInstallModName,
  previousFomodSelection,
  toggleFomodOption,
  validateInstallModName,
  type EvaluatedFomodWizard,
  type InstallSource,
  type PlacementOverrideMap
} from '../../install-workspace-state';
import { shortPath } from '../../services/path-display-service';
import { createVirtualWindow } from '../../ui-performance';
import type {
  FluxoraContentLayoutPreview,
  FluxoraExistingModInstallMode,
  FluxoraFomodInstaller
} from '../../../shared/fluxora-api';

export type InstallDialogPhase =
  | 'fomod'
  | 'options'
  | 'conflict'
  | 'details'
  | 'installing'
  | 'error';

export interface InstallDialogState {
  phase: InstallDialogPhase;
  source: InstallSource;
  operationId: string;
  isFomod: boolean;
  fomodInstaller: FluxoraFomodInstaller | null;
  selectedFomodOptionIds: string[];
  fomodStepIndex: number;
  activeFomodOptionId: string | null;
  layoutPreview: FluxoraContentLayoutPreview | null;
  modName: string;
  existingModMode: FluxoraExistingModInstallMode;
  placementOverrides: PlacementOverrideMap;
  draggedSourcePath: string | null;
  validationMessage: string | null;
  errorMessage: string | null;
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
  onPatch: (patch: Partial<InstallDialogState>) => void;
  onResolveExistingMod: (mode: 1 | 2) => void;
  onSubmitInstallOptions: () => void;
}

const archiveTreeRowHeight = 32;
const archiveTreeVisibleRows = 32;
const archiveTreeOverscanRows = 10;
type InstallIconStyle = CSSProperties & { '--install-icon': string };

export function InstallDialog({
  archiveTreeScrollTop,
  evaluation,
  existingModName,
  installDialog,
  onArchiveTreeScrollTopChange,
  onClose,
  onContinueFromFomod,
  onMoveFomodStep,
  onPatch,
  onResolveExistingMod,
  onSubmitInstallOptions
}: InstallDialogProps) {
  if (!installDialog) {
    return null;
  }

  const renderInstallFomodStep = () => {
    if (!installDialog.fomodInstaller || !evaluation) {
      return null;
    }

    const currentStep =
      evaluation.visibleSteps[installDialog.fomodStepIndex] ??
      evaluation.visibleSteps[0];
    const visibleStepCount = evaluation.visibleSteps.length;
    const canMoveNext = installDialog.fomodStepIndex < visibleStepCount - 1;
    const stepOptions = currentStep?.groups.flatMap((group) => group.options) ?? [];
    const activeOption =
      stepOptions.find((option) => option.option.id === installDialog.activeFomodOptionId) ?? null;
    const detailsOption =
      activeOption ?? stepOptions.find((option) => option.isSelected) ?? stepOptions[0] ?? null;
    const previewImage =
      detailsOption?.option.imagePath || installDialog.fomodInstaller.moduleImagePath || '';

    return (
      <div className="install-fomod-wizard">
        <nav className="install-step-ribbon" aria-label="FOMOD steps">
          {evaluation.visibleSteps.map((step, index) => (
            <button
              key={`${step.stepIndex}:${step.stepName}`}
              type="button"
              data-active={index === installDialog.fomodStepIndex}
              data-complete={index < installDialog.fomodStepIndex && step.isSelectionValid}
              onClick={() => {
                if (index <= installDialog.fomodStepIndex) {
                  onPatch({ fomodStepIndex: index, validationMessage: null });
                }
              }}
            >
              <span>{step.visibleNumber}</span>
              <strong>{step.stepName}</strong>
            </button>
          ))}
        </nav>

        <div className="install-fomod-body">
          <section className="install-fomod-options">
            <div className="install-section-heading">
              <div>
                <p className="eyebrow">FOMOD</p>
                <h3>{currentStep?.stepName ?? 'Options'}</h3>
              </div>
              {installDialog.fomodInstaller.hasPreviousSelection ? (
                <button
                  className="tool-button"
                  type="button"
                  onClick={() =>
                    onPatch({
                      selectedFomodOptionIds: previousFomodSelection(installDialog.fomodInstaller!),
                      fomodStepIndex: 0,
                      activeFomodOptionId: null,
                      validationMessage: null
                    })
                  }
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Previous choices
                </button>
              ) : null}
            </div>

            {installDialog.validationMessage ? (
              <div className="install-validation" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{installDialog.validationMessage}</span>
              </div>
            ) : null}

            <div className="fomod-group-list">
              {currentStep?.groups.map((group) => (
                <section
                  key={group.group.id || group.group.name}
                  className="fomod-group"
                  data-invalid={!group.isSelectionValid}
                >
                  <header>
                    <strong>{group.group.name || 'Options'}</strong>
                    <span>{fomodGroupTypeLabel(group.group.type || 'SelectAny')}</span>
                  </header>
                  <div className="fomod-options">
                    {group.options.map((option) => {
                      const isRadio =
                        group.group.type === 'SelectExactlyOne' ||
                        group.group.type === 'SelectAtMostOne';
                      return (
                        <label
                          key={option.option.id || option.option.name}
                          className="fomod-option"
                          data-selected={option.isSelected}
                          data-disabled={!option.canToggle}
                          data-highlighted={detailsOption?.option.id === option.option.id}
                          onMouseEnter={() =>
                            onPatch({ activeFomodOptionId: option.option.id })
                          }
                          onFocus={() =>
                            onPatch({ activeFomodOptionId: option.option.id })
                          }
                        >
                          <input
                            type={isRadio ? 'radio' : 'checkbox'}
                            name={group.group.id || group.group.name}
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
                          <span className="fomod-option__thumb" aria-hidden="true">
                            {option.option.imagePath ? (
                              <img src={option.option.imagePath} alt="" />
                            ) : null}
                          </span>
                          <span className="fomod-option__text">
                            <strong>{option.option.name || 'Option'}</strong>
                            <small>
                              {option.effectiveType}
                              {option.wasPreviouslySelected ? ' · previous' : ''}
                            </small>
                          </span>
                          {option.isSelected ? <CheckCircle2 size={15} aria-hidden="true" /> : null}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <aside className="install-fomod-preview" aria-label="FOMOD option details">
            <div className="install-fomod-preview__image">
              {previewImage ? <img src={previewImage} alt="" /> : <span>option</span>}
            </div>
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
          <div className="install-step-count" aria-label={`Step ${installDialog.fomodStepIndex + 1} of ${visibleStepCount}`}>
            <span>
              Step {installDialog.fomodStepIndex + 1} of {visibleStepCount}
            </span>
            <div aria-hidden="true">
              {evaluation.visibleSteps.map((step, index) => (
                <i
                  key={`${step.stepIndex}:dot`}
                  data-active={index === installDialog.fomodStepIndex}
                  data-complete={index < installDialog.fomodStepIndex}
                />
              ))}
            </div>
          </div>
          <div className="install-dialog-action-group">
            <button
              className="tool-button"
              type="button"
              disabled={installDialog.fomodStepIndex === 0}
              onClick={() => onMoveFomodStep(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Previous
            </button>
            <button
              className="primary-button"
              type="button"
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
                  Review install
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
            aria-label={`Mod name for ${installTitle}`}
            value={installDialog.modName}
            onChange={(event) =>
              onPatch({
                modName: event.target.value,
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
          <button type="button" onClick={() => onResolveExistingMod(1)}>
            <strong>Заменить</strong>
            <span>Полностью заменяет мод.</span>
          </button>
          <button type="button" onClick={() => onResolveExistingMod(2)}>
            <strong>Объединить</strong>
            <span>Перезаписывает только файлы с одинаковыми названиями.</span>
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
    'Installing mod';
  const dialogAriaLabel =
    installDialog.phase === 'installing'
      ? `Installing ${dialogTitle}`
      : `Install ${dialogTitle}`;

  return (
    <div className="install-modal-backdrop" role="presentation">
      <section
        className="install-dialog"
        data-phase={installDialog.phase}
        role="dialog"
        aria-modal="true"
        aria-label={dialogAriaLabel}
      >
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
            disabled={installDialog.phase === 'installing'}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="install-dialog-body">
          {installDialog.phase === 'installing' ? (
            <div className="install-progress" role="status">
              <RefreshCw size={18} aria-hidden="true" />
              <strong>Installing mod</strong>
              <span>{shortPath(installDialog.source.sourcePath)}</span>
            </div>
          ) : null}
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
                  onPatch({ phase: 'details' });
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
                  disabled={Boolean(validateInstallModName(installDialog.modName))}
                  onClick={onSubmitInstallOptions}
                >
                  <Play size={16} aria-hidden="true" />
                  Установить
                </button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
