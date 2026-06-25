export const shortPath = (path: string): string => {
  if (!path) {
    return 'not set';
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? path : `${parts.at(-2)}\\${parts.at(-1)}`;
};

export const defaultModNameFromPath = (path: string): string => {
  const fileName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return fileName.replace(/\.(zip|7z|rar|fomod|omod|ba2|bsa)$/i, '').trim() || fileName;
};
