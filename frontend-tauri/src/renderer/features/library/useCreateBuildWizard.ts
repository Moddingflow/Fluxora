import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  emptyProjectDraft,
  firstIncompleteProjectDraftStep,
  isOfficialGameExecutablePath,
  primaryGameExecutableName,
  projectDraftStepError,
  type ProjectDraft
} from '../../project-catalog-state';
import { previewProjectDirectory } from '../../services/project-catalog-service';
import { createRendererOperationId } from '../../services/renderer-operation-service';
import type {
  FluxoraGameInstallDiscoverySnapshot,
  FluxoraGameTemplate
} from '../../../shared/fluxora-api';
import { CREATE_BUILD_STEPS } from './CreateBuildWizard';
import { useLocalization } from '../../../localization/react';

interface UseCreateBuildWizardOptions {
  bridgeReady: boolean;
  defaultInstallRootDirectory: string;
  gameInstalls: FluxoraGameInstallDiscoverySnapshot;
  templates: FluxoraGameTemplate[];
}

export type GamePathOrigin = 'empty' | 'auto' | 'manual';
export interface GamePathSelection {
  path: string;
  origin: GamePathOrigin;
}

export const discoveredGamePathSelection = (
  templateId: string,
  templates: FluxoraGameTemplate[],
  gameInstalls: FluxoraGameInstallDiscoverySnapshot
): GamePathSelection => {
  const template = templates.find((candidate) => candidate.id === templateId);
  const discovered = gameInstalls.installs.find((candidate) => candidate.templateId === templateId);
  if (
    !template ||
    discovered?.resolution !== 'found' ||
    !discovered.primaryExecutablePath ||
    !isOfficialGameExecutablePath(template, discovered.primaryExecutablePath)
  ) {
    return { path: '', origin: 'empty' };
  }

  return { path: discovered.primaryExecutablePath, origin: 'auto' };
};

export const refreshDiscoveredGamePathSelection = (
  current: GamePathSelection,
  templateId: string,
  templates: FluxoraGameTemplate[],
  gameInstalls: FluxoraGameInstallDiscoverySnapshot
): GamePathSelection =>
  current.origin === 'manual'
    ? current
    : discoveredGamePathSelection(templateId, templates, gameInstalls);

const wizardErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim()
    ? error.message
    : fallback;

