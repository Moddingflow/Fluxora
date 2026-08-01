import { Icon } from '../../renderer/design-system/icons';
import { IconButton } from '../../renderer/design-system/primitives';
import type { WindowActionResult } from '../contracts';
import './installer-titlebar.css';

export interface InstallerTitlebarProps {
  onMinimize: () => Promise<WindowActionResult>;
  onClose: () => Promise<WindowActionResult>;
  onCloseBlocked: (reasonKey: string) => void;
  title: string;
}

export function InstallerTitlebar({
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
    <header aria-label={`${title} window chrome`} className="installer-titlebar" data-tauri-drag-region>
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
      <div aria-label="Window controls" className="installer-titlebar__controls">
        <IconButton
          label="Minimize"
          onClick={() => void onMinimize()}
          size="sm"
          variant="bare"
        >
          <Icon name="window-minimize" size={14} />
        </IconButton>
        <IconButton
          label="Close"
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
