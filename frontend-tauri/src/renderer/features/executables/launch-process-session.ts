import type {
  FluxoraProcessWatchResult,
  OperationRequest
} from '../../../shared/fluxora-api';

const fileNameFromPath = (value: string): string =>
  value.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? '';

const executableStem = (value: string): string => value.replace(/\.exe$/i, '');

export const processDisplayLabel = (displayName: string, executableName: string): string => {
  const executable = fileNameFromPath(executableName);
  const application = displayName.trim() || executableStem(executable);

  if (!executable) {
    return application;
  }
  if (application.localeCompare(executable, undefined, { sensitivity: 'accent' }) === 0) {
    return executable;
  }

  return `${application} (${executable})`;
};

export interface KnownLaunchProcess {
  displayName: string;
  executableName: string;
  processId?: number;
}

export interface ActiveLaunchProcess {
  executableName: string;
  label: string;
  processId: number;
}

interface WatchLaunchProcessSessionOptions {
  activeProcess: FluxoraProcessWatchResult;
  knownProcesses: ReadonlyArray<KnownLaunchProcess>;
  onActiveProcess: (process: ActiveLaunchProcess) => void;
  operationId: string;
  waitForExit: (
    processId: number,
    request?: OperationRequest
  ) => Promise<FluxoraProcessWatchResult>;
}

const normalizedExecutableName = (value: string): string =>
  fileNameFromPath(value).toLocaleLowerCase();

const activeProcessPresentation = (
  watchResult: FluxoraProcessWatchResult,
  knownProcesses: ReadonlyArray<KnownLaunchProcess>
): ActiveLaunchProcess => {
  const processExecutableName = fileNameFromPath(watchResult.processName);
  const knownProcess =
    knownProcesses.find((known) => known.processId === watchResult.processId) ??
    knownProcesses.find(
      (known) =>
        normalizedExecutableName(known.executableName) ===
        normalizedExecutableName(processExecutableName)
  );
  const executableName = fileNameFromPath(
    knownProcess?.executableName || processExecutableName || watchResult.processName
  );

  return {
    executableName,
    label: processDisplayLabel(knownProcess?.displayName ?? '', executableName),
    processId: watchResult.processId
  };
};

export const watchLaunchProcessSession = async ({
  activeProcess,
  knownProcesses,
  onActiveProcess,
  operationId,
  waitForExit
}: WatchLaunchProcessSessionOptions): Promise<FluxoraProcessWatchResult> => {
  let current = activeProcess;

  while (current.state === 'running') {
    onActiveProcess(activeProcessPresentation(current, knownProcesses));
    const next = await waitForExit(current.processId, { operationId });
    if (next.state === 'running' && next.processId === current.processId) {
      throw new Error(`Process watcher returned the same running process ${current.processId}.`);
    }
    current = next;
  }

  return current;
};
