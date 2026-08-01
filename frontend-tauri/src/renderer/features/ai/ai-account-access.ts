import type { OpenExternalResult } from '../../../shared/fluxora-api';

export const moddingFlowRegistrationUrl = 'https://moddingflow.com/register/' as const;

export async function openModdingFlowRegistration(
  openExternal: (url: string) => Promise<OpenExternalResult>
): Promise<void> {
  const result = await openExternal(moddingFlowRegistrationUrl);
  if (!result.ok) {
    throw new Error(`ModdingFlow registration could not be opened: ${result.reason ?? 'open-failed'}.`);
  }
}
