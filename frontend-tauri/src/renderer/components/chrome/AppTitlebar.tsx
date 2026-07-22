import { fluxoraLogo } from '../../design-system/assets';
import { Icon } from '../../design-system/icons';
import geminiIcon from '../../../../../Icons/gemini.svg';

export type AppTitlebarMode = 'main' | 'settings';

export interface AppTitlebarProps {
  mode?: AppTitlebarMode;
  showShortcuts?: boolean;
  title?: string;
  homeActive?: boolean;
  aiActive?: boolean;
  settingsActive?: boolean;
  showAi?: boolean;
  onHome?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onToggleAi?: () => void | Promise<void>;
  onOpenSettings?: () => void | Promise<void>;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

const runTitlebarAction = (handler: (() => void | Promise<void>) | undefined) => {
  void handler?.();
};

const windowsCaptionGlyphs = {
  minimize: '\uE921',
  maximize: '\uE922',
  close: '\uE8BB'
} as const;

export function AppTitlebar({
  mode = 'main',
  showShortcuts = true,
  title,
  homeActive = false,
  aiActive = false,
  settingsActive = false,
  showAi = false,
  onHome,
  onRefresh,
  onToggleAi,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose
}: AppTitlebarProps) {
  const isSettingsWindow = mode === 'settings';
  const titleText = title ?? (isSettingsWindow ? 'Settings' : 'Fluxora');

  return (
    <header
      aria-label={isSettingsWindow ? 'Fluxora settings window chrome' : 'Fluxora window chrome'}
      className={`titlebar${isSettingsWindow ? ' titlebar--settings-window' : ''}`}
      data-tauri-drag-region
    >
      <div className="titlebar__brand" data-tauri-drag-region>
        {isSettingsWindow ? (
          <Icon className="titlebar__mark titlebar__mark--settings" name="settings" size={16} />
        ) : (
          <img className="titlebar__mark" src={fluxoraLogo} alt="" />
        )}
        <span className="titlebar__brand-name" title={titleText}>
          {titleText}
        </span>
      </div>

      <div className="titlebar__drag" data-tauri-drag-region />

      {showShortcuts ? (
        <nav aria-label="Window shortcuts" className="titlebar__shortcuts">
          <button
            aria-label="Home"
            className="titlebar__shortcut"
            data-active={homeActive ? 'true' : undefined}
            title="Home"
            type="button"
            onClick={() => runTitlebarAction(onHome)}
          >
            <Icon name="layers" size={15} />
          </button>
          <button
            aria-label="Refresh"
            className="titlebar__shortcut"
            title="Refresh"
            type="button"
            onClick={() => runTitlebarAction(onRefresh)}
          >
            <Icon name="refresh" size={15} />
          </button>
          {showAi ? (
            <button
              aria-keyshortcuts="Control+Shift+G"
              aria-label={aiActive ? 'Close Fluxora AI' : 'Open Fluxora AI'}
              aria-pressed={aiActive}
              className="titlebar__shortcut titlebar__shortcut--ai"
              data-active={aiActive ? 'true' : undefined}
              title="Toggle AI chat (Ctrl+Shift+G)"
              type="button"
              onClick={() => runTitlebarAction(onToggleAi)}
            >
              <img className="titlebar__ai-icon" src={geminiIcon} alt="" />
            </button>
          ) : null}
          <button
            aria-label="Open settings"
            className="titlebar__shortcut"
            data-active={settingsActive ? 'true' : undefined}
            title="Open settings"
            type="button"
            onClick={() => runTitlebarAction(onOpenSettings)}
          >
            <Icon name="settings" size={15} />
          </button>
        </nav>
      ) : null}

      <div aria-label="Window controls" className="titlebar__window-controls">
        {!isSettingsWindow ? (
          <>
            <button
              aria-label="Minimize"
              className="titlebar__caption-button"
              title="Minimize"
              type="button"
              onClick={() => runTitlebarAction(onMinimize)}
            >
              <span aria-hidden="true" className="titlebar__caption-glyph">
                {windowsCaptionGlyphs.minimize}
              </span>
            </button>
            <button
              aria-label="Maximize"
              className="titlebar__caption-button"
              title="Maximize"
              type="button"
              onClick={() => runTitlebarAction(onToggleMaximize)}
            >
              <span aria-hidden="true" className="titlebar__caption-glyph">
                {windowsCaptionGlyphs.maximize}
              </span>
            </button>
          </>
        ) : null}
        <button
          aria-label="Close"
          className={`titlebar__caption-button ${
            isSettingsWindow
              ? 'titlebar__caption-button--custom-close'
              : 'titlebar__caption-button--close'
          }`}
          title="Close"
          type="button"
          onClick={() => runTitlebarAction(onClose)}
        >
          {isSettingsWindow ? (
            <Icon
              className="titlebar__custom-close-icon"
              name="window-close"
              size={15}
              strokeWidth={1.8}
            />
          ) : (
            <span aria-hidden="true" className="titlebar__caption-glyph">
              {windowsCaptionGlyphs.close}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
