export interface ExecutableSettingsCloseRequest {
  dirty: boolean;
  forceClose: () => Promise<void>;
  openDiscardConfirmation: () => void;
}

export type ExecutableSettingsCloseResult = 'closed' | 'confirmation-required';

export async function requestExecutableSettingsClose({
  dirty,
  forceClose,
  openDiscardConfirmation
}: ExecutableSettingsCloseRequest): Promise<ExecutableSettingsCloseResult> {
  if (dirty) {
    openDiscardConfirmation();
    return 'confirmation-required';
  }

  await forceClose();
  return 'closed';
}
