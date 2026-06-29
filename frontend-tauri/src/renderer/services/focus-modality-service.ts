export const TAB_FOCUS_NAVIGATION_VALUE = 'tab';

const focusNavigationDatasetKey = 'focusNavigation';
const focusNavigationListenerOptions = {
  capture: true
} as const;

type FocusNavigationDocument = Pick<Document, 'addEventListener' | 'documentElement' | 'removeEventListener'>;

const setTabFocusNavigation = (targetDocument: FocusNavigationDocument, enabled: boolean): void => {
  const { dataset } = targetDocument.documentElement;

  if (enabled) {
    dataset[focusNavigationDatasetKey] = TAB_FOCUS_NAVIGATION_VALUE;
    return;
  }

  delete dataset[focusNavigationDatasetKey];
};

export const installTabFocusNavigation = (
  targetDocument: FocusNavigationDocument = document
): (() => void) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      setTabFocusNavigation(targetDocument, true);
    }
  };

  const handlePointerInput = () => {
    setTabFocusNavigation(targetDocument, false);
  };

  targetDocument.addEventListener('keydown', handleKeyDown, focusNavigationListenerOptions);
  targetDocument.addEventListener('pointerdown', handlePointerInput, focusNavigationListenerOptions);
  targetDocument.addEventListener('mousedown', handlePointerInput, focusNavigationListenerOptions);
  targetDocument.addEventListener('touchstart', handlePointerInput, focusNavigationListenerOptions);

  return () => {
    targetDocument.removeEventListener('keydown', handleKeyDown, focusNavigationListenerOptions);
    targetDocument.removeEventListener('pointerdown', handlePointerInput, focusNavigationListenerOptions);
    targetDocument.removeEventListener('mousedown', handlePointerInput, focusNavigationListenerOptions);
    targetDocument.removeEventListener('touchstart', handlePointerInput, focusNavigationListenerOptions);
    setTabFocusNavigation(targetDocument, false);
  };
};
