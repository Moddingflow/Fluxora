import type { SVGProps } from 'react';

const STROKE_PATHS = {
  plus: ['M12 5v14M5 12h14'],
  open: ['M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3'],
  refresh: [
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5'
  ],
  back: ['M19 12H5M12 19l-7-7 7-7'],
  settings: [
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
  ],
  gamepad: [
    'M6 12h4m-2-2v4M15 11h.01M18 13h.01',
    'M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z'
  ],
  folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  'hard-drive': ['M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01'],
  calendar: ['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  layers: [
    'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    'M2 12l8.58 3.91a2 2 0 0 0 1.66 0L22 12',
    'M2 17l8.58 3.91a2 2 0 0 0 1.66 0L22 17'
  ],
  'file-text': ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8'],
  'image-expand': ['M8 3H3v5M3 3l7 7M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M16 21h5v-5M21 21l-7-7'],
  link: ['M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8'],
  language: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20M4.9 5h14.2M4.9 19h14.2'],
  transfer: ['M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4'],
  'alert-triangle': ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01'],
  trash: ['M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6'],
  'more-horizontal': [],
  search: [],
  'conflict-plus': ['M12 7.5v9M7.5 12h9'],
  'conflict-minus': ['M7.5 12h9'],
  'conflict-dot': [],
  'window-minimize': ['M5 12h14'],
  'window-maximize': ['M5 5h14v14H5z'],
  'window-restore': ['M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M4 10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'],
  'window-close': ['M18 6 6 18M6 6l12 12']
} as const;

export type IconName = keyof typeof STROKE_PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  title?: string;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  title,
  className,
  style,
  ...rest
}: IconProps) {
  const titleId = title ? `flx-icon-${name}-${String(title).replace(/\W+/g, '-').toLowerCase()}` : undefined;
  const paths = STROKE_PATHS[name];

  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-labelledby={titleId}
      className={className}
      fill="none"
      height={size}
      role={title ? 'img' : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      style={{ display: 'block', flexShrink: 0, ...style }}
      viewBox="0 0 24 24"
      width={size}
      {...rest}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      {name === 'search' ? (
        <>
          <circle cx="11" cy="11" r="7" />
          <line x1="16.2" x2="21" y1="16.2" y2="21" />
        </>
      ) : name === 'more-horizontal' ? (
        <>
          <circle cx="5" cy="12" fill="currentColor" r="1.5" stroke="none" />
          <circle cx="12" cy="12" fill="currentColor" r="1.5" stroke="none" />
          <circle cx="19" cy="12" fill="currentColor" r="1.5" stroke="none" />
        </>
      ) : name === 'conflict-dot' ? (
        <circle cx="12" cy="12" fill="currentColor" r="5" stroke="none" />
      ) : (
        paths.map((path, index) => <path d={path} key={`${name}-${index}`} />)
      )}
    </svg>
  );
}
