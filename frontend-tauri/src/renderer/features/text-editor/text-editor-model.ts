import type {
  FluxoraModFileTreeEntry,
  FluxoraTextFileDocument
} from '../../../shared/fluxora-api';
import {
  translateForLanguage,
  type TranslationKey
} from '../../../localization';

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

interface TextEditorLanguageDescriptor {
  id: string;
  labelKey: TranslationKey;
}

const languageByExtension: Record<string, TextEditorLanguageDescriptor> = {
  '.bat': { id: 'bat', labelKey: 'editor.language.batch' },
  '.bash': { id: 'shell', labelKey: 'editor.language.shell' },
  '.c': { id: 'cpp', labelKey: 'editor.language.c' },
  '.cc': { id: 'cpp', labelKey: 'editor.language.cpp' },
  '.cjs': { id: 'javascript', labelKey: 'editor.language.javascript' },
  '.cmd': { id: 'bat', labelKey: 'editor.language.batch' },
  '.conf': { id: 'ini', labelKey: 'editor.language.configuration' },
  '.config': { id: 'xml', labelKey: 'editor.language.xml' },
  '.cpp': { id: 'cpp', labelKey: 'editor.language.cpp' },
  '.cs': { id: 'csharp', labelKey: 'editor.language.csharp' },
  '.css': { id: 'css', labelKey: 'editor.language.css' },
  '.csv': { id: 'plaintext', labelKey: 'editor.language.csv' },
  '.cfg': { id: 'ini', labelKey: 'editor.language.configuration' },
  '.env': { id: 'ini', labelKey: 'editor.language.environment' },
  '.gitignore': { id: 'plaintext', labelKey: 'editor.language.ignore' },
  '.gql': { id: 'graphql', labelKey: 'editor.language.graphql' },
  '.go': { id: 'go', labelKey: 'editor.language.go' },
  '.graphql': { id: 'graphql', labelKey: 'editor.language.graphql' },
  '.h': { id: 'cpp', labelKey: 'editor.language.headerC' },
  '.hpp': { id: 'cpp', labelKey: 'editor.language.headerCpp' },
  '.htm': { id: 'html', labelKey: 'editor.language.html' },
  '.html': { id: 'html', labelKey: 'editor.language.html' },
  '.ini': { id: 'ini', labelKey: 'editor.language.ini' },
  '.java': { id: 'java', labelKey: 'editor.language.java' },
  '.js': { id: 'javascript', labelKey: 'editor.language.javascript' },
  '.json': { id: 'json', labelKey: 'editor.language.json' },
  '.json5': { id: 'json', labelKey: 'editor.language.json5' },
  '.jsonc': { id: 'json', labelKey: 'editor.language.jsonComments' },
  '.jsx': { id: 'javascript', labelKey: 'editor.language.javascriptReact' },
  '.kt': { id: 'kotlin', labelKey: 'editor.language.kotlin' },
  '.kts': { id: 'kotlin', labelKey: 'editor.language.kotlinScript' },
  '.less': { id: 'less', labelKey: 'editor.language.less' },
  '.lock': { id: 'plaintext', labelKey: 'editor.language.lockFile' },
  '.log': { id: 'plaintext', labelKey: 'editor.language.log' },
  '.lua': { id: 'lua', labelKey: 'editor.language.lua' },
  '.markdown': { id: 'markdown', labelKey: 'editor.language.markdown' },
  '.md': { id: 'markdown', labelKey: 'editor.language.markdown' },
  '.meta': { id: 'plaintext', labelKey: 'editor.language.metadata' },
  '.mjs': { id: 'javascript', labelKey: 'editor.language.javascript' },
  '.php': { id: 'php', labelKey: 'editor.language.php' },
  '.po': { id: 'plaintext', labelKey: 'editor.language.gettext' },
  '.pot': { id: 'plaintext', labelKey: 'editor.language.gettextTemplate' },
  '.properties': { id: 'ini', labelKey: 'editor.language.properties' },
  '.ps1': { id: 'powershell', labelKey: 'editor.language.powershell' },
  '.psc': { id: 'papyrus', labelKey: 'editor.language.papyrus' },
  '.py': { id: 'python', labelKey: 'editor.language.python' },
  '.rb': { id: 'ruby', labelKey: 'editor.language.ruby' },
  '.rs': { id: 'rust', labelKey: 'editor.language.rust' },
  '.sass': { id: 'scss', labelKey: 'editor.language.sass' },
  '.scss': { id: 'scss', labelKey: 'editor.language.scss' },
  '.sh': { id: 'shell', labelKey: 'editor.language.shell' },
  '.sql': { id: 'sql', labelKey: 'editor.language.sql' },
  '.strings': { id: 'plaintext', labelKey: 'editor.language.strings' },
  '.svelte': { id: 'html', labelKey: 'editor.language.svelte' },
  '.swift': { id: 'swift', labelKey: 'editor.language.swift' },
  '.toml': { id: 'ini', labelKey: 'editor.language.toml' },
  '.ts': { id: 'typescript', labelKey: 'editor.language.typescript' },
  '.tsx': { id: 'typescript', labelKey: 'editor.language.typescriptReact' },
  '.txt': { id: 'plaintext', labelKey: 'editor.language.plainText' },
  '.vue': { id: 'html', labelKey: 'editor.language.vue' },
  '.xml': { id: 'xml', labelKey: 'editor.language.xml' },
  '.yaml': { id: 'yaml', labelKey: 'editor.language.yaml' },
  '.yml': { id: 'yaml', labelKey: 'editor.language.yaml' },
  '.zsh': { id: 'shell', labelKey: 'editor.language.shell' }
};

const namedFileLanguages: Record<string, TextEditorLanguageDescriptor> = {
  changelog: { id: 'markdown', labelKey: 'editor.language.markdown' },
  license: { id: 'plaintext', labelKey: 'editor.language.plainText' },
  readme: { id: 'markdown', labelKey: 'editor.language.markdown' }
};

export type TextEditorTabSource = 'mod' | 'file' | 'ai';
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
  aiChatId?: string;
  fileRef?: string;
  baseSha256?: string;
  readOnly?: boolean;
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

export const textEditorLanguageForFile = (
  name: string,
  language?: string | null
): TextEditorLanguage => {
  const normalized = fileNameFromPath(name).trim().toLowerCase();
  const descriptor = namedFileLanguages[normalized]
    ?? languageByExtension[extensionOf(normalized)]
    ?? { id: 'plaintext', labelKey: 'editor.language.plainText' as const };
  return {
    id: descriptor.id,
    label: translateForLanguage(language, descriptor.labelKey)
  };
};

export const textEditorTabId = (source: TextEditorTabSource, path: string): string =>
  `${source}:${path}`;

export const createTextEditorTab = (
  document: FluxoraTextFileDocument,
  source: TextEditorTabSource,
  modPath?: string,
  language?: string | null
): TextEditorTab => {
  const fileName = document.fileName || fileNameFromPath(document.path);
  const editorLanguage = textEditorLanguageForFile(fileName, language);
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
    languageId: editorLanguage.id,
    languageLabel: editorLanguage.label,
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
