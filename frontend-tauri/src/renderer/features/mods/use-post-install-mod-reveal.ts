import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AnimationEvent as ReactAnimationEvent,
  RefCallback
} from 'react';

export interface CenteredModRevealScrollOptions {
  itemCount: number;
  itemIndex: number;
  rowHeight: number;
  viewportHeight: number;
}

export const centeredModRevealScrollTop = ({
  itemCount,
  itemIndex,
  rowHeight,
  viewportHeight
}: CenteredModRevealScrollOptions): number => {
  const contentHeight = Math.max(0, itemCount) * Math.max(0, rowHeight);
  const maxScrollTop = Math.max(0, contentHeight - Math.max(0, viewportHeight));
  const centeredScrollTop =
    itemIndex * rowHeight - (viewportHeight - rowHeight) / 2;

  return Math.min(maxScrollTop, Math.max(0, Math.round(centeredScrollTop)));
};

interface PostInstallModRevealItem {
  id: string;
  name: string;
  orderId: string;
}

export interface PostInstallModRevealRequest {
  installedId: string;
  installedName: string;
  orderId: string;
  animate: boolean;
}

export interface UsePostInstallModRevealOptions {
  items: readonly PostInstallModRevealItem[];
  rowHeight: number;
  scopeKey: string | null;
  onScrollTopChange: (scrollTop: number) => void;
}

export interface UsePostInstallModRevealResult {
  highlightedOrderId: string | null;
  requestPostInstallModReveal: (request: PostInstallModRevealRequest) => void;
  scrollContainerRef: RefCallback<HTMLDivElement>;
  handlePostInstallModRevealAnimationEnd: (
    orderId: string,
    event: ReactAnimationEvent<HTMLElement>
  ) => void;
}

const postInstallRevealAnimationName = 'post-install-mod-reveal';
const maxRevealFrameAttempts = 120;

const normalizeRevealLookup = (value: string): string =>
  value
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
    .toLocaleLowerCase();

export const postInstallModRevealOrderId = (
  items: readonly PostInstallModRevealItem[],
  request: Pick<PostInstallModRevealRequest, 'installedId' | 'installedName' | 'orderId'>
): string | null => {
  const exactOrderItem = items.find((item) => item.orderId === request.orderId);
  if (exactOrderItem) {
    return exactOrderItem.orderId;
  }

  const installedId = normalizeRevealLookup(request.installedId);
  if (installedId) {
    const matchingIdItem = items.find(
      (item) => normalizeRevealLookup(item.id) === installedId
    );
    if (matchingIdItem) {
      return matchingIdItem.orderId;
    }
  }

  const installedName = normalizeRevealLookup(request.installedName);
  return (
    items.find((item) => normalizeRevealLookup(item.name) === installedName)?.orderId ?? null
  );
};

const findRenderedOrderRow = (
  container: HTMLElement,
  orderId: string
): HTMLElement | null =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-order-id]')).find(
    (row) => row.dataset.orderId === orderId
  ) ?? null;

