import { Icon } from '../../renderer/design-system/icons';
import { IconButton } from '../../renderer/design-system/primitives';
import type { InstallerLanguage, WindowActionResult } from '../contracts';
import { translate } from '../i18n';
import './installer-titlebar.css';

export interface InstallerTitlebarProps {
  language: InstallerLanguage;
  onMinimize: () => Promise<WindowActionResult>;
  onClose: () => Promise<WindowActionResult>;
  onCloseBlocked: (reasonKey: string) => void;
  title: string;
}

export function InstallerTitlebar({
  language,
  onClose,
  onCloseBlocked,
  onMinimize,
  title
}: InstallerTitlebarProps) {
  const runClose = async () => {
    const result = await onClose();
    if (!result.completed && result.reasonKey) {
      onCloseBlocked(result.reasonKey);
    }
  };

  return (
    <header
      aria-label={translate(language, 'installer.window.chrome', { title })}
      className="installer-titlebar"
      data-tauri-drag-region
    >
      <div className="installer-titlebar__brand" data-tauri-drag-region>
        <Icon
          aria-hidden="true"
          className="installer-titlebar__logo"
          name="fluxora-mark"
          size={17}
        />
        <span data-tauri-drag-region>{title}</span>
      </div>
      <div className="installer-titlebar__drag" data-tauri-drag-region />
      <div
        aria-label={translate(language, 'installer.window.controls')}
        className="installer-titlebar__controls"
      >
        <IconButton
          label={translate(language, 'installer.window.minimize')}
          onClick={() => void onMinimize()}
          size="sm"
          variant="bare"
        >
          <Icon name="window-minimize" size={14} />
        </IconButton>
        <IconButton
          label={translate(language, 'installer.window.close')}
          onClick={() => void runClose()}
          size="sm"
          variant="bare"
        >
          <Icon name="window-close" size={14} />
        </IconButton>
      </div>
    </header>
  );
}
