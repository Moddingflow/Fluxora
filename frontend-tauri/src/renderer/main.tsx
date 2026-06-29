import React from 'react';
import ReactDOM from 'react-dom/client';

import '../tauri/register-fluxora-api';
import { App } from './App';
import { installTabFocusNavigation } from './services/focus-modality-service';
import './styles.css';

installTabFocusNavigation();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
