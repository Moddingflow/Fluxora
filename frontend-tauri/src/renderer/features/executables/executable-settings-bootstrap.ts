import type { FluxoraExecutable } from '../../../shared/fluxora-api';

export interface ExecutableSettingsBootstrap {
  buildName: string;
  configPath: string;
  executables: FluxoraExecutable[];
  selectedExecutableId: string | null;
}

const storagePrefix = 'fluxora.executable-settings.bootstrap.';
const storageKey = (configPath: string): string =>
  `${storagePrefix}${encodeURIComponent(configPath)}`;

export const writeExecutableSettingsBootstrap = (
  bootstrap: ExecutableSettingsBootstrap
): void => {
  try {
    window.localStorage.setItem(storageKey(bootstrap.configPath), JSON.stringify(bootstrap));
  } catch {
    // Bootstrap is only a first-frame optimization. Native loading remains authoritative.
  }
};

export const readExecutableSettingsBootstrap = (
  configPath: string
): ExecutableSettingsBootstrap | null => {
  if (!configPath) {
    return null;
  }
  const key = storageKey(configPath);
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ExecutableSettingsBootstrap>;
    return parsed.configPath === configPath && Array.isArray(parsed.executables)
      ? {
          buildName: typeof parsed.buildName === 'string' ? parsed.buildName : '',
          configPath,
          executables: parsed.executables,
          selectedExecutableId:
            typeof parsed.selectedExecutableId === 'string'
              ? parsed.selectedExecutableId
              : null
        }
      : null;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
};
