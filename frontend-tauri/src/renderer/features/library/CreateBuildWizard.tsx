import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react';

import {
  Button,
  Icon,
  Input,
  WizardStepper,
  gameTemplateBackgroundFor
} from '../../design-system';
import {
  isProjectDraftStepComplete,
  primaryGameExecutableName,
  type ProjectDraft
} from '../../project-catalog-state';
import type { FluxoraGameTemplate } from '../../../shared/fluxora-api';
import { useLocalization } from '../../../localization/react';

export const CREATE_BUILD_STEPS = [
  { id: 'name', labelKey: 'wizard.step.name.label', hintKey: 'wizard.step.name.hint' },
  { id: 'game', labelKey: 'wizard.step.game.label', hintKey: 'wizard.step.game.hint' },
  { id: 'executable', labelKey: 'wizard.step.executable.label', hintKey: 'wizard.step.executable.hint' },
  { id: 'location', labelKey: 'wizard.step.location.label', hintKey: 'wizard.step.location.hint' }
] as const;

export interface CreateBuildWizardProps {
  activeStepIndex: number;
  busy: boolean;
  draft: ProjectDraft;
  error: string | null;
  furthestStepIndex: number;
  onBack: () => void;
  onBrowseExecutable: () => Promise<boolean>;
  onBrowseInstallRoot: () => void | Promise<void>;
  onCancel: () => void;
  onChangeInstallRoot: (value: string) => void;
  onChangeName: (value: string) => void;
  onCreate: () => void | Promise<void>;
  onNext: () => void;
  onSelectStep: (stepIndex: number) => void;
  onSelectTemplate: (templateId: string) => void;
  previewBusy: boolean;
  previewDirectory: string;
  selectedTemplate: FluxoraGameTemplate | null;
  templates: FluxoraGameTemplate[];
}

const templateLabel = (template: FluxoraGameTemplate): string =>
  template.displayName.trim() || template.gameName.trim() || template.id;

