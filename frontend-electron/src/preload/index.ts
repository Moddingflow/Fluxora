import { contextBridge, ipcRenderer } from 'electron';

import { createFluxoraApi } from './fluxora-api';

contextBridge.exposeInMainWorld('fluxora', createFluxoraApi(ipcRenderer));

