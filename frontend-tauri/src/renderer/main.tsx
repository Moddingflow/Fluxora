import React from 'react';
import ReactDOM from 'react-dom/client';

import '../tauri/register-fluxora-api';
import { installTabFocusNavigation } from './services/focus-modality-service';
import './styles.css';

const LazyApp = React.lazy(async () => {
  const module = await import('./App');
  return { default: module.App };
});

const LazyTextEditorWindow = React.lazy(async () => {
  const module = await import('./features/text-editor/TextEditorWindow');
  return { default: module.TextEditorWindow };
});

const LazyAppUpdateWindow = React.lazy(async () => {
  const module = await import('./features/update/AppUpdateWindow');
  return { default: module.AppUpdateWindow };
});

installTabFocusNavigation();

const windowMode = new URLSearchParams(window.location.search).get('window');
const RendererRoot = windowMode === 'text-editor'
  ? LazyTextEditorWindow
  : windowMode === 'app-update'
    ? LazyAppUpdateWindow
    : LazyApp;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={<main className="desktop-shell" aria-busy="true" />}>
      <RendererRoot />
    </React.Suspense>
  </React.StrictMode>
);
