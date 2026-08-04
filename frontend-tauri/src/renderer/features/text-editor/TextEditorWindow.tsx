import { useEffect, useLayoutEffect, useMemo, useReducer } from 'react';

import { normalizeAppLocale, translateForLanguage } from '../../../localization';
import {
  appLanguageReducer,
  initialAppLanguageState
} from '../../../localization/app-language-state';
import { LocalizationProvider } from '../../../localization/react';
import { AppTitlebar } from '../../components/chrome/AppTitlebar';
import {
  TEXT_EDITOR_REQUEST_CLOSE_EVENT,
  TextEditorWorkspace
} from './TextEditorWorkspace';

const fileNameFromPath = (path: string): string =>
  path.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? '';

export function TextEditorWindow() {
  const [appLanguage, dispatchAppLanguage] = useReducer(
    appLanguageReducer,
    initialAppLanguageState
  );
  const language = appLanguage.language;
  const parameters = useMemo(() => new URLSearchParams(window.location.search), []);
  const projectDirectory = parameters.get('directory')?.trim() ?? '';
  const initialModPath = parameters.get('mod')?.trim() ?? '';
  const initialRelativePath = parameters.get('path')?.trim() ?? '';
  const initialAiChatId = parameters.get('aiChat')?.trim() ?? '';
  const initialAiFileRef = parameters.get('fileRef')?.trim() ?? '';
  const initialLine = Math.max(1, Number.parseInt(parameters.get('line') ?? '1', 10) || 1);
  const initialFileName = parameters.get('name')?.trim()
    || fileNameFromPath(initialRelativePath)
    || translateForLanguage(language, 'app.ui.editor');

  useEffect(() => {
    let active = true;
    const unsubscribeLanguage = window.fluxora.settings.onLanguageChanged((result) => {
      if (active) {
        dispatchAppLanguage({ type: 'language-confirmed', language: result.language });
      }
    });

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

    void window.fluxora.settings.getLanguage().then((result) => {
      if (active) {
        dispatchAppLanguage({ type: 'native-loaded', language: result.language });
      }
    }).catch(() => {
      if (active) {
        dispatchAppLanguage({ type: 'native-load-failed' });
      }
    });

    return () => {
      active = false;
      unsubscribeLanguage();
    };
  }, []);

  useLayoutEffect(() => {
    if (appLanguage.ready) {
      document.documentElement.lang = normalizeAppLocale(language);
    }
  }, [appLanguage.ready, language]);

  if (!appLanguage.ready) {
    return <main className="desktop-shell" aria-busy="true" />;
  }

  return (
    <LocalizationProvider language={language}>
      <main className="desktop-shell desktop-shell--settings-window desktop-shell--text-editor-window">
        <AppTitlebar
          mode="settings"
          showShortcuts={false}
          title={translateForLanguage(language, 'editor.windowTitle', { name: initialFileName })}
          onClose={() => {
            window.dispatchEvent(new Event(TEXT_EDITOR_REQUEST_CLOSE_EVENT));
          }}
          onMinimize={() => window.fluxora.windowControls.minimize()}
          onToggleMaximize={() => window.fluxora.windowControls.toggleMaximize()}
        />
        <TextEditorWorkspace
          initialFileName={initialFileName}
          initialAiChatId={initialAiChatId}
          initialAiFileRef={initialAiFileRef}
          initialLine={initialLine}
          initialModPath={initialModPath}
          initialRelativePath={initialRelativePath}
          projectDirectory={projectDirectory}
        />
      </main>
    </LocalizationProvider>
  );
}
