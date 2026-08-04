import { Icon } from '../../design-system/icons';
import { AppUpdateToolbarButton } from '../../features/update/AppUpdateToolbarButton';
import type { AppUpdateToolbarViewState } from '../../features/update/app-update-state';
import geminiIcon from '../../../../../Icons/gemini.svg';
import { useLocalization } from '../../../localization/react';

export type AppTitlebarMode = 'main' | 'settings';

export interface AppTitlebarProps {
  mode?: AppTitlebarMode;
  showShortcuts?: boolean;
  title?: string;
  homeActive?: boolean;
  aiActive?: boolean;
  settingsActive?: boolean;
  showAi?: boolean;
  update?: AppUpdateToolbarViewState;
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
  update = { state: 'hidden' },
  onHome,
  onRefresh,
  onToggleAi,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose
}: AppTitlebarProps) {
  const { t } = useLocalization();
  const isSettingsWindow = mode === 'settings';
  const titleText = title ?? (isSettingsWindow ? t('titlebar.settings') : t('titlebar.appName'));

  return (
    <header
      aria-label={isSettingsWindow ? t('titlebar.aria.settings') : t('titlebar.aria.main')}
      className={`titlebar${isSettingsWindow ? ' titlebar--settings-window' : ''}`}
      data-tauri-drag-region
    >
      <div className="titlebar__brand" data-tauri-drag-region>
        {isSettingsWindow ? (
          <Icon className="titlebar__mark titlebar__mark--settings" name="settings" size={16} />
        ) : (
          <Icon
            aria-hidden="true"
            className="titlebar__mark titlebar__mark--fluxora"
            name="fluxora-mark"
            size={16}
          />
        )}
        <span className="titlebar__brand-name" title={titleText}>
          {titleText}
        </span>
      </div>

      <div className="titlebar__drag" data-tauri-drag-region />

      {showShortcuts ? (
        <nav aria-label={t('titlebar.shortcuts')} className="titlebar__shortcuts">
          <button
            aria-label={t('titlebar.home')}
            className="titlebar__shortcut"
            data-active={homeActive ? 'true' : undefined}
            title={t('titlebar.home')}
            type="button"
            onClick={() => runTitlebarAction(onHome)}
          >
            <Icon name="layers" size={15} />
          </button>
          <button
            aria-label={t('titlebar.refresh')}
            className="titlebar__shortcut"
            title={t('titlebar.refresh')}
            type="button"
            onClick={() => runTitlebarAction(onRefresh)}
          >
            <Icon name="refresh" size={15} />
          </button>
          {showAi ? (
            <button
              aria-keyshortcuts="Control+Shift+G"
              aria-label={aiActive ? t('titlebar.ai.close') : t('titlebar.ai.open')}
              aria-pressed={aiActive}
              className="titlebar__shortcut titlebar__shortcut--ai"
              data-active={aiActive ? 'true' : undefined}
              title={t('titlebar.ai.toggle')}
              type="button"
              onClick={() => runTitlebarAction(onToggleAi)}
            >
              <img className="titlebar__ai-icon" src={geminiIcon} alt="" />
            </button>
          ) : null}
          <AppUpdateToolbarButton update={update} />
          <button
            aria-label={t('titlebar.openSettings')}
            className="titlebar__shortcut"
            data-active={settingsActive ? 'true' : undefined}
            title={t('titlebar.openSettings')}
            type="button"
            onClick={() => runTitlebarAction(onOpenSettings)}
          >
            <Icon name="settings" size={15} />
          </button>
        </nav>
      ) : null}

      <div aria-label={t('titlebar.windowControls')} className="titlebar__window-controls">
        {!isSettingsWindow ? (
          <>
            <button
              aria-label={t('titlebar.minimize')}
              className="titlebar__caption-button"
              title={t('titlebar.minimize')}
              type="button"
              onClick={() => runTitlebarAction(onMinimize)}
            >
              <span aria-hidden="true" className="titlebar__caption-glyph">
                {windowsCaptionGlyphs.minimize}
              </span>
            </button>
            <button
              aria-label={t('titlebar.maximize')}
              className="titlebar__caption-button"
              title={t('titlebar.maximize')}
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
          aria-label={t('titlebar.close')}
          className={`titlebar__caption-button ${
            isSettingsWindow
              ? 'titlebar__caption-button--custom-close'
              : 'titlebar__caption-button--close'
          }`}
          title={t('titlebar.close')}
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
