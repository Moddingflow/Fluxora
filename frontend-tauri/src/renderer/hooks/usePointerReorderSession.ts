import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react';

export interface PointerReorderStart<TPayload> {
  payload: TPayload;
  sourceId: string;
}

interface PointerReorderSession<TPayload, TTarget> extends PointerReorderStart<TPayload> {
  active: boolean;
  captureElement: HTMLElement;
  currentX: number;
  currentY: number;
  pointerId: number;
  startX: number;
  startY: number;
  target: TTarget | null;
}

export interface PointerReorderMove<TPayload, TTarget> {
  payload: TPayload;
  pointer: { x: number; y: number };
  sourceId: string;
  target: TTarget | null;
}

export interface PointerReorderConfiguration<TPayload, TTarget> {
  edgeScrollDistance?: number;
  edgeScrollStep?: number;
  onCancel: (session: PointerReorderMove<TPayload, TTarget>) => void;
  onDragMove: (session: PointerReorderMove<TPayload, TTarget>) => void;
  onDragStart: (session: PointerReorderMove<TPayload, TTarget>) => void;
  onDrop: (session: PointerReorderMove<TPayload, TTarget>) => void;
  resolveTarget: (
    rowElement: HTMLElement | null,
    pointer: { x: number; y: number }
  ) => TTarget | null;
  rowSelector: string;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  threshold?: number;
}

const interactiveSelector = 'input, button, textarea, select, [contenteditable="true"]';

export function usePointerReorderSession<TPayload, TTarget>({
  edgeScrollDistance = 28,
  edgeScrollStep = 34,
  onCancel,
  onDragMove,
  onDragStart,
  onDrop,
  resolveTarget,
  rowSelector,
  scrollContainerRef,
  threshold = 5
}: PointerReorderConfiguration<TPayload, TTarget>) {
  const sessionRef = useRef<PointerReorderSession<TPayload, TTarget> | null>(null);
  const callbacksRef = useRef({ onCancel, onDragMove, onDragStart, onDrop, resolveTarget });
  callbacksRef.current = { onCancel, onDragMove, onDragStart, onDrop, resolveTarget };

  const snapshot = useCallback(
    (session: PointerReorderSession<TPayload, TTarget>): PointerReorderMove<TPayload, TTarget> => ({
      payload: session.payload,
      pointer: { x: session.currentX, y: session.currentY },
      sourceId: session.sourceId,
      target: session.target
    }),
    []
  );

  const cancelActiveSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    if (session.captureElement.hasPointerCapture(session.pointerId)) {
      session.captureElement.releasePointerCapture(session.pointerId);
    }
    sessionRef.current = null;
    callbacksRef.current.onCancel(snapshot(session));
  }, [snapshot]);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sessionRef.current) {
        event.preventDefault();
        cancelActiveSession();
      }
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('keydown', cancelOnEscape);
      cancelActiveSession();
    };
  }, [cancelActiveSession]);

  const begin = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      start: PointerReorderStart<TPayload>
    ) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element && event.target.closest(interactiveSelector))
      ) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      sessionRef.current = {
        ...start,
        active: false,
        captureElement: event.currentTarget,
        currentX: event.clientX,
        currentY: event.clientY,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        target: null
      };
    },
    []
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }

      session.currentX = event.clientX;
      session.currentY = event.clientY;

      if (
        !session.active &&
        Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= threshold
      ) {
        session.active = true;
        callbacksRef.current.onDragStart(snapshot(session));
      }
      if (!session.active) {
        return;
      }

      event.preventDefault();
      const rowElement = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>(rowSelector) ?? null;
      session.target = callbacksRef.current.resolveTarget(rowElement, {
        x: event.clientX,
        y: event.clientY
      });
      callbacksRef.current.onDragMove(snapshot(session));

      const scrollContainer = scrollContainerRef?.current;
      if (scrollContainer) {
        const bounds = scrollContainer.getBoundingClientRect();
        if (event.clientY < bounds.top + edgeScrollDistance) {
          scrollContainer.scrollBy({ top: -edgeScrollStep, behavior: 'auto' });
        } else if (event.clientY > bounds.bottom - edgeScrollDistance) {
          scrollContainer.scrollBy({ top: edgeScrollStep, behavior: 'auto' });
        }
      }
    },
    [edgeScrollDistance, edgeScrollStep, rowSelector, scrollContainerRef, snapshot, threshold]
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      session.currentX = event.clientX;
      session.currentY = event.clientY;
      sessionRef.current = null;
      if (session.active) {
        callbacksRef.current.onDrop(snapshot(session));
      } else {
        callbacksRef.current.onCancel(snapshot(session));
      }
    },
    [snapshot]
  );

  const cancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      session.currentX = event.clientX;
      session.currentY = event.clientY;
      sessionRef.current = null;
      callbacksRef.current.onCancel(snapshot(session));
    },
    [snapshot]
  );

  return {
    begin,
    cancel,
    finish,
    move
  };
}
