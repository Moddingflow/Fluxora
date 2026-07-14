import type {
  FluxoraModDetailsContent,
  FluxoraModFileTreeEntry
} from '../../../shared/fluxora-api';

export interface ModDetailsContentCache {
  clear: () => void;
  load: (
    key: string,
    loader: () => Promise<FluxoraModDetailsContent>
  ) => Promise<FluxoraModDetailsContent>;
}

export const modDetailsContentCacheKey = (
  projectDirectory: string,
  modPath: string
): string => JSON.stringify([projectDirectory, modPath]);

export const modDetailsContentFileTree = (
  content: FluxoraModDetailsContent
): Record<string, FluxoraModFileTreeEntry[]> => {
  const fileTree: Record<string, FluxoraModFileTreeEntry[]> = {};
  for (const directory of content.directories) {
    fileTree[directory.relativePath] = [...directory.entries];
  }
  fileTree[''] ??= [];
  return fileTree;
};

export const createModDetailsContentCache = (maxEntries = 3): ModDetailsContentCache => {
  const requests = new Map<string, Promise<FluxoraModDetailsContent>>();
  const capacity = Math.max(1, Math.trunc(maxEntries));

  return {
    clear: () => requests.clear(),
    load: (key, loader) => {
      const current = requests.get(key);
      if (current) {
        requests.delete(key);
        requests.set(key, current);
        return current;
      }

      let request: Promise<FluxoraModDetailsContent>;
      request = Promise.resolve()
        .then(loader)
        .catch((error) => {
          if (requests.get(key) === request) {
            requests.delete(key);
          }
          throw error;
        });
      requests.set(key, request);
      while (requests.size > capacity) {
        const oldestKey = requests.keys().next().value as string | undefined;
        if (oldestKey === undefined) {
          break;
        }
        requests.delete(oldestKey);
      }
      return request;
    }
  };
};
