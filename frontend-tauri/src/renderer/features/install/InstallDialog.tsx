import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Play,
  RefreshCw,
  X
} from '../../design-system/icons/lucide-compat';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import installModIcon from '../../../../../Icons/package-plus.svg';
import { Skeleton } from '../../design-system';
import {
  normalizeInstallModName,
  toggleFomodOption,
  updateFomodManualDecisions,
  validateInstallModName,
  type EvaluatedFomodWizard,
  type InstallModOrderPlacement,
  type InstallSource,
  type PlacementOverrideMap
} from '../../install-workspace-state';
import type { InstallNameSource } from './install-name-state';
import { InstallPlacementEditor } from './InstallPlacementEditor';
import { placementAssessmentMessage } from './install-placement-editor-state';
import type {
  FluxoraContentLayoutPreview,
  FluxoraExistingModInstallMode,
  FluxoraFomodDecisionEvidence,
  FluxoraFomodInstaller,
  FluxoraFomodOptionDecision,
  FluxoraInstallPlan,
  FluxoraPlacementEditsV2
} from '../../../shared/fluxora-api';
import { translateForLanguage, type TranslationKey } from '../../../localization';

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
  manualFomodDecisions?: { optionId: string; selected: boolean }[];
  isRecalculatingFomod?: boolean;
  fomodStepIndex: number;
  activeFomodOptionId: string | null;
  layoutPreview: FluxoraContentLayoutPreview | null;
  installPlan: FluxoraInstallPlan | null;
  modName: string;
  modNameSource: InstallNameSource;
  modOrderPlacement: InstallModOrderPlacement | null;
  existingModMode: FluxoraExistingModInstallMode;
  placementOverrides: PlacementOverrideMap;
  placementEdits: FluxoraPlacementEditsV2;
  placementValidationPending: boolean;
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
  language?: string;
  onArchiveTreeScrollTopChange: (scrollTop: number) => void;
  onClose: () => void;
  onContinueFromFomod: () => void;
  onMoveFomodStep: (direction: 1 | -1) => void;
  onOpenDetails: () => void;
  onPatch: (patch: Partial<InstallDialogState>) => void;
  onPlacementEditsChange?: (edits: FluxoraPlacementEditsV2) => void;
  onRecalculateFomod: () => void;
  onResetFomod: () => void;
  onResolveExistingMod: (decision: 1 | 2 | 'installNew') => void;
  onSubmitInstallOptions: () => void;
}

type InstallIconStyle = CSSProperties & { '--install-icon': string };
type InstallTranslate = (
  key: TranslationKey,
  variables?: Record<string, string | number>
) => string;

const fomodEvidenceText = (
  evidence: FluxoraFomodDecisionEvidence,
  t: InstallTranslate
): string => {
  const owner = evidence.sourceName ? ` (${evidence.sourceName})` : '';
  switch (evidence.code) {
    case 'profile.file.match':
      return evidence.actual === 'Active'
        ? t('install.evidence.fileActive', { subject: evidence.subject, owner })
        : t('install.evidence.fileState', {
            subject: evidence.subject,
            actual: evidence.actual || t('install.evidence.stateUnknown'),
            owner
          });
    case 'fomod.flag.match':
      return t('install.evidence.flagMatch', {
        subject: evidence.subject,
        expected: evidence.expected
      });
    case 'profile.version.match':
      return t('install.evidence.versionMatch', {
        subject: evidence.subject,
        actual: evidence.actual,
        expected: evidence.expected
      });
    case 'tes4.master.active':
      return t('install.evidence.masterActive', { subject: evidence.subject, owner });
    case 'tes4.master.provided':
      return t('install.evidence.masterProvided', {
        subject: evidence.subject,
        source: evidence.sourceName
      });
    case 'tes4.master.inactive':
      return t('install.evidence.masterInactive', { subject: evidence.subject, owner });
    case 'tes4.master.missing':
      return t('install.evidence.masterMissing', { subject: evidence.subject });
    case 'tes4.master.providerNotSelected':
      return t('install.evidence.masterNotSelected', { subject: evidence.subject });
    default:
      return t('install.evidence.condition', {
        subject: evidence.subject || t('install.evidence.conditionFallback'),
        actual: evidence.actual || evidence.expected || evidence.code
      });
  }
};

