import { createTauriFluxoraApi } from './fluxora-api';

if (!window.fluxora) {
  window.fluxora = createTauriFluxoraApi();
}
