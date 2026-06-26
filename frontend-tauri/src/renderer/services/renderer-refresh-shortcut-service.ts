export type RendererRefreshHandler = () => void | Promise<void>;

export interface RendererRefreshKeyEvent {
  key: string;
  repeat?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface RendererRefreshShortcutTarget {
  addEventListener: Document['addEventListener'];
  removeEventListener: Document['removeEventListener'];
}

export const isRendererRefreshShortcut = (event: Pick<RendererRefreshKeyEvent, 'key'>): boolean =>
  event.key === 'F5';

export const handleRendererRefreshShortcut = (
  event: RendererRefreshKeyEvent,
  onRefresh: RendererRefreshHandler
): boolean => {
  if (!isRendererRefreshShortcut(event)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  if (!event.repeat) {
    void onRefresh();
  }

  return true;
};

export const installRendererRefreshShortcut = (
  target: RendererRefreshShortcutTarget,
  onRefresh: RendererRefreshHandler
): (() => void) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    handleRendererRefreshShortcut(event, onRefresh);
  };

  target.addEventListener('keydown', handleKeyDown, true);

  return () => {
    target.removeEventListener('keydown', handleKeyDown, true);
  };
};