export function useCreateBuildWizard({
  bridgeReady,
  defaultInstallRootDirectory,
  gameInstalls,
  templates
}: UseCreateBuildWizardOptions) {
  const { locale, t } = useLocalization();
  const [isOpen, setIsOpen] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [draft, setDraft] = useState<ProjectDraft>(() => emptyProjectDraft());
  const [gamePathOrigin, setGamePathOriginState] = useState<GamePathOrigin>('empty');
  const gamePathOriginRef = useRef<GamePathOrigin>('empty');
  const [error, setError] = useState<string | null>(null);
  const [previewDirectory, setPreviewDirectory] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.templateId) ?? null,
    [draft.templateId, templates]
  );

  const setGamePathOrigin = useCallback((origin: GamePathOrigin) => {
    gamePathOriginRef.current = origin;
    setGamePathOriginState(origin);
  }, []);

  const open = useCallback(() => {
    setDraft(emptyProjectDraft(defaultInstallRootDirectory));
    setGamePathOrigin('empty');
    setActiveStepIndex(0);
    setFurthestStepIndex(0);
    setError(null);
    setPreviewDirectory('');
    setPreviewBusy(false);
    setIsOpen(true);
  }, [defaultInstallRootDirectory, setGamePathOrigin]);

  const close = useCallback(() => {
    setError(null);
    setIsOpen(false);
  }, []);

  const changeName = useCallback((value: string) => {
    setDraft((current) => ({ ...current, projectName: value }));
    setError(null);
  }, []);

  const selectTemplate = useCallback((templateId: string) => {
    if (draft.templateId === templateId) {
      setError(null);
      return;
    }

    const selection = discoveredGamePathSelection(templateId, templates, gameInstalls);
    setDraft((current) => ({ ...current, gamePath: selection.path, templateId }));
    setGamePathOrigin(selection.origin);
    setError(null);
  }, [draft.templateId, gameInstalls, setGamePathOrigin, templates]);

  const changeInstallRoot = useCallback((value: string) => {
    setDraft((current) => ({ ...current, installRootDirectory: value }));
    setError(null);
  }, []);

  const browseExecutable = useCallback(async (): Promise<boolean> => {
    const executableName = primaryGameExecutableName(selectedTemplate);
    if (!selectedTemplate || !executableName) {
      setError(t('wizard.noOfficialExecutable'));
      return false;
    }

    try {
      const result = await window.fluxora.dialogs.pickExecutable(
        t('wizard.chooseExecutable', { name: executableName }),
        draft.gamePath
      );
      if (result.canceled || !result.path) {
        return false;
      }

      if (!isOfficialGameExecutablePath(selectedTemplate, result.path)) {
        setError(t('wizard.invalidExecutable', { name: executableName }));
        return false;
      }

      setDraft((current) => ({ ...current, gamePath: result.path ?? current.gamePath }));
      setGamePathOrigin('manual');
      setError(null);
      return true;
    } catch (pickerError) {
      setError(wizardErrorMessage(pickerError, t('wizard.pickerUnavailable')));
      return false;
    }
  }, [draft.gamePath, selectedTemplate, setGamePathOrigin, t]);

  useEffect(() => {
    if (!isOpen || !draft.templateId || gamePathOriginRef.current === 'manual') {
      return;
    }

    const selection = refreshDiscoveredGamePathSelection(
      { path: draft.gamePath, origin: gamePathOriginRef.current },
      draft.templateId,
      templates,
      gameInstalls
    );
    setDraft((current) => {
      if (current.templateId !== draft.templateId || gamePathOriginRef.current === 'manual') {
        return current;
      }
      return current.gamePath === selection.path
        ? current
        : { ...current, gamePath: selection.path };
    });
    setGamePathOrigin(selection.origin);
  }, [draft.templateId, gameInstalls, isOpen, setGamePathOrigin, templates]);

  const browseInstallRoot = useCallback(async () => {
    try {
      const result = await window.fluxora.dialogs.pickFolder(
        t('wizard.chooseBuildsFolder'),
        draft.installRootDirectory
      );
      if (!result.canceled && result.path) {
        setDraft((current) => ({
          ...current,
          installRootDirectory: result.path ?? current.installRootDirectory
        }));
        setError(null);
      }
    } catch (pickerError) {
      setError(wizardErrorMessage(pickerError, t('wizard.pickerUnavailable')));
    }
  }, [draft.installRootDirectory, t]);

  const next = useCallback((): boolean => {
    const stepError = projectDraftStepError(draft, activeStepIndex, selectedTemplate, locale);
    if (stepError) {
      setError(stepError);
      return false;
    }

    const nextStepIndex = Math.min(activeStepIndex + 1, CREATE_BUILD_STEPS.length - 1);
    setError(null);
    setActiveStepIndex(nextStepIndex);
    setFurthestStepIndex((current) => Math.max(current, nextStepIndex));
    return true;
  }, [activeStepIndex, draft, locale, selectedTemplate]);

  const back = useCallback(() => {
    setError(null);
    setActiveStepIndex((current) => Math.max(0, current - 1));
  }, []);

  const selectStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex < 0 || stepIndex > furthestStepIndex) {
        return;
      }

      for (let index = 0; index < stepIndex; index += 1) {
        const priorError = projectDraftStepError(draft, index, selectedTemplate, locale);
        if (priorError) {
          setActiveStepIndex(index);
          setError(priorError);
          return;
        }
      }

      setError(null);
      setActiveStepIndex(stepIndex);
    },
    [draft, furthestStepIndex, locale, selectedTemplate]
  );

  const validateAll = useCallback((): boolean => {
    const incompleteStep = firstIncompleteProjectDraftStep(draft, templates);
    if (incompleteStep === null) {
      setError(null);
      return true;
    }

    setActiveStepIndex(incompleteStep);
    setFurthestStepIndex((current) => Math.max(current, incompleteStep));
    setError(projectDraftStepError(draft, incompleteStep, selectedTemplate, locale));
    return false;
  }, [draft, locale, selectedTemplate, templates]);

  useEffect(() => {
    if (
      !isOpen ||
      !bridgeReady ||
      !draft.projectName.trim() ||
      !draft.installRootDirectory.trim()
    ) {
      setPreviewDirectory('');
      setPreviewBusy(false);
      return;
    }

    let canceled = false;
    setPreviewBusy(true);
    const timeout = window.setTimeout(() => {
      previewProjectDirectory(
        draft.projectName.trim(),
        draft.installRootDirectory.trim(),
        createRendererOperationId('projects_preview')
      )
        .then(
          (preview) => {
            if (!canceled) {
              setPreviewDirectory(preview.projectDirectory);
            }
          },
          () => {
            if (!canceled) {
              setPreviewDirectory('');
            }
          }
        )
        .finally(() => {
          if (!canceled) {
            setPreviewBusy(false);
          }
        });
    }, 150);

    return () => {
      canceled = true;
      window.clearTimeout(timeout);
    };
  }, [bridgeReady, draft.installRootDirectory, draft.projectName, isOpen]);

  return {
    activeStepIndex,
    back,
    browseExecutable,
    browseInstallRoot,
    changeInstallRoot,
    changeName,
    close,
    draft,
    error,
    furthestStepIndex,
    gamePathOrigin,
    isOpen,
    next,
    open,
    previewBusy,
    previewDirectory,
    selectStep,
    selectTemplate,
    selectedTemplate,
    validateAll
  };
}
