import type {
  FluxoraModFileTreeEntry,
  FluxoraTextFileDocument
} from '../../../shared/fluxora-api';

const textEditorExtensions = new Set([
  '.txt', '.json', '.jsonc', '.json5', '.ini', '.xml', '.yaml', '.yml', '.toml',
  '.cfg', '.conf', '.config', '.properties', '.log', '.md', '.markdown', '.csv',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.js', '.jsx', '.mjs',
  '.cjs', '.ts', '.tsx', '.vue', '.svelte', '.py', '.rb', '.php', '.java', '.c',
  '.cc', '.cpp', '.h', '.hpp', '.cs', '.rs', '.go', '.swift', '.kt', '.kts',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql',
  '.lock', '.meta', '.strings', '.po', '.pot', '.lua', '.pexmap', '.psc'
]);

const textEditorFileNames = new Set([
  '.babelrc', '.editorconfig', '.env', '.env.local', '.env.production', '.eslintrc',
  '.gitattributes', '.gitignore', '.gitmodules', '.npmrc', '.prettierrc',
  '.stylelintrc', '.yarnrc', 'changelog', 'license', 'readme'
]);

const languageByExtension: Record<string, TextEditorLanguage> = {
  '.bat': { id: 'bat', label: 'Batch' },
  '.bash': { id: 'shell', label: 'Shell Script' },
  '.c': { id: 'cpp', label: 'C' },
  '.cc': { id: 'cpp', label: 'C++' },
  '.cjs': { id: 'javascript', label: 'JavaScript' },
  '.cmd': { id: 'bat', label: 'Batch' },
  '.conf': { id: 'ini', label: 'Configuration' },
  '.config': { id: 'xml', label: 'XML' },
  '.cpp': { id: 'cpp', label: 'C++' },
  '.cs': { id: 'csharp', label: 'C#' },
  '.css': { id: 'css', label: 'CSS' },
  '.csv': { id: 'plaintext', label: 'CSV' },
  '.cfg': { id: 'ini', label: 'Configuration' },
  '.env': { id: 'ini', label: 'Environment' },
  '.gitignore': { id: 'plaintext', label: 'Ignore' },
  '.gql': { id: 'graphql', label: 'GraphQL' },
  '.go': { id: 'go', label: 'Go' },
  '.graphql': { id: 'graphql', label: 'GraphQL' },
  '.h': { id: 'cpp', label: 'C/C++ Header' },
  '.hpp': { id: 'cpp', label: 'C++ Header' },
  '.htm': { id: 'html', label: 'HTML' },
  '.html': { id: 'html', label: 'HTML' },
  '.ini': { id: 'ini', label: 'INI' },
  '.java': { id: 'java', label: 'Java' },
  '.js': { id: 'javascript', label: 'JavaScript' },
  '.json': { id: 'json', label: 'JSON' },
  '.json5': { id: 'json', label: 'JSON5' },
  '.jsonc': { id: 'json', label: 'JSON with Comments' },
  '.jsx': { id: 'javascript', label: 'JavaScript React' },
  '.kt': { id: 'kotlin', label: 'Kotlin' },
  '.kts': { id: 'kotlin', label: 'Kotlin Script' },
  '.less': { id: 'less', label: 'Less' },
  '.lock': { id: 'plaintext', label: 'Lock File' },
  '.log': { id: 'plaintext', label: 'Log' },
  '.lua': { id: 'lua', label: 'Lua' },
  '.markdown': { id: 'markdown', label: 'Markdown' },
  '.md': { id: 'markdown', label: 'Markdown' },
  '.meta': { id: 'plaintext', label: 'Metadata' },
  '.mjs': { id: 'javascript', label: 'JavaScript' },
  '.php': { id: 'php', label: 'PHP' },
  '.po': { id: 'plaintext', label: 'Gettext' },
  '.pot': { id: 'plaintext', label: 'Gettext Template' },
  '.properties': { id: 'ini', label: 'Properties' },
  '.ps1': { id: 'powershell', label: 'PowerShell' },
  '.psc': { id: 'papyrus', label: 'Papyrus' },
  '.py': { id: 'python', label: 'Python' },
  '.rb': { id: 'ruby', label: 'Ruby' },
  '.rs': { id: 'rust', label: 'Rust' },
  '.sass': { id: 'scss', label: 'Sass' },
  '.scss': { id: 'scss', label: 'SCSS' },
  '.sh': { id: 'shell', label: 'Shell Script' },
  '.sql': { id: 'sql', label: 'SQL' },
  '.strings': { id: 'plaintext', label: 'Strings' },
  '.svelte': { id: 'html', label: 'Svelte' },
  '.swift': { id: 'swift', label: 'Swift' },
  '.toml': { id: 'ini', label: 'TOML' },
  '.ts': { id: 'typescript', label: 'TypeScript' },
  '.tsx': { id: 'typescript', label: 'TypeScript React' },
  '.txt': { id: 'plaintext', label: 'Plain Text' },
  '.vue': { id: 'html', label: 'Vue' },
  '.xml': { id: 'xml', label: 'XML' },
  '.yaml': { id: 'yaml', label: 'YAML' },
  '.yml': { id: 'yaml', label: 'YAML' },
  '.zsh': { id: 'shell', label: 'Shell Script' }
};

