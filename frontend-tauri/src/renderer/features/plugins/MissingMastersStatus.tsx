import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';

import missingMasterIcon from '../../../../../Icons/exclamation-lg.svg';
import {
  pluginMissingMasterSummary,
  type PluginMissingMasterSummary
} from '../../plugin-workspace-state';
import type { FluxoraPluginOrderItem } from '../../../shared/fluxora-api';
import {
  useLocalization,
  type LocalizationContextValue
} from '../../../localization/react';

const TOOLTIP_GAP = 8;
const VIEWPORT_MARGIN = 12;
const TOOLTIP_MAX_WIDTH = 360;
const TOOLTIP_MIN_HEIGHT = 96;
const MISSING_MASTER_LIMIT = 20;

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  placement: TooltipPlacement;
}

interface MissingMastersStatusProps {
  enabled: boolean;
  plugin: FluxoraPluginOrderItem;
  label?: string;
  summary?: PluginMissingMasterSummary;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const tooltipLabel = (
  plugin: FluxoraPluginOrderItem,
  summary: PluginMissingMasterSummary,
  t: LocalizationContextValue['t']
): string => {
  const hiddenText = summary.hiddenCount > 0
    ? `, ${t('missingMasters.more', { count: summary.hiddenCount })}`
    : '';
  const itemTitle = plugin.isSeparator
    ? t('missingMasters.separatorContext', {
        name: plugin.separatorTitle || plugin.name || plugin.orderId
      })
    : t('missingMasters.pluginContext', { name: plugin.name });
  return t('missingMasters.label', {
    context: itemTitle,
    masters: summary.visibleMasters.join(', '),
    more: hiddenText
  });
};

const choosePlacement = (
  anchor: DOMRect,
  tooltip: DOMRect,
  viewportWidth: number,
  viewportHeight: number
): TooltipPlacement => {
  const spaces: Record<TooltipPlacement, number> = {
    bottom: viewportHeight - anchor.bottom - TOOLTIP_GAP - VIEWPORT_MARGIN,
    top: anchor.top - TOOLTIP_GAP - VIEWPORT_MARGIN,
    right: viewportWidth - anchor.right - TOOLTIP_GAP - VIEWPORT_MARGIN,
    left: anchor.left - TOOLTIP_GAP - VIEWPORT_MARGIN
  };

  const preferred: TooltipPlacement[] = ['bottom', 'top', 'right', 'left'];
  const fitting = preferred.find((placement) => {
    const available = spaces[placement];
    return placement === 'bottom' || placement === 'top'
      ? available >= tooltip.height
      : available >= tooltip.width;
  });

  if (fitting) {
    return fitting;
  }

  return preferred.reduce((best, placement) =>
    spaces[placement] > spaces[best] ? placement : best
  );
};

export function MissingMastersStatus({
  enabled,
  label,
  plugin,
  summary: summaryOverride
}: MissingMastersStatusProps) {
  const { t } = useLocalization();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const tooltipId = `plugin-missing-masters-${generatedId.replace(/:/g, '')}`;
  const fallbackSummary = useMemo(
    () => pluginMissingMasterSummary(plugin, MISSING_MASTER_LIMIT),
    [plugin]
  );
  const summary = summaryOverride ?? fallbackSummary;
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const isVisible = enabled && summary.totalCount > 0;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) {
      return;
    }

    const anchorRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const placement = choosePlacement(anchorRect, tooltipRect, viewportWidth, viewportHeight);
    const maxWidth = Math.min(TOOLTIP_MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(
      TOOLTIP_MIN_HEIGHT,
      viewportHeight - VIEWPORT_MARGIN * 2
    );

    let left = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    let top = anchorRect.bottom + TOOLTIP_GAP;

    if (placement === 'top') {
      top = anchorRect.top - tooltipRect.height - TOOLTIP_GAP;
    } else if (placement === 'right') {
      left = anchorRect.right + TOOLTIP_GAP;
      top = anchorRect.top + anchorRect.height / 2 - tooltipRect.height / 2;
    } else if (placement === 'left') {
      left = anchorRect.left - tooltipRect.width - TOOLTIP_GAP;
      top = anchorRect.top + anchorRect.height / 2 - tooltipRect.height / 2;
    }

    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - tooltipRect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - tooltipRect.height - VIEWPORT_MARGIN);

    setPosition({
      left: clamp(left, VIEWPORT_MARGIN, maxLeft),
      top: clamp(top, VIEWPORT_MARGIN, maxTop),
      maxWidth,
      maxHeight,
      placement
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !isVisible) {
      return;
    }

    updatePosition();
  }, [isOpen, isVisible, summary.totalCount, updatePosition]);

  useEffect(() => {
    if (!isOpen || !isVisible) {
      return;
    }

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, isVisible, updatePosition]);

  if (!isVisible) {
    return null;
  }

  const iconStyle = {
    '--plugin-missing-master-icon': `url("${missingMasterIcon}")`
  } as CSSProperties;

  const tooltip = isOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="plugin-missing-master-tooltip"
          data-placement={position?.placement ?? 'bottom'}
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            maxWidth: position?.maxWidth,
            maxHeight: position?.maxHeight,
            visibility: position ? 'visible' : 'hidden'
          }}
        >
          <strong>{t('missingMasters.title')}</strong>
          <ul>
            {summary.visibleMasters.map((master) => (
              <li key={master}>{master}</li>
            ))}
          </ul>
          {summary.hiddenCount > 0 ? (
            <span className="plugin-missing-master-tooltip__more">
              {t('missingMasters.more', { count: summary.hiddenCount })}
            </span>
          ) : null}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-label={label ?? tooltipLabel(plugin, summary, t)}
        className="plugin-missing-master-trigger"
        onBlur={() => {
          setIsOpen(false);
          setPosition(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onFocus={() => setIsOpen(true)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => {
          setIsOpen(false);
          setPosition(null);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={triggerRef}
        style={iconStyle}
        title=""
        type="button"
      >
        <span className="plugin-missing-master-icon" aria-hidden="true" />
      </button>
      {tooltip}
    </>
  );
}
