export const FLUXORA_RELEASES_SUPABASE_URL =
  'https://tpciohumwahlctpeuduv.supabase.co';

export interface FluxoraReleaseSignalConfig {
  publishableKey: string;
  url: typeof FLUXORA_RELEASES_SUPABASE_URL;
}

export interface FluxoraReleaseSignalEnvironment {
  VITE_FLUXORA_RELEASES_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_FLUXORA_RELEASES_SUPABASE_URL?: string;
}

export const resolveFluxoraReleaseSignalConfig = (
  environment: FluxoraReleaseSignalEnvironment,
  production: boolean
): FluxoraReleaseSignalConfig | null => {
  const url = environment.VITE_FLUXORA_RELEASES_SUPABASE_URL?.trim() ?? '';
  const publishableKey =
    environment.VITE_FLUXORA_RELEASES_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url && !publishableKey) {
    if (production) {
      throw new Error('Fluxora release signal configuration is required');
    }
    return null;
  }
  if (!url || !publishableKey) {
    throw new Error('Fluxora release signal configuration is incomplete');
  }
  if (url !== FLUXORA_RELEASES_SUPABASE_URL) {
    throw new Error('Fluxora release signal project URL is invalid');
  }

  return { publishableKey, url: FLUXORA_RELEASES_SUPABASE_URL };
};

export const releaseSignalConfigFromImportMeta = (): FluxoraReleaseSignalConfig | null =>
  resolveFluxoraReleaseSignalConfig(
    {
      VITE_FLUXORA_RELEASES_SUPABASE_PUBLISHABLE_KEY:
        import.meta.env.VITE_FLUXORA_RELEASES_SUPABASE_PUBLISHABLE_KEY,
      VITE_FLUXORA_RELEASES_SUPABASE_URL:
        import.meta.env.VITE_FLUXORA_RELEASES_SUPABASE_URL
    },
    // Vite also marks local package and Playwright bundles as PROD. The
    // canonical production publisher enforces both values before it builds;
    // an entirely absent local config intentionally keeps signed polling.
    false
  );
