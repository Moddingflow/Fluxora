import React from 'react';
import ReactDOM from 'react-dom/client';

import '../../renderer/design-system/tokens/foundations.css';
import '../../renderer/design-system/primitives/primitives.css';
import '../components/installer-tokens.css';
import '../register-setup-api';
import { SetupApp } from './SetupApp';
import './setup.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SetupApp />
  </React.StrictMode>
);
