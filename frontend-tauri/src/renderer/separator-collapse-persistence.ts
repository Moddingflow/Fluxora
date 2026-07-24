export type SeparatorCollapseWorkspace = 'mods' | 'plugins';

interface SeparatorCollapseStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const separatorCollapseStoragePrefix = 'fluxora.ui.separator-collapse.v1';

const separatorCollapseStorageKey = (
  projectId: string,
  workspace: SeparatorCollapseWorkspace
): string => `${separatorCollapseStoragePrefix}:${workspace}:${encodeURIComponent(projectId)}`;

export const loadCollapsedSeparatorOrderIds = (
  storage: SeparatorCollapseStorage,
  projectId: string,
  workspace: SeparatorCollapseWorkspace
): ReadonlySet<string> => {
  if (!projectId.trim()) {
    return new Set<string>();
  }

  try {
    const serialized = storage.getItem(separatorCollapseStorageKey(projectId, workspace));
    if (!serialized) {
      return new Set<string>();
    }

    const orderIds = JSON.parse(serialized);
    if (!Array.isArray(orderIds)) {
      return new Set<string>();
    }

    return new Set(
      orderIds.filter((orderId): orderId is string => typeof orderId === 'string' && orderId.length > 0)
    );
  } catch {
    return new Set<string>();
  }
};

export const saveCollapsedSeparatorOrderIds = (
  storage: SeparatorCollapseStorage,
  projectId: string,
  workspace: SeparatorCollapseWorkspace,
  collapsedSeparatorOrderIds: ReadonlySet<string>
): void => {
  if (!projectId.trim()) {
    return;
  }

  const key = separatorCollapseStorageKey(projectId, workspace);
  const orderIds = [...collapsedSeparatorOrderIds].filter(Boolean).sort();

  try {
    if (orderIds.length === 0) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, JSON.stringify(orderIds));
  } catch {
    // UI state persistence must never block opening or using a build.
  }
};
