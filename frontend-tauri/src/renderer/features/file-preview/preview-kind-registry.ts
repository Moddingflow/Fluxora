import cuboidIcon from '../../../../../Icons/cuboid.svg';

export type FilePreviewKind = 'nif';

export interface FilePreviewKindDescriptor {
  kind: FilePreviewKind;
  extension: string;
  title: string;
  icon: string;
}

export const filePreviewKindRegistry: Record<FilePreviewKind, FilePreviewKindDescriptor> = {
  nif: {
    kind: 'nif',
    extension: '.nif',
    title: '.nif Preview',
    icon: cuboidIcon
  }
};

export const previewKindForFile = (fileName: string): FilePreviewKindDescriptor | null => {
  const lowerName = fileName.trim().toLowerCase();
  return Object.values(filePreviewKindRegistry).find((item) => lowerName.endsWith(item.extension)) ?? null;
};

export const previewKindById = (kind: string | null | undefined): FilePreviewKindDescriptor =>
  filePreviewKindRegistry[kind === 'nif' ? 'nif' : 'nif'];
