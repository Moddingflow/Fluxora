import type { ComponentType } from 'react';

import { Icon, type IconName, type IconProps } from './Icon';

export type RootIconProps = Omit<IconProps, 'name'>;

function rootIcon(name: IconName): ComponentType<RootIconProps> {
  function RootIcon(props: RootIconProps) {
    return <Icon {...props} name={name} />;
  }

  RootIcon.displayName = `RootIcon(${name})`;
  return RootIcon;
}

export const AlertTriangle = rootIcon('alert-triangle');
export const ArrowLeft = rootIcon('back');
export const Bot = rootIcon('bot');
export const Box = rootIcon('box');
export const CaseSensitive = rootIcon('case-sensitive');
export const Check = rootIcon('check');
export const CheckCircle2 = rootIcon('circle-check');
export const ChevronDown = rootIcon('chevron-down');
export const ChevronLeft = rootIcon('chevron-left');
export const ChevronRight = rootIcon('chevron-right');
export const CircleAlert = rootIcon('circle-alert');
export const CircleDot = rootIcon('circle-dot');
export const Code2 = rootIcon('code-xml');
export const Command = rootIcon('command');
export const Copy = rootIcon('copy');
export const Download = rootIcon('download');
export const ExternalLink = rootIcon('open');
export const File = rootIcon('file');
export const FileArchive = rootIcon('file-archive');
export const FileCode2 = rootIcon('file-code-corner');
export const FilePenLine = rootIcon('file-pen-line');
export const FileText = rootIcon('file-text');
export const Files = rootIcon('files');
export const Folder = rootIcon('folder');
export const FolderOpen = rootIcon('folder-open');
export const FolderPlus = rootIcon('folder-plus');
export const FolderTree = rootIcon('folder-tree');
export const Gauge = rootIcon('gauge');
export const Globe2 = rootIcon('earth');
export const HardDrive = rootIcon('hard-drive');
export const Home = rootIcon('house');
export const Languages = rootIcon('language');
export const Layers = rootIcon('layers');
export const Link2 = rootIcon('link');
export const LoaderCircle = rootIcon('loader-circle');
export const Maximize2 = rootIcon('image-expand');
export const Mic = rootIcon('ai-mic');
export const MonitorCog = rootIcon('monitor-cog');
export const MoreHorizontal = rootIcon('more-horizontal');
export const Move = rootIcon('move');
export const PackageCheck = rootIcon('package-check');
export const PackageOpen = rootIcon('package-open');
export const PanelBottom = rootIcon('panel-bottom');
export const Pencil = rootIcon('pencil');
export const Play = rootIcon('play');
export const Plug = rootIcon('plug');
export const Plus = rootIcon('plus');
export const Redo2 = rootIcon('redo-2');
export const RefreshCw = rootIcon('refresh');
export const Regex = rootIcon('regex');
export const RotateCcw = rootIcon('rotate-ccw');
export const Save = rootIcon('save');
export const Search = rootIcon('search');
export const Send = rootIcon('send');
export const Settings = rootIcon('settings');
export const ShieldCheck = rootIcon('shield-check');
export const Square = rootIcon('window-maximize');
export const Trash2 = rootIcon('trash-2');
export const Undo2 = rootIcon('undo-2');
export const UploadCloud = rootIcon('cloud-upload');
export const WholeWord = rootIcon('whole-word');
export const X = rootIcon('window-close');
export const XCircle = rootIcon('circle-x');
