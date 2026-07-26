import { useCallback, useLayoutEffect, useRef } from 'react';

import { createSearchScrollRestoration } from '../services/search-scroll-restoration';

interface UseSearchScrollRestorationOptions {
  renderedSearchText: string;
  readScrollTop: () => number;
  scrollTo: (scrollTop: number) => void;
}

export const useSearchScrollRestoration = ({
  renderedSearchText,
  readScrollTop,
  scrollTo
}: UseSearchScrollRestorationOptions) => {
  const restorationRef = useRef(createSearchScrollRestoration());
  const readScrollTopRef = useRef(readScrollTop);
  const scrollToRef = useRef(scrollTo);
  readScrollTopRef.current = readScrollTop;
  scrollToRef.current = scrollTo;

  useLayoutEffect(() => {
    const scrollTop = restorationRef.current.scrollTopForRenderedSearch(renderedSearchText);
    if (scrollTop !== null) {
      scrollToRef.current(scrollTop);
    }
  }, [renderedSearchText]);

  return useCallback((currentSearchText: string, nextSearchText: string) => {
    restorationRef.current.prepareSearchChange(
      currentSearchText,
      nextSearchText,
      readScrollTopRef.current()
    );
  }, []);
};