const fomodReasonText = (
  decision: FluxoraFomodOptionDecision | null,
  t: InstallTranslate
): string[] => {
  if (!decision) {
    return [t('install.reason.none')];
  }

  const reasons = decision.reasonCodes.map((reason) => {
    switch (reason) {
      case 'manual.session':
        return t('install.reason.manual');
      case 'memory.contextual':
      case 'memory.global':
      case 'memory.v1WeakHint':
        return t('install.reason.memory');
      case 'author.recommended':
        return t('install.reason.recommended');
      case 'author.optional':
        return t('install.reason.optional');
      case 'profile.exactRecommendation':
        return t('install.reason.profileMatch');
      case 'tes4.masters.satisfied':
        return t('install.reason.mastersSatisfied');
      case 'fomod.required':
      case 'fomod.selectAll':
        return t('install.reason.required');
      case 'fomod.notUsable':
        return t('install.reason.notUsable');
      case 'dependency.cycle':
        return t('install.reason.cycle');
      case 'dependency.unknown':
        return t('install.reason.dependencyUnknown');
      case 'group.ambiguous':
        return t('install.reason.ambiguous');
      case 'tes4.reviewRequired':
      case 'tes4.masterUnavailable':
        return t('install.reason.masterReview');
      default:
        return reason || t('install.reason.default');
    }
  });
  return [...reasons, ...decision.evidence.map((evidence) => fomodEvidenceText(evidence, t))];
};

