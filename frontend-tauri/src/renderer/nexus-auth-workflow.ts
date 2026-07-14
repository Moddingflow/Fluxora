import type {
  FluxoraApiLimitProvider,
  FluxoraApiLimitStatus,
  FluxoraNexusModsAuthStatus
} from '../shared/fluxora-api';

export interface NexusStatusAndLimitsLoaders {
  getAuthStatus: () => Promise<FluxoraNexusModsAuthStatus>;
  listApiLimits: () => Promise<FluxoraApiLimitStatus>;
}

export interface NexusStatusAndLimitsResult {
  authStatus: FluxoraNexusModsAuthStatus | null;
  authError: unknown | null;
  apiLimitProviders: FluxoraApiLimitProvider[] | null;
  apiLimitsError: unknown | null;
}

export const loadNexusStatusAndLimits = async ({
  getAuthStatus,
  listApiLimits
}: NexusStatusAndLimitsLoaders): Promise<NexusStatusAndLimitsResult> => {
  const [authResult, apiLimitsResult] = await Promise.allSettled([
    getAuthStatus(),
    listApiLimits()
  ]);

  return {
    authStatus: authResult.status === 'fulfilled' ? authResult.value : null,
    authError: authResult.status === 'rejected' ? authResult.reason : null,
    apiLimitProviders: apiLimitsResult.status === 'fulfilled' ? apiLimitsResult.value.providers : null,
    apiLimitsError: apiLimitsResult.status === 'rejected' ? apiLimitsResult.reason : null
  };
};
