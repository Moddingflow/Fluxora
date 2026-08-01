import type { SetupFluxoraWindow } from './contracts';
import { createSetupFacade } from './tauri-installer-api';

const scope = window as unknown as Partial<SetupFluxoraWindow>;
if (!scope.fluxora?.setup) {
  (window as unknown as SetupFluxoraWindow).fluxora = Object.freeze({
    setup: createSetupFacade()
  });
}
