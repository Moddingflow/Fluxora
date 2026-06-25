export const cx = (...parts: Array<false | null | string | undefined>): string =>
  parts.filter(Boolean).join(' ');
