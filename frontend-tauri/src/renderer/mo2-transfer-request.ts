import type { FluxoraModOrganizerImportRequest } from '../shared/fluxora-api';

export const createMo2TransferImportRequest = (
  sourceDirectory: string,
  destinationRootDirectory: string,
  existingConfigPath = ''
): FluxoraModOrganizerImportRequest => ({
  sourceDirectory,
  destinationRootDirectory,
  existingConfigPath: existingConfigPath.trim() || undefined,
  replaceExisting: existingConfigPath.trim().length > 0
});
