import { useEffect, useMemo } from 'react';

import { AppTitlebar } from '../../components/chrome/AppTitlebar';
import {
  TEXT_EDITOR_REQUEST_CLOSE_EVENT,
  TextEditorWorkspace
} from './TextEditorWorkspace';

const fileNameFromPath = (path: string): string =>
  path.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? 'Editor';

export function TextEditorWindow() {
  const parameters = useMemo(() => new URLSearchParams(window.location.search), []);
  const projectDirectory = parameters.get('directory')?.trim() ?? '';
  const initialModPath = parameters.get('mod')?.trim() ?? '';
  const initialRelativePath = parameters.get('path')?.trim() ?? '';
  const initialFileName = parameters.get('name')?.trim()
    || fileNameFromPath(initialRelativePath);

  useEffect(() => {
    let active = true;

    void window.fluxora.settings.getTheme().then((result) => {
      if (active) {
        document.documentElement.dataset.theme = result.theme;
      }
    }).catch(() => undefined);

    void window.fluxora.app.getInfo().then((result) => {
      if (active) {
        document.documentElement.dataset.platform = result.platform;
      }
    }).catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="desktop-shell desktop-shell--settings-window desktop-shell--text-editor-window">
      <AppTitlebar
        mode="settings"
        showShortcuts={false}
        title={`Editor · ${initialFileName}`}
        onClose={() => {
          window.dispatchEvent(new Event(TEXT_EDITOR_REQUEST_CLOSE_EVENT));
        }}
        onMinimize={() => window.fluxora.windowControls.minimize()}
        onToggleMaximize={() => window.fluxora.windowControls.toggleMaximize()}
      />
      <TextEditorWorkspace
        initialFileName={initialFileName}
        initialModPath={initialModPath}
        initialRelativePath={initialRelativePath}
        projectDirectory={projectDirectory}
      />
    </main>
  );
}
