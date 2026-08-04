import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
  Regex,
  WholeWord,
  X
} from '../../design-system/icons/lucide-compat';
import { useLocalization } from '../../../localization/react';

import type {
  TextEditorFileTreeRow,
  TextEditorSearchOptions,
  TextEditorSearchResult,
  TextEditorTab
} from './text-editor-model';
import { isTextEditorFileName, isTextEditorTabDirty } from './text-editor-model';

export type TextEditorSidebarView = 'explorer' | 'search';

interface TextEditorSidebarProps {
  view: TextEditorSidebarView;
  tabs: TextEditorTab[];
  activeTabId: string | null;
  modName: string | null;
  fileTreeRows: TextEditorFileTreeRow[];
  expandedDirectories: ReadonlySet<string>;
  loadingDirectories: ReadonlySet<string>;
  fileTreeError: string | null;
  searchQuery: string;
  searchOptions: TextEditorSearchOptions;
  searchResults: TextEditorSearchResult[];
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenFile: () => void;
  onOpenModFile: (relativePath: string, fileName: string) => void;
  onRefreshTree: () => void;
  onSearchOptionsChange: (options: TextEditorSearchOptions) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectSearchResult: (result: TextEditorSearchResult) => void;
  onToggleDirectory: (row: TextEditorFileTreeRow) => void;
}

