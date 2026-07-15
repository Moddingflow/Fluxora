export type InstallNameSource = 'source' | 'fomod' | 'identity' | 'user';

export interface InstallNameState {
  modName: string;
  modNameSource: InstallNameSource;
}

export const applyInstallNameSuggestion = (
  current: InstallNameState,
  suggestedName: string,
  source: Exclude<InstallNameSource, 'user'>
): InstallNameState => {
  const normalizedSuggestion = suggestedName.trim();
  if (!normalizedSuggestion || current.modNameSource === 'user') {
    return current;
  }
  return {
    modName: normalizedSuggestion,
    modNameSource: source
  };
};

export const markInstallNameEdited = (
  current: InstallNameState,
  modName: string
): InstallNameState => ({
  ...current,
  modName,
  modNameSource: 'user'
});
