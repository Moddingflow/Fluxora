import type { UpdaterFluxoraWindow } from './contracts';
import { createUpdaterFacade } from './tauri-installer-api';

const scope = window as unknown as Partial<UpdaterFluxoraWindow>;
if (!scope.fluxora?.updater) {
  (window as unknown as UpdaterFluxoraWindow).fluxora = Object.freeze({
    updater: createUpdaterFacade()
  });
}