const ToggleButton = ({
  active,
  label,
  children,
  onClick
}: {
  active: boolean;
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    aria-label={label}
    aria-pressed={active}
    className="text-editor-search-toggle"
    data-active={active ? 'true' : undefined}
    title={label}
    type="button"
    onClick={onClick}
  >
    {children}
  </button>
);

export function TextEditorSidebar({
  view,
  tabs,
  activeTabId,
  modName,
  fileTreeRows,
  expandedDirectories,
  loadingDirectories,
  fileTreeError,
  searchQuery,
  searchOptions,
  searchResults,
  onActivateTab,
  onCloseTab,
  onOpenFile,
  onOpenModFile,
  onRefreshTree,
  onSearchOptionsChange,
  onSearchQueryChange,
  onSelectSearchResult,
  onToggleDirectory
}: TextEditorSidebarProps) {
  const { t } = useLocalization();
  if (view === 'search') {
    return (
      <aside className="text-editor-sidebar" aria-label={t('editor.aria.searchOpenEditors')}>
        <header className="text-editor-sidebar-header">
          <strong>{t('editor.sidebar.search')}</strong>
          <span>{searchResults.length}</span>
        </header>
        <div className="text-editor-search-box">
          <input
            aria-label={t('editor.aria.searchOpenEditors')}
            autoFocus
            placeholder={t('editor.sidebar.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          />
          <div className="text-editor-search-controls">
            <ToggleButton
              active={Boolean(searchOptions.matchCase)}
              label={t('editor.sidebar.matchCase')}
              onClick={() => onSearchOptionsChange({
                ...searchOptions,
                matchCase: !searchOptions.matchCase
              })}
            >
              <CaseSensitive size={15} />
            </ToggleButton>
            <ToggleButton
              active={Boolean(searchOptions.wholeWord)}
              label={t('editor.sidebar.wholeWord')}
              onClick={() => onSearchOptionsChange({
                ...searchOptions,
                wholeWord: !searchOptions.wholeWord
              })}
            >
              <WholeWord size={15} />
            </ToggleButton>
            <ToggleButton
              active={Boolean(searchOptions.useRegex)}
              label={t('editor.sidebar.regex')}
              onClick={() => onSearchOptionsChange({
                ...searchOptions,
                useRegex: !searchOptions.useRegex
              })}
            >
              <Regex size={15} />
            </ToggleButton>
          </div>
        </div>
        <div className="text-editor-search-results">
          {searchResults.map((result, index) => (
            <button
              className="text-editor-search-result"
              key={`${result.tabId}:${result.line}:${result.column}:${index}`}
              title={`${result.path}:${result.line}:${result.column}`}
              type="button"
              onClick={() => onSelectSearchResult(result)}
            >
              <span>
                <FileCode2 size={14} />
                <strong>{result.fileName}</strong>
                <small>{result.line}:{result.column}</small>
              </span>
              <code>{result.preview}</code>
            </button>
          ))}
          {searchQuery && searchResults.length === 0 ? (
            <div className="text-editor-sidebar-empty">{t('editor.sidebar.noSearchResults')}</div>
          ) : null}
          {!searchQuery ? (
            <div className="text-editor-sidebar-empty">{t('editor.sidebar.typeToSearch')}</div>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="text-editor-sidebar" aria-label={t('editor.action.explorer')}>
      <header className="text-editor-sidebar-header">
        <strong>{t('editor.sidebar.explorer')}</strong>
        <button aria-label={t('editor.action.openFile')} title={t('editor.action.openFile')} type="button" onClick={onOpenFile}>
          <FolderOpen size={15} />
        </button>
      </header>

      <section className="text-editor-sidebar-section" aria-labelledby="open-editors-heading">
        <h2 id="open-editors-heading">
          <ChevronDown size={14} />
          {t('editor.sidebar.openEditors')}
          <span>{tabs.length}</span>
        </h2>
        <div className="text-editor-open-editors">
          {tabs.map((tab) => (
            <div
              className="text-editor-open-editor-row"
              data-active={activeTabId === tab.id ? 'true' : undefined}
              key={tab.id}
            >
              <button
                className="text-editor-open-editor-main"
                title={tab.relativePath ?? tab.path}
                type="button"
                onClick={() => onActivateTab(tab.id)}
              >
                <FileCode2 size={14} />
                <span>{tab.fileName}</span>
                {isTextEditorTabDirty(tab) ? <i aria-label={t('editor.aria.unsaved')} /> : null}
              </button>
              <button
                aria-label={t('editor.aria.closeFile', { name: tab.fileName })}
                className="text-editor-open-editor-close"
                title={t('editor.action.closeEditor')}
                type="button"
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {tabs.length === 0 ? (
            <div className="text-editor-sidebar-empty">{t('editor.sidebar.noOpenEditors')}</div>
          ) : null}
        </div>
      </section>

      {modName ? (
        <section className="text-editor-sidebar-section text-editor-sidebar-section--tree" aria-labelledby="mod-files-heading">
          <h2 id="mod-files-heading">
            <ChevronDown size={14} />
            <span title={modName}>{modName.toUpperCase()}</span>
            <button
              aria-label={t('editor.sidebar.refreshModFiles')}
              title={t('editor.sidebar.refresh')}
              type="button"
              onClick={onRefreshTree}
            >
              <RefreshCw size={13} />
            </button>
          </h2>
          <div className="text-editor-file-tree" role="tree" aria-label={t('editor.aria.modFiles', { name: modName })}>
            {fileTreeRows.map((row) => {
              const editable = !row.entry.isDirectory && isTextEditorFileName(row.entry.name);
              const expanded = expandedDirectories.has(row.entry.relativePath);
              const loading = loadingDirectories.has(row.entry.relativePath);
              return (
                <button
                  aria-disabled={!row.entry.isDirectory && !editable}
                  aria-expanded={row.entry.isDirectory ? expanded : undefined}
                  className="text-editor-file-tree-row"
                  data-editable={editable ? 'true' : undefined}
                  key={row.entry.relativePath}
                  role="treeitem"
                  style={{ '--text-editor-tree-depth': row.depth } as React.CSSProperties}
                  title={row.entry.relativePath}
                  type="button"
                  onClick={() => {
                    if (row.entry.isDirectory) {
                      onToggleDirectory(row);
                    } else if (editable) {
                      onOpenModFile(row.entry.relativePath, row.entry.name);
                    }
                  }}
                >
                  <span className="text-editor-tree-chevron" aria-hidden="true">
                    {row.entry.isDirectory
                      ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
                      : null}
                  </span>
                  {row.entry.isDirectory
                    ? expanded ? <FolderOpen size={14} /> : <Folder size={14} />
                    : editable ? <FileCode2 size={14} /> : <File size={14} />}
                  <span>{row.entry.name}</span>
                  {loading ? <i aria-label={t('editor.aria.loading')} /> : null}
                </button>
              );
            })}
            {fileTreeError ? (
              <div className="text-editor-sidebar-error" role="status">{fileTreeError}</div>
            ) : null}
            {!fileTreeError && fileTreeRows.length === 0 ? (
              <div className="text-editor-sidebar-empty">
                {loadingDirectories.has('')
                  ? t('editor.sidebar.loadingFiles')
                  : t('editor.sidebar.noFiles')}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
