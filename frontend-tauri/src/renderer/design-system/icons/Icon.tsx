import type { HTMLAttributes, SVGProps } from 'react';

import { ICON_ASSETS, type IconName } from './icon-assets';

export type { IconName } from './icon-assets';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'name' | 'title'> {
  name: IconName;
  size?: number;
  /**
   * Kept for source compatibility. Stroke geometry is owned by the pinned
   * upstream SVG and cannot be mutated by the renderer.
   */
  strokeWidth?: number;
  title?: string;
}

/**
 * Uses the root SVG as a CSS mask so icons inherit `currentColor` without
 * copying or injecting SVG path data into the renderer.
 */
export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  title,
  className,
  style,
  ...rest
}: IconProps) {
  const asset = ICON_ASSETS[name];
  const elementProps = rest as HTMLAttributes<HTMLSpanElement>;
  const accessibleName =
    title ??
    (typeof elementProps['aria-label'] === 'string'
      ? elementProps['aria-label']
      : undefined);
  const explicitlyHidden = elementProps['aria-hidden'];

  return (
    <span
      {...elementProps}
      aria-hidden={explicitlyHidden ?? (accessibleName ? undefined : true)}
      aria-label={accessibleName}
      className={className}
      data-icon={name}
      data-stroke-width={strokeWidth}
      role={accessibleName ? 'img' : elementProps.role}
      style={{
        backgroundColor: 'currentColor',
        display: 'inline-block',
        flexShrink: 0,
        height: size,
        maskImage: `url("${asset}")`,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: 'contain',
        verticalAlign: 'middle',
        WebkitMaskImage: `url("${asset}")`,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        width: size,
        ...style
      }}
      title={title}
    />
  );
}
