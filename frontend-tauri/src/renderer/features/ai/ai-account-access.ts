import type { OpenExternalResult } from '../../../shared/fluxora-api';
import { translateForLanguage } from '../../../localization';

export const moddingFlowRegistrationUrl = 'https://moddingflow.com/register/' as const;

export async function openModdingFlowRegistration(
  openExternal: (url: string) => Promise<OpenExternalResult>,
  language?: string | null
): Promise<void> {
  const result = await openExternal(moddingFlowRegistrationUrl);
  if (!result.ok) {
    throw new Error(translateForLanguage(language, 'app.error.registrationOpenFailed', {
      reason: result.reason ?? 'open-failed'
    }));
  }
}
