import cuboidIcon from '../../../../../Icons/cuboid.svg';
import type { TranslationKey } from '../../../localization';

export type FilePreviewKind = 'nif';

export interface FilePreviewKindDescriptor {
  kind: FilePreviewKind;
  extension: string;
  titleKey: TranslationKey;
  icon: string;
}

export const filePreviewKindRegistry: Record<FilePreviewKind, FilePreviewKindDescriptor> = {
  nif: {
    kind: 'nif',
    extension: '.nif',
    titleKey: 'preview.nif.title',
    icon: cuboidIcon
  }
};

export const previewKindForFile = (fileName: string): FilePreviewKindDescriptor | null => {
  const lowerName = fileName.trim().toLowerCase();
  return Object.values(filePreviewKindRegistry).find((item) => lowerName.endsWith(item.extension)) ?? null;
};

export const previewKindById = (kind: string | null | undefined): FilePreviewKindDescriptor =>
  filePreviewKindRegistry[kind === 'nif' ? 'nif' : 'nif'];
