import { useCallback, useEffect, useMemo, useState } from 'react';

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
import type { FluxoraGameTemplate } from '../../../shared/fluxora-api';
import { CREATE_BUILD_STEPS } from './CreateBuildWizard';

interface UseCreateBuildWizardOptions {
  bridgeReady: boolean;
  defaultInstallRootDirectory: string;
  templates: FluxoraGameTemplate[];
}

const wizardErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim()
    ? error.message
    : 'The native file picker could not be opened.';

export function useCreateBuildWizard({
  bridgeReady,
  defaultInstallRootDirectory,
  templates
}: UseCreateBuildWizardOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [draft, setDraft] = useState<ProjectDraft>(() => emptyProjectDraft());
  const [error, setError] = useState<string | null>(null);
  const [previewDirectory, setPreviewDirectory] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.templateId) ?? null,
    [draft.templateId, templates]
  );

  const open = useCallback(() => {
    setDraft(emptyProjectDraft(defaultInstallRootDirectory));
    setActiveStepIndex(0);
    setFurthestStepIndex(0);
    setError(null);
    setPreviewDirectory('');
    setPreviewBusy(false);
    setIsOpen(true);
  }, [defaultInstallRootDirectory]);

  const close = useCallback(() => {
    setError(null);
    setIsOpen(false);
  }, []);

  const changeName = useCallback((value: string) => {
    setDraft((current) => ({ ...current, projectName: value }));
    setError(null);
  }, []);

  const selectTemplate = useCallback((templateId: string) => {
    setDraft((current) => ({
      ...current,
      gamePath: current.templateId === templateId ? current.gamePath : '',
      templateId
    }));
    setError(null);
  }, []);

  const changeInstallRoot = useCallback((value: string) => {
    setDraft((current) => ({ ...current, installRootDirectory: value }));
    setError(null);
  }, []);

  const browseExecutable = useCallback(async (): Promise<boolean> => {
    const executableName = primaryGameExecutableName(selectedTemplate);
    if (!selectedTemplate || !executableName) {
      setError('This game template does not declare an official executable.');
      return false;
    }

    try {
      const result = await window.fluxora.dialogs.pickExecutable(
        `Choose ${executableName}`,
        draft.gamePath
      );
      if (result.canceled || !result.path) {
        return false;
      }

      if (!isOfficialGameExecutablePath(selectedTemplate, result.path)) {
        setError(`Select ${executableName}. Other executables cannot be used.`);
        return false;
      }

      setDraft((current) => ({ ...current, gamePath: result.path ?? current.gamePath }));
      setError(null);
      return true;
    } catch (pickerError) {
      setError(wizardErrorMessage(pickerError));
      return false;
    }
  }, [draft.gamePath, selectedTemplate]);

  const browseInstallRoot = useCallback(async () => {
    try {
      const result = await window.fluxora.dialogs.pickFolder(
        'Choose the Fluxora Builds folder',
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
      setError(wizardErrorMessage(pickerError));
    }
  }, [draft.installRootDirectory]);

  const next = useCallback((): boolean => {
    const stepError = projectDraftStepError(draft, activeStepIndex, selectedTemplate);
    if (stepError) {
      setError(stepError);
      return false;
    }

    const nextStepIndex = Math.min(activeStepIndex + 1, CREATE_BUILD_STEPS.length - 1);
    setError(null);
    setActiveStepIndex(nextStepIndex);
    setFurthestStepIndex((current) => Math.max(current, nextStepIndex));
    return true;
  }, [activeStepIndex, draft, selectedTemplate]);

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
        const priorError = projectDraftStepError(draft, index, selectedTemplate);
        if (priorError) {
          setActiveStepIndex(index);
          setError(priorError);
          return;
        }
      }

      setError(null);
      setActiveStepIndex(stepIndex);
    },
    [draft, furthestStepIndex, selectedTemplate]
  );

  const validateAll = useCallback((): boolean => {
    const incompleteStep = firstIncompleteProjectDraftStep(draft, templates);
    if (incompleteStep === null) {
      setError(null);
      return true;
    }

    setActiveStepIndex(incompleteStep);
    setFurthestStepIndex((current) => Math.max(current, incompleteStep));
    setError(projectDraftStepError(draft, incompleteStep, selectedTemplate));
    return false;
  }, [draft, selectedTemplate, templates]);

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
