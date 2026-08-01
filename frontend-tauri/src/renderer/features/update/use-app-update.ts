import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FluxoraApi, FluxoraUpdateStatus } from '../../../shared/fluxora-api';
import { createRendererOperationId } from '../../services/renderer-operation-service';
import type { AppUpdateSettingsViewState, AppUpdateToolbarViewState } from './app-update-state';
import {
  acknowledgeRendererReady,
  appUpdateSettingsView,
  appUpdateToolbarView,
  createAppUpdateCoordinator,
  type AppUpdateCoordinator
} from './app-update-coordinator';
import { createAppUpdateScheduler } from './app-update-scheduler';

export interface UseAppUpdateOptions {
  api: FluxoraApi['updates'];
  enabled: boolean;
  automaticChecks?: boolean;
  acknowledgeRendererHealth?: boolean;
}

export interface UseAppUpdateResult {
  toolbar: AppUpdateToolbarViewState;
  settings: AppUpdateSettingsViewState;
}

interface AppUpdateRendererState {
  status: FluxoraUpdateStatus;
  userInitiated: boolean;
}

const initialState: AppUpdateRendererState = {
  status: { state: 'idle', currentVersion: '' },
  userInitiated: false
};

export const useAppUpdate = ({
  api,
  enabled,
  automaticChecks = true,
  acknowledgeRendererHealth = true
}: UseAppUpdateOptions): UseAppUpdateResult => {
  const [rendererState, setRendererState] = useState<AppUpdateRendererState>(initialState);
  const coordinatorRef = useRef<AppUpdateCoordinator | null>(null);
  const rendererReadySentRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      coordinatorRef.current = null;
      setRendererState(initialState);
      return undefined;
    }

    let cancelled = false;
    const coordinator = createAppUpdateCoordinator({
      api,
      createOperationId: createRendererOperationId,
      onStatus: (status, userInitiated) => setRendererState({ status, userInitiated })
    });
    coordinatorRef.current = coordinator;
    void coordinator.start();
    const scheduler = automaticChecks ? createAppUpdateScheduler({
      check: () => coordinator.check(false),
      scheduleInterval: (listener, intervalMs) => {
        const intervalId = window.setInterval(listener, intervalMs);
        return () => window.clearInterval(intervalId);
      },
      listenForFocus: (listener) => {
        window.addEventListener('focus', listener);
        return () => window.removeEventListener('focus', listener);
      }
    }) : null;
    scheduler?.start();
    if (acknowledgeRendererHealth && !rendererReadySentRef.current) {
      void acknowledgeRendererReady(api, { isCancelled: () => cancelled }).then((acknowledged) => {
        if (acknowledged && !cancelled) rendererReadySentRef.current = true;
      });
    }

    return () => {
      cancelled = true;
      scheduler?.stop();
      coordinator.stop();
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = null;
      }
    };
  }, [acknowledgeRendererHealth, api, automaticChecks, enabled]);

  const check = useCallback(
    () => coordinatorRef.current?.check(true) ?? Promise.resolve(),
    []
  );

  const activate = useCallback(
    () => coordinatorRef.current?.activate() ?? Promise.resolve(),
    []
  );
  const cancel = useCallback(
    () => coordinatorRef.current?.cancel() ?? Promise.resolve(),
    []
  );

  return useMemo(() => ({
    toolbar: appUpdateToolbarView(
      rendererState.status,
      rendererState.userInitiated,
      activate,
      cancel
    ),
    settings: appUpdateSettingsView(rendererState.status, check)
  }), [activate, cancel, check, rendererState]);
};