export const usePostInstallModReveal = ({
  items,
  rowHeight,
  scopeKey,
  onScrollTopChange
}: UsePostInstallModRevealOptions): UsePostInstallModRevealResult => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameIdsRef = useRef(new Set<number>());
  const requestGenerationRef = useRef(0);
  const itemsRef = useRef(items);
  const scopeKeyRef = useRef(scopeKey);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  const activeRequestRef = useRef<PostInstallModRevealRequest | null>(null);
  const highlightedOrderIdRef = useRef<string | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);

  itemsRef.current = items;
  scopeKeyRef.current = scopeKey;
  onScrollTopChangeRef.current = onScrollTopChange;

  const updateHighlightedOrderId = useCallback((orderId: string | null) => {
    highlightedOrderIdRef.current = orderId;
    setHighlightedOrderId(orderId);
  }, []);

  const cancelScheduledFrames = useCallback(() => {
    requestGenerationRef.current += 1;
    frameIdsRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
    frameIdsRef.current.clear();
    activeRequestRef.current = null;
  }, []);

  const scheduleFrame = useCallback((callback: () => void) => {
    const frameId = window.requestAnimationFrame(() => {
      frameIdsRef.current.delete(frameId);
      callback();
    });
    frameIdsRef.current.add(frameId);
  }, []);

  const scrollContainerRef = useCallback<RefCallback<HTMLDivElement>>(
    (container) => {
      if (containerRef.current && containerRef.current !== container) {
        cancelScheduledFrames();
        updateHighlightedOrderId(null);
      }
      containerRef.current = container;
    },
    [cancelScheduledFrames, updateHighlightedOrderId]
  );

  const requestPostInstallModReveal = useCallback(
    (request: PostInstallModRevealRequest) => {
      cancelScheduledFrames();
      activeRequestRef.current = request;
      const generation = requestGenerationRef.current;
      const requestedScopeKey = scopeKeyRef.current;
      let frameAttempts = 0;
      let centeredOrderId: string | null = null;

      updateHighlightedOrderId(null);

      const requestIsCurrent = () =>
        requestGenerationRef.current === generation &&
        scopeKeyRef.current === requestedScopeKey;

      const waitForRenderedRow = () => {
        if (!requestIsCurrent()) {
          return;
        }

        const container = containerRef.current;
        const orderId = postInstallModRevealOrderId(itemsRef.current, request);
        if (orderId && orderId !== centeredOrderId) {
          scheduleFrame(waitForVisibleItem);
          return;
        }
        const row = container && orderId ? findRenderedOrderRow(container, orderId) : null;
        if (!row) {
          frameAttempts += 1;
          if (frameAttempts < maxRevealFrameAttempts) {
            scheduleFrame(waitForVisibleItem);
          }
          return;
        }

        row.focus({ preventScroll: true });
        const reducedMotion =
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        if (!request.animate || reducedMotion) {
          activeRequestRef.current = null;
          return;
        }

        scheduleFrame(() => {
          if (!requestIsCurrent()) {
            return;
          }
          scheduleFrame(() => {
            if (!requestIsCurrent()) {
              return;
            }

            const currentOrderId = postInstallModRevealOrderId(itemsRef.current, request);
            const currentContainer = containerRef.current;
            const currentRow =
              currentContainer && currentOrderId
                ? findRenderedOrderRow(currentContainer, currentOrderId)
                : null;
            if (!currentOrderId || currentOrderId !== centeredOrderId || !currentRow) {
              frameAttempts += 1;
              if (frameAttempts < maxRevealFrameAttempts) {
                scheduleFrame(waitForVisibleItem);
              }
              return;
            }

            currentRow.focus({ preventScroll: true });
            updateHighlightedOrderId(currentOrderId);
          });
        });
      };

      const waitForVisibleItem = () => {
        if (!requestIsCurrent()) {
          return;
        }

        const container = containerRef.current;
        const orderId = postInstallModRevealOrderId(itemsRef.current, request);
        const itemIndex = itemsRef.current.findIndex((item) => item.orderId === orderId);
        if (!container || itemIndex < 0) {
          frameAttempts += 1;
          if (frameAttempts < maxRevealFrameAttempts) {
            scheduleFrame(waitForVisibleItem);
          }
          return;
        }

        const scrollTop = centeredModRevealScrollTop({
          itemCount: itemsRef.current.length,
          itemIndex,
          rowHeight,
          viewportHeight: container.clientHeight
        });
        container.scrollTop = scrollTop;
        onScrollTopChangeRef.current(scrollTop);
        centeredOrderId = orderId;
        scheduleFrame(waitForRenderedRow);
      };

      scheduleFrame(waitForVisibleItem);
    },
    [cancelScheduledFrames, rowHeight, scheduleFrame, updateHighlightedOrderId]
  );

  const handlePostInstallModRevealAnimationEnd = useCallback(
    (orderId: string, event: ReactAnimationEvent<HTMLElement>) => {
      if (
        event.animationName === postInstallRevealAnimationName &&
        highlightedOrderIdRef.current === orderId
      ) {
        activeRequestRef.current = null;
        updateHighlightedOrderId(null);
      }
    },
    [updateHighlightedOrderId]
  );

  useLayoutEffect(() => {
    cancelScheduledFrames();
    updateHighlightedOrderId(null);
  }, [cancelScheduledFrames, scopeKey, updateHighlightedOrderId]);

  useLayoutEffect(() => {
    const request = activeRequestRef.current;
    const highlightedOrderId = highlightedOrderIdRef.current;
    if (
      !request ||
      !highlightedOrderId ||
      items.some((item) => item.orderId === highlightedOrderId)
    ) {
      return;
    }

    if (postInstallModRevealOrderId(items, request)) {
      requestPostInstallModReveal(request);
    }
  }, [items, requestPostInstallModReveal]);

  useEffect(
    () => () => {
      cancelScheduledFrames();
      containerRef.current = null;
    },
    [cancelScheduledFrames]
  );

  return {
    highlightedOrderId,
    requestPostInstallModReveal,
    scrollContainerRef,
    handlePostInstallModRevealAnimationEnd
  };
};
