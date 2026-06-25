import { fluxoraLogo } from '../../design-system/assets';
import { Icon } from '../../design-system/icons';

export type AppTitlebarMode = 'main' | 'settings';

export interface AppTitlebarProps {
  mode?: AppTitlebarMode;
  showShortcuts?: boolean;
  homeActive?: boolean;
  settingsActive?: boolean;
  onHome?: () => void | Promise<void>;
  onOpenSettings?: () => void | Promise<void>;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

const runTitlebarAction = (handler: (() => void | Promise<void>) | undefined) => {
  void handler?.();
};

export function AppTitlebar({
  mode = 'main',
  showShortcuts = true,
  homeActive = false,
  settingsActive = false,
  onHome,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose
}: AppTitlebarProps) {
  const isSettingsWindow = mode === 'settings';

  return (
    <header
      aria-label={isSettingsWindow ? 'Fluxora settings window chrome' : 'Fluxora window chrome'}
      className={`titlebar${isSettingsWindow ? ' titlebar--settings-window' : ''}`}
      data-tauri-drag-region
    >
      <div className="titlebar__brand" data-tauri-drag-region>
        <img className="titlebar__mark" src={fluxoraLogo} alt="" />
        <span className="titlebar__brand-name">Fluxora</span>
        <span className="titlebar__subtitle">{isSettingsWindow ? 'Settings' : 'Mod manager'}</span>
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
            <Icon name="layers" size={17} />
          </button>
          <button
            aria-label="Open settings"
            className="titlebar__shortcut"
            data-active={settingsActive ? 'true' : undefined}
            title="Open settings"
            type="button"
            onClick={() => runTitlebarAction(onOpenSettings)}
          >
            <Icon name="settings" size={17} />
          </button>
        </nav>
      ) : null}

      <div aria-label="Window controls" className="titlebar__window-controls">
        <button
          aria-label="Minimize"
          className="titlebar__caption-button"
          title="Minimize"
          type="button"
          onClick={() => runTitlebarAction(onMinimize)}
        >
          <Icon name="window-minimize" size={13} strokeWidth={1.7} />
        </button>
        <button
          aria-label="Maximize"
          className="titlebar__caption-button"
          title="Maximize"
          type="button"
          onClick={() => runTitlebarAction(onToggleMaximize)}
        >
          <Icon name="window-maximize" size={13} strokeWidth={1.7} />
        </button>
        <button
          aria-label="Close"
          className="titlebar__caption-button titlebar__caption-button--close"
          title="Close"
          type="button"
          onClick={() => runTitlebarAction(onClose)}
        >
          <Icon name="window-close" size={14} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}