const namedFileLanguages: Record<string, TextEditorLanguage> = {
  changelog: { id: 'markdown', label: 'Markdown' },
  license: { id: 'plaintext', label: 'Plain Text' },
  readme: { id: 'markdown', label: 'Markdown' }
};

export type TextEditorTabSource = 'mod' | 'file';
export type TextEditorBusyState = 'idle' | 'loading' | 'saving' | 'error';
export type TextEditorLineEnding = 'CRLF' | 'LF';

export interface TextEditorLanguage {
  id: string;
  label: string;
}

export interface TextEditorTab {
  id: string;
  source: TextEditorTabSource;
  path: string;
  fileName: string;
  relativePath?: string;
  modPath?: string;
  content: string;
  savedContent: string;
  languageId: string;
  languageLabel: string;
  state: TextEditorBusyState;
  errorMessage?: string;
}

export interface TextEditorSearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
}

export interface TextEditorSearchResult {
  tabId: string;
  fileName: string;
  path: string;
  line: number;
  column: number;
  matchLength: number;
  preview: string;
}

export interface TextEditorFileTreeRow {
  entry: FluxoraModFileTreeEntry;
  depth: number;
}

const extensionOf = (name: string): string => {
  const normalized = name.trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
};

export const fileNameFromPath = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name || 'Untitled.txt';
};

export const isTextEditorFileName = (name: string): boolean => {
  const trimmed = name.trim().toLowerCase();
  if (textEditorFileNames.has(trimmed)) {
    return true;
  }

  const extension = extensionOf(trimmed);
  return extension.length > 0 && textEditorExtensions.has(extension);
};

export const textEditorLanguageForFile = (name: string): TextEditorLanguage => {
  const normalized = fileNameFromPath(name).trim().toLowerCase();
  return namedFileLanguages[normalized]
    ?? languageByExtension[extensionOf(normalized)]
    ?? { id: 'plaintext', label: 'Plain Text' };
};

export const textEditorTabId = (source: TextEditorTabSource, path: string): string =>
  `${source}:${path}`;

export const createTextEditorTab = (
  document: FluxoraTextFileDocument,
  source: TextEditorTabSource,
  modPath?: string
): TextEditorTab => {
  const fileName = document.fileName || fileNameFromPath(document.path);
  const language = textEditorLanguageForFile(fileName);
  const identityPath = source === 'mod'
    ? `${modPath ?? ''}:${document.relativePath ?? document.path}`
    : document.path;

  return {
    id: textEditorTabId(source, identityPath),
    source,
    path: document.path,
    fileName,
    relativePath: document.relativePath,
    modPath,
    content: document.content,
    savedContent: document.content,
    languageId: language.id,
    languageLabel: language.label,
    state: 'idle'
  };
};

export const isTextEditorTabDirty = (tab: TextEditorTab): boolean =>
  tab.content !== tab.savedContent;

export const detectLineEnding = (content: string): TextEditorLineEnding =>
  content.includes('\r\n') ? 'CRLF' : 'LF';

export const flattenTextEditorFileTree = (
  cache: Readonly<Record<string, readonly FluxoraModFileTreeEntry[]>>,
  expandedDirectories: ReadonlySet<string>
): TextEditorFileTreeRow[] => {
  const rows: TextEditorFileTreeRow[] = [];
  const visited = new Set<string>();

  const appendDirectory = (relativeDirectory: string, depth: number) => {
    if (visited.has(relativeDirectory)) {
      return;
    }
    visited.add(relativeDirectory);

    for (const entry of cache[relativeDirectory] ?? []) {
      rows.push({ entry, depth });
      if (entry.isDirectory && expandedDirectories.has(entry.relativePath)) {
        appendDirectory(entry.relativePath, depth + 1);
      }
    }
  };

  appendDirectory('', 0);
  return rows;
};

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const searchExpression = (
  query: string,
  options: TextEditorSearchOptions
): RegExp | null => {
  if (!query) {
    return null;
  }

  const source = options.useRegex ? query : escapeRegularExpression(query);
  const wholeWordSource = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wholeWordSource, options.matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
};

export const searchTextEditorTabs = (
  tabs: readonly TextEditorTab[],
  query: string,
  options: TextEditorSearchOptions = {}
): TextEditorSearchResult[] => {
  const expression = searchExpression(query, options);
  if (!expression) {
    return [];
  }

  const results: TextEditorSearchResult[] = [];
  for (const tab of tabs) {
    const lines = tab.content.split(/\r?\n/);
    lines.forEach((lineText, lineIndex) => {
      expression.lastIndex = 0;
      let match = expression.exec(lineText);
      while (match) {
        results.push({
          tabId: tab.id,
          fileName: tab.fileName,
          path: tab.relativePath ?? tab.path,
          line: lineIndex + 1,
          column: match.index + 1,
          matchLength: Math.max(1, match[0].length),
          preview: lineText.trim() || lineText
        });

        if (match[0].length === 0) {
          expression.lastIndex += 1;
        }
        match = expression.exec(lineText);
      }
    });
  }

  return results;
};
