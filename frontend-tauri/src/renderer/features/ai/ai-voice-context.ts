export interface AiVoiceContextSource {
  buildTerms: readonly string[];
  draft: string;
  recentMessages: readonly string[];
}

const MAX_CONTEXT_HINTS = 96;
const MAX_CONTEXT_HINT_CHARS = 96;
const MAX_CONTEXT_TOTAL_CHARS = 4_096;
const MAX_ENCODED_CONTEXT_CHARS = 12_000;
const TECHNICAL_SPAN = /[A-Za-z0-9][A-Za-z0-9_.+-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9_.+-]*)*/g;

const normalizeHint = (value: string): string => value
  .replace(/\s+/g, ' ')
  .replace(/^[\s'"`([{<]+|[\s'"`)\]}>.,;:!?]+$/g, '')
  .trim();

const technicalSpans = (value: string): string[] => {
  const matches = value.match(TECHNICAL_SPAN) ?? [];
  return matches.flatMap((match) => {
    const words = match.split(/\s+/).filter(Boolean);
    if (words.length <= 8) return [match];
    const chunks: string[] = [];
    for (let index = 0; index < words.length; index += 8) {
      chunks.push(words.slice(index, index + 8).join(' '));
    }
    return chunks;
  });
};

const buildTermVariants = (value: string): string[] => {
  const parts = value
    .split(/\s+(?:-|\u2013|\u2014|\||\/)\s+/)
    .map(normalizeHint)
    .filter(Boolean);
  return parts.length > 1 ? [value, ...parts] : [value];
};

export const buildVoiceContextHints = ({
  buildTerms,
  draft,
  recentMessages
}: AiVoiceContextSource): string[] => {
  const hints: string[] = [];
  const seen = new Set<string>();
  let totalCharacters = 0;
  const add = (candidate: string) => {
    const normalized = normalizeHint(candidate);
    const key = normalized.toLocaleLowerCase('en-US');
    if (
      normalized.length < 2
      || normalized.length > MAX_CONTEXT_HINT_CHARS
      || !/[A-Za-z]/.test(normalized)
      || /[\u0000-\u001f\u007f]/.test(normalized)
      || seen.has(key)
      || hints.length >= MAX_CONTEXT_HINTS
      || totalCharacters + normalized.length > MAX_CONTEXT_TOTAL_CHARS
      || encodeURIComponent(JSON.stringify([...hints, normalized])).length > MAX_ENCODED_CONTEXT_CHARS
    ) return;
    seen.add(key);
    hints.push(normalized);
    totalCharacters += normalized.length;
  };

  technicalSpans(draft).forEach(add);
  recentMessages.slice(-4).reverse().flatMap(technicalSpans).forEach(add);
  buildTerms.flatMap(buildTermVariants).forEach(add);
  return hints;
};