const fomodWarningText = (warning: string, t: InstallTranslate): string => {
  switch (warning) {
    case 'moduleDependencies.unknown':
      return t('install.warning.dependenciesUnknown');
    case 'moduleDependencies.unsatisfied':
      return t('install.warning.dependenciesUnsatisfied');
    case 'autoselect.unavailable':
      return t('install.warning.autoUnavailable');
    default:
      return t('install.warning.generic');
  }
};

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
  language = 'en-US',
  onArchiveTreeScrollTopChange,
  onClose,
  onContinueFromFomod,
  onMoveFomodStep,
  onOpenDetails,
  onPatch,
  onPlacementEditsChange = () => undefined,
  onRecalculateFomod,
  onResetFomod,
  onResolveExistingMod,
  onSubmitInstallOptions
}: InstallDialogProps) {
  const t: InstallTranslate = (key, variables) =>
    translateForLanguage(language, key, variables);
  const modNameInputRef = useRef<HTMLInputElement>(null);
  const modNameSelectionRef = useRef<{
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
  }>({ start: 0, end: 0, direction: 'none' });
  const modNameInputFocusedRef = useRef(false);
  const fomodRecalculateButtonRef = useRef<HTMLButtonElement>(null);
  const fomodResetButtonRef = useRef<HTMLButtonElement>(null);
  const fomodFinalActionButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFomodFocusRef = useRef<{
    action: 'recalculate' | 'reset' | 'install';
    operationId: string;
  } | null>(null);

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

  useLayoutEffect(() => {
    const pending = pendingFomodFocusRef.current;
    if (!pending || !installDialog) {
      return;
    }
    if (pending.operationId !== installDialog.operationId) {
      pendingFomodFocusRef.current = null;
      return;
    }
    if (
      installDialog.phase !== 'fomod' ||
      installDialog.isRecalculatingFomod ||
      installDialog.isSubmitting
    ) {
      return;
    }

    const target = pending.action === 'recalculate'
      ? fomodRecalculateButtonRef.current
      : pending.action === 'reset'
        ? fomodResetButtonRef.current
        : fomodFinalActionButtonRef.current;
    if (target) {
      target.focus({ preventScroll: true });
      pendingFomodFocusRef.current = null;
    }
  }, [
    installDialog?.operationId,
    installDialog?.phase,
    installDialog?.isRecalculatingFomod,
    installDialog?.isSubmitting,
    installDialog?.fomodStepIndex
  ]);

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
      <nav className="install-step-sidebar" aria-label={t('install.fomod.stepsAria')}>
        <header className="install-step-sidebar__header">
          <strong>{t('install.fomod.steps')}</strong>
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
          {t('install.fomod.stepCounter', {
            current: currentStepIndex + 1,
            total: evaluation.visibleSteps.length
          })}
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
    const autoSelection = installDialog.fomodInstaller.autoSelection;
    const profileContext = installDialog.fomodInstaller.profileContext;
    const decisions = new Map(
      (autoSelection?.decisions ?? []).map((decision) => [decision.optionId, decision])
    );
    const manualOptionIds = new Set(
      (installDialog.manualFomodDecisions ?? []).map((decision) => decision.optionId)
    );
    const unresolvedOptionIds = new Set(
      (autoSelection?.unresolvedGroups ?? []).flatMap((group) => group.optionIds)
    );
    const detailsDecision = detailsOption ? decisions.get(detailsOption.option.id) ?? null : null;
    const detailsReasons = fomodReasonText(detailsDecision, t);
    const detailsReasonTitle = detailsOption?.isSelected
      ? t('install.fomod.whySelected')
      : detailsDecision?.action === 'manual'
        ? t('install.fomod.whyManual')
        : t('install.fomod.whyNotSelected');
    const autoSelectionAvailable = profileContext?.autoSelectionAvailable !== false && Boolean(autoSelection);
    const selectionOriginLabel = installDialog.fomodInstaller.selectionOrigin === 'restored'
      ? t('install.fomod.restored')
      : t('install.fomod.recalculated');
    const summaryText = autoSelectionAvailable
      ? t('install.fomod.summary', {
          origin: selectionOriginLabel,
          selected: evaluation.selectedOptionIds.length,
          unresolved: autoSelection?.unresolvedGroups.length ?? 0
        })
      : profileContext?.unavailableReason
        ? t('install.fomod.autoUnavailableReason', { reason: profileContext.unavailableReason })
        : t('install.fomod.autoUnavailable');

    return (
      <div className="install-fomod-wizard">
        <div className="fomod-smart-select-bar">
          <div className="fomod-smart-select" aria-live="polite">
            <span role="status">{summaryText}</span>
            <div className="fomod-smart-select__actions">
              <button
                ref={fomodRecalculateButtonRef}
                className="tool-button"
                type="button"
                disabled={installDialog.isSubmitting || installDialog.isRecalculatingFomod}
                onClick={() => {
                  pendingFomodFocusRef.current = {
                    action: 'recalculate',
                    operationId: installDialog.operationId
                  };
                  onRecalculateFomod();
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {installDialog.isRecalculatingFomod
                  ? t('install.fomod.recalculating')
                  : t('install.fomod.recalculate')}
              </button>
              <button
                ref={fomodResetButtonRef}
                className="tool-button"
                type="button"
                disabled={installDialog.isSubmitting || installDialog.isRecalculatingFomod}
                onClick={() => {
                  pendingFomodFocusRef.current = {
                    action: 'reset',
                    operationId: installDialog.operationId
                  };
                  onResetFomod();
                }}
              >
                {t('install.fomod.resetAuto')}
              </button>
            </div>
          </div>
          {autoSelection?.installBlocked ? (
            <div className="install-validation" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{t('install.warning.dependenciesUnsatisfied')}</span>
            </div>
          ) : autoSelection?.warnings.length ? (
            <div className="fomod-smart-select__warning" role="status">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{fomodWarningText(autoSelection.warnings[0], t)}</span>
            </div>
          ) : null}
        </div>
        <div className="install-fomod-body">
          <section className="install-fomod-options">
            <div className="install-section-heading">
              <h3>{currentStep?.stepName ?? t('install.fomod.options')}</h3>
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
                      <strong>{group.group.name || t('install.fomod.options')}</strong>
                    </header>
                    <div className="fomod-options">
                      {group.options.map((option, optionIndex) => {
                        const isRadio =
                          group.group.type === 'SelectExactlyOne' ||
                          group.group.type === 'SelectAtMostOne';
                        const decision = decisions.get(option.option.id) ?? null;
                        const hasMasterWarning = Boolean(
                          decision?.reasonCodes.some((reason) =>
                            ['tes4.reviewRequired', 'tes4.masterUnavailable'].includes(reason)
                          ) ||
                          decision?.evidence.some((evidence) =>
                            ['tes4.master.inactive', 'tes4.master.missing', 'tes4.master.providerNotSelected'].includes(evidence.code)
                          )
                        );
                        const optionStatus = manualOptionIds.has(option.option.id)
                          ? t('install.fomod.status.manual')
                          : hasMasterWarning
                            ? t('install.fomod.status.masterWarning')
                            : decision?.action === 'manual' || unresolvedOptionIds.has(option.option.id)
                              ? t('install.fomod.status.choiceNeeded')
                              : option.isSelected && (decision?.action === 'select' || decision?.action === 'locked')
                                ? t('install.fomod.status.autoSelected')
                                : decision?.action === 'locked'
                                  ? t('install.fomod.status.locked')
                                  : decision
                                    ? t('install.fomod.status.autoNotSelected')
                                    : '';
                        const statusId = `${groupIdentity}-option-${optionIndex}-status`;
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
                                className={isRadio ? undefined : 'flx-checkbox__native'}
                                type={isRadio ? 'radio' : 'checkbox'}
                                name={groupIdentity}
                                checked={option.isSelected}
                                disabled={!option.canToggle}
                                aria-describedby={optionStatus ? statusId : undefined}
                                onChange={(event) => {
                                  const selectedFomodOptionIds = toggleFomodOption(
                                    installDialog.fomodInstaller!,
                                    installDialog.selectedFomodOptionIds,
                                    option.option.id,
                                    event.target.checked
                                  );
                                  onPatch({
                                    selectedFomodOptionIds,
                                    manualFomodDecisions: updateFomodManualDecisions(
                                      installDialog.fomodInstaller!,
                                      installDialog.manualFomodDecisions ?? [],
                                      selectedFomodOptionIds,
                                      option.option.id
                                    ),
                                    activeFomodOptionId: option.option.id,
                                    validationMessage: null
                                  });
                                }}
                              />
                              {!isRadio ? (
                                <span aria-hidden="true" className="flx-checkbox__box" />
                              ) : null}
                            </span>
                            <FomodOptionImage imagePath={option.option.imagePath} />
                            <span className="fomod-option__text">
                              <strong>{option.option.name || t('install.fomod.option')}</strong>
                              <small>{option.effectiveType}</small>
                              {option.wasPreviouslySelected ? (
                                <small className="fomod-option__previous">{t('install.fomod.previouslySelected')}</small>
                              ) : null}
                              {optionStatus ? (
                                <small
                                  id={statusId}
                                  className="fomod-option__smart-status"
                                  data-warning={hasMasterWarning}
                                >
                                  {hasMasterWarning ? <AlertTriangle size={12} aria-hidden="true" /> : null}
                                  {optionStatus}
                                </small>
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

          <aside className="install-fomod-preview" aria-label={t('install.fomod.detailsAria')}>
            <FomodPreviewImage imagePath={previewImage} />
            <div className="install-fomod-preview__copy">
              <p className="eyebrow">{activeOption
                ? t('install.fomod.optionDetails')
                : t('install.fomod.currentChoice')}</p>
              <strong>{detailsOption?.option.name ?? installDialog.fomodInstaller.moduleName}</strong>
              <span>
                {detailsOption?.option.description ||
                  installDialog.fomodInstaller.moduleVersion ||
                  t('install.fomod.noDescription')}
              </span>
              <section className="fomod-selection-reasons" aria-live="polite">
                <strong>{detailsReasonTitle}</strong>
                <ul>
                  {detailsReasons.map((reason, index) => (
                    <li key={`${detailsOption?.option.id ?? 'module'}:${index}`}>{reason}</li>
                  ))}
                </ul>
              </section>
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
              {t('install.previous')}
            </button>
            <button
              ref={fomodFinalActionButtonRef}
              className="primary-button"
              type="button"
              disabled={installDialog.isSubmitting || autoSelection?.installBlocked === true}
              onClick={() => {
                if (canMoveNext) {
                  onMoveFomodStep(1);
                  return;
                }
                pendingFomodFocusRef.current = {
                  action: 'install',
                  operationId: installDialog.operationId
                };
                onContinueFromFomod();
              }}
            >
              {canMoveNext ? (
                <>
                  {t('install.next')}
                  <ChevronRight size={16} aria-hidden="true" />
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {installDialog.isSubmitting ? t('install.preparing') : t('install.action')}
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    );
  };

  const renderInstallOptions = () => {
    const validation = installDialog.validationMessage ??
      validateInstallModName(installDialog.modName, language);
    const installTitle =
      normalizeInstallModName(installDialog.modName) ||
      installDialog.source.displayName ||
      installDialog.source.fileName;

    return (
      <div className="install-simple">
        <label className="field install-name-field">
          <span>{t('install.modName')}</span>
          <input
            ref={modNameInputRef}
            aria-label={t('install.modNameFor', { name: installTitle })}
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
    <div
      className="install-simple install-detecting-skeleton"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{t('install.detecting')}</span>
      <div className="field install-name-field install-detecting-skeleton__field" aria-hidden="true">
        <Skeleton className="install-detecting-skeleton__label" />
        <Skeleton className="install-detecting-skeleton__input" />
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
            <strong>{t('install.conflict.title')}</strong>
            <span>{conflictName}</span>
          </div>
        </section>
        <div className="install-existing-mod__choices" aria-label={t('install.conflict.aria')}>
          <button
            type="button"
            disabled={installDialog.isSubmitting}
            onClick={() => onResolveExistingMod(1)}
          >
            <strong>{t('install.conflict.replace')}</strong>
            <span>{t('install.conflict.replaceDetail')}</span>
          </button>
          <button
            type="button"
            disabled={installDialog.isSubmitting}
            onClick={() => onResolveExistingMod(2)}
          >
            <strong>{t('install.conflict.merge')}</strong>
            <span>{t('install.conflict.mergeDetail')}</span>
          </button>
          <button
            type="button"
            disabled={installDialog.isSubmitting}
            onClick={() => onResolveExistingMod('installNew')}
          >
            <strong>{t('install.conflict.separate')}</strong>
            <span>{t('install.conflict.separateDetail')}</span>
          </button>
        </div>
      </div>
    );
  };

  const renderInstallDetails = () => {
    const preview = installDialog.layoutPreview;
    return preview ? (
      <InstallPlacementEditor
        key={installDialog.operationId}
        preview={preview}
        edits={installDialog.placementEdits}
        language={language}
        validationPending={installDialog.placementValidationPending}
        disabled={installDialog.isSubmitting}
        onEditsChange={onPlacementEditsChange}
      />
    ) : null;
  };

  const renderPlacementAssessment = () => {
    const preview = installDialog.layoutPreview;
    const assessment = preview?.assessment;
    const message = preview ? placementAssessmentMessage(preview, language) : null;
    if (!preview || !assessment || !message) {
      return <span />;
    }
    const compatible = assessment.status === 'ready';
    return (
      <div className="install-placement-assessment" data-status={compatible ? 'ready' : 'blocked'} role="status" aria-live="polite">
        {compatible ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
        <span>{message}</span>
      </div>
    );
  };

  const dialogTitle =
    normalizeInstallModName(installDialog.modName) ||
    installDialog.source.displayName ||
    installDialog.source.fileName ||
    t('install.title');
  const dialogAriaLabel =
    installDialog.phase === 'detecting'
      ? t('install.title')
      : t('install.namedAria', { name: dialogTitle });

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
              <strong>{t('install.title')}</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              title={t('install.closeWindow')}
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
                <strong>{t('install.errorTitle')}</strong>
                <span>{t('install.errorGeneric')}</span>
              </div>
            ) : null}
          </div>

          {installDialog.phase === 'detecting' ||
          installDialog.phase === 'options' ||
          installDialog.phase === 'details' ||
          installDialog.phase === 'error' ? (
            <footer
              className={
                installDialog.phase === 'detecting'
                  ? 'install-dialog-actions install-dialog-actions--detecting'
                  : 'install-dialog-actions'
              }
            >
              {installDialog.phase === 'detecting' ? (
                <Skeleton
                  className="install-detecting-skeleton__action install-detecting-skeleton__action--details"
                />
              ) : installDialog.phase === 'options' ? (
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => {
                    onArchiveTreeScrollTopChange(0);
                    onOpenDetails();
                  }}
                >
                  <FolderTree size={15} aria-hidden="true" />
                  {t('install.details')}
                </button>
              ) : installDialog.phase === 'details' ? (
                renderPlacementAssessment()
              ) : (
                <span />
              )}
              <div className="install-dialog-action-group">
                {installDialog.phase === 'detecting' ? (
                  <Skeleton
                    className="install-detecting-skeleton__action install-detecting-skeleton__action--install"
                  />
                ) : installDialog.phase === 'error' ? (
                  <button
                    className="tool-button"
                    type="button"
                    onClick={onClose}
                  >
                    {t('install.close')}
                  </button>
                ) : null}
                {installDialog.phase === 'options' ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      installDialog.isSubmitting ||
                      Boolean(validateInstallModName(installDialog.modName, language))
                    }
                    onClick={onSubmitInstallOptions}
                  >
                    <Play size={16} aria-hidden="true" />
                    {installDialog.isSubmitting ? t('install.preparing') : t('install.action')}
                  </button>
                ) : null}
                {installDialog.phase === 'details' ? (
                  <>
                    <button
                      className="tool-button"
                      type="button"
                      disabled={installDialog.isSubmitting}
                      onClick={() => onPatch({ phase: 'options', validationMessage: null })}
                    >
                      <ChevronLeft size={15} aria-hidden="true" />
                      {t('install.back')}
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={
                        installDialog.isSubmitting ||
                        installDialog.placementValidationPending ||
                        Boolean(installDialog.validationMessage) ||
                        !installDialog.layoutPreview?.canInstall ||
                        Boolean(validateInstallModName(installDialog.modName, language))
                      }
                      onClick={onSubmitInstallOptions}
                    >
                      <Play size={16} aria-hidden="true" />
                      {installDialog.isSubmitting ? t('install.preparing') : t('install.action')}
                    </button>
                  </>
                ) : null}
              </div>
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}
