import type { FluxoraApi } from './fluxora-api';

declare global {
  interface Window {
    fluxora: FluxoraApi;
  }
}

export {};

