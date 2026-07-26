export interface SearchScrollRestoration {
  prepareSearchChange: (
    currentSearchText: string,
    nextSearchText: string,
    currentScrollTop: number
  ) => void;
  scrollTopForRenderedSearch: (renderedSearchText: string) => number | null;
}

const hasActiveSearch = (searchText: string) => searchText.trim().length > 0;

export const createSearchScrollRestoration = (): SearchScrollRestoration => {
  let savedScrollTop: number | null = null;
  let restorePending = false;

  return {
    prepareSearchChange: (currentSearchText, nextSearchText, currentScrollTop) => {
      const searchWasActive = hasActiveSearch(currentSearchText);
      const searchWillBeActive = hasActiveSearch(nextSearchText);

      if (!searchWasActive && searchWillBeActive) {
        savedScrollTop = Math.max(0, currentScrollTop);
        restorePending = false;
        return;
      }

      if (searchWasActive && !searchWillBeActive) {
        restorePending = true;
      }
    },
    scrollTopForRenderedSearch: (renderedSearchText) => {
      if (hasActiveSearch(renderedSearchText)) {
        return 0;
      }

      if (!restorePending) {
        return null;
      }

      const restoredScrollTop = savedScrollTop;
      savedScrollTop = null;
      restorePending = false;
      return restoredScrollTop;
    }
  };
};
