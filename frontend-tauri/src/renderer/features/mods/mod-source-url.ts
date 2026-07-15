export interface ModSourceIdentity {
  sourceIsNexus?: boolean;
  sourceProvider?: string;
  sourceGameDomain?: string;
  sourceModId?: string;
  sourceUrl?: string;
}

const nexusGameDomainPattern = /^[a-z0-9][a-z0-9-]*$/i;
const nexusModIdPattern = /^[1-9][0-9]*$/;

const nexusPageUrl = (gameDomainValue?: string, modIdValue?: string): string | null => {
  const gameDomain = gameDomainValue?.trim();
  const modId = modIdValue?.trim();
  if (
    !gameDomain ||
    !modId ||
    !nexusGameDomainPattern.test(gameDomain) ||
    !nexusModIdPattern.test(modId)
  ) {
    return null;
  }

  return `https://www.nexusmods.com/${gameDomain.toLowerCase()}/mods/${modId}`;
};

export function resolveModSourcePageUrl(source: ModSourceIdentity): string | null {
  const provider = source.sourceProvider?.trim().toLowerCase();
  const isNexusSource = Boolean(source.sourceIsNexus || provider === 'nexus');
  const metadataPageUrl = nexusPageUrl(source.sourceGameDomain, source.sourceModId);

  if (isNexusSource && metadataPageUrl) {
    return metadataPageUrl;
  }

  const sourceUrl = source.sourceUrl?.trim();
  if (!sourceUrl || /\s/.test(sourceUrl)) {
    return null;
  }

  try {
    const parsed = new URL(sourceUrl);
    if (isNexusSource && parsed.protocol === 'nxm:') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const nxmModId = pathParts[0] === 'mods' ? pathParts[1] : undefined;
      const nxmPageUrl = nexusPageUrl(parsed.hostname, nxmModId);
      if (nxmPageUrl) {
        return nxmPageUrl;
      }
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return null;
    }

    return sourceUrl;
  } catch {
    return null;
  }
}
