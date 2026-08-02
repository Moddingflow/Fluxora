export interface FluxoraReleaseAnnouncement {
  channel: 'stable';
  githubReleaseId: string;
  publishedAt: string;
  tagName: string;
  version: string;
}

const strictSemverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const releaseIdPattern = /^[1-9][0-9]*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const semverParts = (value: string): readonly [bigint, bigint, bigint] | null => {
  const match = strictSemverPattern.exec(value);
  if (!match) return null;
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
};

export const compareStrictSemver = (left: string, right: string): -1 | 0 | 1 | null => {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
};

const normalizeReleaseId = (value: unknown): string | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !releaseIdPattern.test(value)) return null;
  return value;
};

export const parseFluxoraReleaseAnnouncement = (
  value: unknown
): FluxoraReleaseAnnouncement | null => {
  if (!isRecord(value) || value.channel !== 'stable') return null;
  const githubReleaseId = normalizeReleaseId(value.github_release_id);
  if (!githubReleaseId) return null;
  if (typeof value.version !== 'string' || !strictSemverPattern.test(value.version)) {
    return null;
  }
  if (value.tag_name !== `v${value.version}`) return null;
  if (typeof value.published_at !== 'string') return null;
  const publishedAt = new Date(value.published_at);
  if (!Number.isFinite(publishedAt.getTime())) return null;

  return {
    channel: 'stable',
    githubReleaseId,
    publishedAt: publishedAt.toISOString(),
    tagName: value.tag_name,
    version: value.version
  };
};
