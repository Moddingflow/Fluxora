export const aiMicrophonePermissionStorageKey = 'fluxora.settings.aiMicrophoneAllowed';
export const aiMicrophonePermissionChangedEvent = 'fluxora:ai-microphone-permission-changed';

export type AiMicrophonePermissionStorage = Pick<
  Storage,
  'getItem' | 'removeItem' | 'setItem'
>;

export const hasAiMicrophonePermission = (
  storage: Pick<AiMicrophonePermissionStorage, 'getItem'> | null | undefined
): boolean => {
  try {
    return storage?.getItem(aiMicrophonePermissionStorageKey) === 'true';
  } catch {
    return false;
  }
};

export const allowAiMicrophone = (
  storage: Pick<AiMicrophonePermissionStorage, 'setItem'> | null | undefined
): void => {
  try {
    storage?.setItem(aiMicrophonePermissionStorageKey, 'true');
  } catch {
    // Restricted preview/storage contexts stay fail-closed and ask again.
  }
};

export const resetAiMicrophonePermission = (
  storage: Pick<AiMicrophonePermissionStorage, 'removeItem'> | null | undefined
): void => {
  try {
    storage?.removeItem(aiMicrophonePermissionStorageKey);
  } catch {
    // Native reset still closes an armed request even when storage is unavailable.
  }
};
