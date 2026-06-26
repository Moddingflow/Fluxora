import type { FluxoraModOrganizerImportRequest } from '../shared/fluxora-api';

export const createMo2TransferImportRequest = (
  sourceDirectory: string,
  destinationRootDirectory: string
): FluxoraModOrganizerImportRequest => ({
  sourceDirectory,
  destinationRootDirectory,
  replaceExisting: false
});