export function CreateBuildWizard({
  activeStepIndex,
  busy,
  draft,
  error,
  furthestStepIndex,
  onBack,
  onBrowseExecutable,
  onBrowseInstallRoot,
  onCancel,
  onChangeInstallRoot,
  onChangeName,
  onCreate,
  onNext,
  onSelectStep,
  onSelectTemplate,
  previewBusy,
  previewDirectory,
  selectedTemplate,
  templates
}: CreateBuildWizardProps) {
  const { t } = useLocalization();
  const localizedSteps = CREATE_BUILD_STEPS.map((step) => ({
    id: step.id,
    label: t(step.labelKey),
    hint: t(step.hintKey)
  }));
  const [templateSearch, setTemplateSearch] = useState('');
  const deferredTemplateSearch = useDeferredValue(templateSearch.trim().toLowerCase());
  const templateButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const formRef = useRef<HTMLFormElement | null>(null);
  const finalStep = activeStepIndex === CREATE_BUILD_STEPS.length - 1;
  const executableName = primaryGameExecutableName(selectedTemplate);
  const visibleTemplates = useMemo(() => {
    if (!deferredTemplateSearch) {
      return templates;
    }

    return templates.filter((template) =>
      `${templateLabel(template)} ${template.id} ${template.uiTemplateId}`
        .toLowerCase()
        .includes(deferredTemplateSearch)
    );
  }, [deferredTemplateSearch, templates]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (finalStep) {
      void onCreate();
      return;
    }

    onNext();
  };

  const selectAdjacentTemplate = (
    event: KeyboardEvent<HTMLButtonElement>,
    templateIndex: number
  ) => {
    if (event.key === 'Enter' && draft.templateId === visibleTemplates[templateIndex]?.id) {
      event.preventDefault();
      onNext();
      return;
    }

    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (direction === 0 || visibleTemplates.length < 2) {
      return;
    }

    event.preventDefault();
    const nextIndex =
      (templateIndex + direction + visibleTemplates.length) % visibleTemplates.length;
    const nextTemplate = visibleTemplates[nextIndex];
    onSelectTemplate(nextTemplate.id);
    templateButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <form className="create-build-wizard" onSubmit={handleSubmit} ref={formRef}>
      <aside className="create-build-wizard__rail">
        <header className="create-build-wizard__identity">
          <span aria-hidden="true" className="create-build-wizard__identity-mark">
            <Icon name="plus" size={16} strokeWidth={2} />
          </span>
          <div>
            <strong>{t('wizard.newBuild')}</strong>
            <span>{t('wizard.configureLocally')}</span>
          </div>
        </header>

        <WizardStepper
          activeStepId={localizedSteps[activeStepIndex].id}
          ariaLabel={t('wizard.stepsAria')}
          onStepSelect={(stepId) => {
            const nextIndex = localizedSteps.findIndex((step) => step.id === stepId);
            if (nextIndex >= 0) {
              onSelectStep(nextIndex);
            }
          }}
          steps={localizedSteps.map((step, index) => {
            const priorStepsComplete = CREATE_BUILD_STEPS.slice(0, index).every((_, priorIndex) =>
              isProjectDraftStepComplete(draft, priorIndex, selectedTemplate)
            );

            return {
              ...step,
              disabled: index > furthestStepIndex || !priorStepsComplete,
              state:
                index < furthestStepIndex &&
                isProjectDraftStepComplete(draft, index, selectedTemplate)
                  ? 'complete'
                  : 'pending'
            };
          })}
        />
      </aside>

      <section className="create-build-wizard__main" aria-labelledby="create-build-title">
        <div className="create-build-wizard__scroll">
          <div className="create-build-wizard__content">
            <header className="create-build-wizard__header">
              <span>
                {t('wizard.stepCounter', {
                  current: activeStepIndex + 1,
                  total: CREATE_BUILD_STEPS.length
                })}
              </span>
              <h1 id="create-build-title">{localizedSteps[activeStepIndex].label}</h1>
            </header>

            <div className="create-build-wizard__body">
              {activeStepIndex === 0 ? (
                <div className="create-build-field">
                  <label htmlFor="create-build-name">{t('wizard.nameQuestion')}</label>
                  <Input
                    aria-describedby={error ? 'create-build-error' : undefined}
                    aria-invalid={Boolean(error)}
                    autoFocus
                    id="create-build-name"
                    maxLength={120}
                    onChange={(event) => onChangeName(event.currentTarget.value)}
                    placeholder={t('wizard.namePlaceholder')}
                    spellCheck={false}
                    value={draft.projectName}
                  />
                </div>
              ) : null}

              {activeStepIndex === 1 ? (
                <div className="create-build-template-picker">
                  {templates.length > 6 ? (
                    <div className="create-build-field create-build-template-picker__search">
                      <label htmlFor="create-build-game-search">{t('wizard.findGame')}</label>
                      <Input
                        id="create-build-game-search"
                        leadingIcon={<Icon name="search" size={15} />}
                        onChange={(event) => setTemplateSearch(event.currentTarget.value)}
                        placeholder={t('wizard.searchGames')}
                        value={templateSearch}
                      />
                    </div>
                  ) : null}

                  <div
                    aria-describedby={error ? 'create-build-error' : undefined}
                    aria-label={t('wizard.templatesAria')}
                    className="create-build-template-grid"
                    role="radiogroup"
                  >
                    {visibleTemplates.map((template, index) => {
                      const background = gameTemplateBackgroundFor(template);
                      const selected = draft.templateId === template.id;

                      return (
                        <button
                          aria-checked={selected}
                          className="create-build-template"
                          data-selected={selected || undefined}
                          key={template.id}
                          onClick={() => onSelectTemplate(template.id)}
                          onKeyDown={(event) => selectAdjacentTemplate(event, index)}
                          ref={(element) => {
                            templateButtonRefs.current[index] = element;
                          }}
                          role="radio"
                          type="button"
                        >
                          {background ? (
                            <img
                              alt=""
                              aria-hidden="true"
                              height={background.height}
                              src={background.src}
                              width={background.width}
                            />
                          ) : (
                            <span aria-hidden="true" className="create-build-template__symbol">
                              {templateLabel(template).slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="create-build-template__shade" aria-hidden="true" />
                          <strong>{templateLabel(template)}</strong>
                          <span aria-hidden="true" className="create-build-template__selection">
                            <Icon name="check" size={14} strokeWidth={2.2} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {activeStepIndex === 2 ? (
                <div className="create-build-field">
                  <label htmlFor="create-build-executable">{t('wizard.officialExecutable')}</label>
                  <p className="create-build-field__help">
                    {t('wizard.executableHelp', {
                      name: executableName ?? t('wizard.primaryExecutable')
                    })}
                  </p>
                  <div className="create-build-path-row">
                    <Input
                      aria-describedby={error ? 'create-build-error' : undefined}
                      aria-invalid={Boolean(error)}
                      id="create-build-executable"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && draft.gamePath) {
                          event.preventDefault();
                          onNext();
                        }
                      }}
                      placeholder={executableName ?? t('wizard.officialExecutablePlaceholder')}
                      readOnly
                      value={draft.gamePath}
                    />
                    <Button
                      disabled={!executableName}
                      iconLeft={<Icon name="folder-open" size={15} />}
                      onClick={() => {
                        void onBrowseExecutable().then((accepted) => {
                          if (accepted) {
                            formRef.current
                              ?.querySelector<HTMLButtonElement>('button[type="submit"]')
                              ?.focus();
                          }
                        });
                      }}
                      variant="secondary"
                    >
                      {t('wizard.chooseNamedExecutable', {
                        name: executableName ?? t('wizard.executableGeneric')
                      })}
                    </Button>
                  </div>
                </div>
              ) : null}

              {activeStepIndex === 3 ? (
                <div className="create-build-location">
                  <div className="create-build-field">
                    <label htmlFor="create-build-location">{t('wizard.buildsFolder')}</label>
                    <p className="create-build-field__help">
                      {t('wizard.buildsFolderHelp')}
                    </p>
                    <div className="create-build-path-row">
                      <Input
                        aria-describedby={error ? 'create-build-error' : undefined}
                        aria-invalid={Boolean(error)}
                        id="create-build-location"
                        onChange={(event) => onChangeInstallRoot(event.currentTarget.value)}
                        spellCheck={false}
                        value={draft.installRootDirectory}
                      />
                      <Button
                        iconLeft={<Icon name="folder-open" size={15} />}
                        onClick={() => void onBrowseInstallRoot()}
                        variant="secondary"
                      >
                        {t('wizard.browse')}
                      </Button>
                    </div>
                  </div>

                  <div className="create-build-preview" data-loading={previewBusy || undefined}>
                    <span>{t('wizard.buildDirectory')}</span>
                    <strong>
                      {previewBusy
                        ? t('wizard.calculating')
                        : previewDirectory || t('wizard.waitingValidName')}
                    </strong>
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="create-build-wizard__error" id="create-build-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="create-build-wizard__footer">
          <Button onClick={onCancel} variant="ghost">
            {t('wizard.cancel')}
          </Button>
          <div>
            <Button disabled={activeStepIndex === 0} onClick={onBack} variant="secondary">
              {t('wizard.back')}
            </Button>
            <Button
              disabled={busy}
              iconRight={<Icon name={finalStep ? 'check' : 'chevron-right'} size={15} />}
              type="submit"
            >
              {finalStep ? t('wizard.create') : t('wizard.next')}
            </Button>
          </div>
        </footer>
      </section>
    </form>
  );
}
