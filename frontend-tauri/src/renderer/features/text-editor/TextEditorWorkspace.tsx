import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  FluxoraProject,
  FluxoraTextFileDocument,
  FluxoraTextFileSaveResult
} from '../../../shared/fluxora-api';
import {
  createRendererOperationId,
  errorMessage
} from '../../services/renderer-operation-service';

const textEditorExtensions = new Set([
  '.txt',
  '.json',
  '.jsonc',
  '.json5',
  '.ini',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  '.log',
  '.md',
  '.markdown',
  '.csv',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.vue',
  '.svelte',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.rs',
  '.go',
  '.swift',
  '.kt',
  '.kts',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.gql',
  '.lock',
  '.meta',
  '.strings',
  '.po',
  '.pot',
  '.lua',
  '.pexmap',
  '.psc'
]);

const textEditorFileNames = new Set([
  '.babelrc',
  '.editorconfig',
  '.env',
  '.env.local',
  '.env.production',
  '.eslintrc',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.npmrc',
  '.prettierrc',
  '.stylelintrc',
  '.yarnrc',
  'changelog',
  'license',
  'readme'
]);

export const isTextEditorFileName = (name: string): boolean => {
  const trimmed = name.trim().toLowerCase();
  if (textEditorFileNames.has(trimmed)) {
    return true;
  }

  const dotIndex = trimmed.lastIndexOf('.');
  return dotIndex > 0 && textEditorExtensions.has(trimmed.slice(dotIndex));
};

type TextEditorTabSource = 'mod' | 'file';
type TextEditorBusyState = 'idle' | 'loading' | 'saving' | 'error';

interface TextEditorTab {
  id: string;
  source: TextEditorTabSource;
  path: string;
  fileName: string;
  relativePath?: string;
  modPath?: string;
  content: string;
  savedContent: string;
  state: TextEditorBusyState;
  errorMessage?: string;
}

interface TextEditorWorkspaceProps {
  project: FluxoraProject | null;
  initialModPath: string;
  initialRelativePath: string;
  initialFileName: string;
}

const fileNameFromPath = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name || 'Untitled.txt';
};

const tabIdFor = (source: TextEditorTabSource, path: string): string =>
  `${source}:${path.toLocaleLowerCase()}`;

const tabFromDocument = (
  document: FluxoraTextFileDocument,
  source: TextEditorTabSource,
  modPath?: string
): TextEditorTab => ({
  id: tabIdFor(source, source === 'mod' ? `${modPath ?? ''}:${document.relativePath ?? document.path}` : document.path),
  source,
  path: document.path,
  fileName: document.fileName || fileNameFromPath(document.path),
  relativePath: document.relativePath,
  modPath,
  content: document.content,
  savedContent: document.content,
  state: 'idle'
});

export function TextEditorWorkspace({
  project,
  initialModPath,
  initialRelativePath,
  initialFileName
}: TextEditorWorkspaceProps) {
  const [tabs, setTabs] = useState<TextEditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const loadedInitialRef = useRef<string | null>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs]
  );
  const dirtyTabs = useMemo(
    () => tabs.filter((tab) => tab.content !== tab.savedContent),
    [tabs]
  );

  const upsertTab = (tab: TextEditorTab) => {
    setTabs((current) => {
      const existingIndex = current.findIndex((item) => item.id === tab.id);
      if (existingIndex === -1) {
        return [...current, tab];
      }

      return current.map((item, index) => (index === existingIndex ? tab : item));
    });
    setActiveTabId(tab.id);
  };

  const patchTab = (tabId: string, patch: Partial<TextEditorTab>) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))
    );
  };

  const loadInitialModFile = async () => {
    if (!project || !initialModPath || !initialRelativePath) {
      return;
    }

    const key = `${project.projectDirectory}\0${initialModPath}\0${initialRelativePath}`;
    if (loadedInitialRef.current === key) {
      return;
    }
    loadedInitialRef.current = key;
    setStatusText('Loading file');

    const loadingTab: TextEditorTab = {
      id: tabIdFor('mod', `${initialModPath}:${initialRelativePath}`),
      source: 'mod',
      path: initialRelativePath,
      fileName: initialFileName || fileNameFromPath(initialRelativePath),
      relativePath: initialRelativePath,
      modPath: initialModPath,
      content: '',
      savedContent: '',
      state: 'loading'
    };
    upsertTab(loadingTab);

    try {
      const document = await window.fluxora.mods.readTextFile(
        project.projectDirectory,
        initialModPath,
        initialRelativePath,
        { operationId: createRendererOperationId('text_editor_mod_read') }
      );
      upsertTab(tabFromDocument(document, 'mod', initialModPath));
      setStatusText(null);
    } catch (error) {
      patchTab(loadingTab.id, {
        state: 'error',
        errorMessage: errorMessage(error)
      });
      setStatusText(errorMessage(error));
    }
  };

  useEffect(() => {
    void loadInitialModFile();
  }, [project?.projectDirectory, initialModPath, initialRelativePath]);

  const updateActiveContent = (content: string) => {
    if (!activeTab) {
      return;
    }

    patchTab(activeTab.id, { content, state: 'idle', errorMessage: undefined });
  };

  const saveTab = async (tab: TextEditorTab): Promise<TextEditorTab | null> => {
    patchTab(tab.id, { state: 'saving', errorMessage: undefined });
    setStatusText('Saving');

    try {
      let result: FluxoraTextFileSaveResult;
      if (tab.source === 'mod') {
        if (!project || !tab.modPath || !tab.relativePath) {
          throw new Error('Project or mod file context is unavailable.');
        }

        result = await window.fluxora.mods.saveTextFile(
          project.projectDirectory,
          tab.modPath,
          tab.relativePath,
          tab.content,
          { operationId: createRendererOperationId('text_editor_mod_save') }
        );
      } else {
        result = await window.fluxora.textFiles.save(
          tab.path,
          tab.content,
          { operationId: createRendererOperationId('text_editor_file_save') }
        );
      }

      const savedTab: TextEditorTab = {
        ...tab,
        path: result.path,
        fileName: result.fileName || tab.fileName,
        relativePath: result.relativePath ?? tab.relativePath,
        savedContent: tab.content,
        state: 'idle',
        errorMessage: undefined
      };
      upsertTab(savedTab);
      setStatusText('Saved');
      return savedTab;
    } catch (error) {
      patchTab(tab.id, { state: 'error', errorMessage: errorMessage(error) });
      setStatusText(errorMessage(error));
      return null;
    }
  };

  const saveActive = async () => {
    if (activeTab) {
      await saveTab(activeTab);
    }
  };

  const saveActiveAs = async () => {
    if (!activeTab) {
      return;
    }

    const saveTarget = await window.fluxora.dialogs.saveTextFile(
      activeTab.path || activeTab.fileName,
      'Save text file'
    );
    if (saveTarget.canceled || !saveTarget.path) {
      return;
    }

    const nextTab: TextEditorTab = {
      ...activeTab,
      id: tabIdFor('file', saveTarget.path),
      source: 'file',
      path: saveTarget.path,
      fileName: fileNameFromPath(saveTarget.path),
      relativePath: undefined,
      modPath: undefined
    };
    upsertTab(nextTab);
    await saveTab(nextTab);
  };

  const saveAll = async () => {
    for (const tab of dirtyTabs) {
      await saveTab(tab);
    }
  };

  const openFile = async () => {
    const result = await window.fluxora.dialogs.pickTextFile();
    if (result.canceled || !result.path) {
      return;
    }

    setStatusText('Loading file');
    try {
      const document = await window.fluxora.textFiles.read(
        result.path,
        { operationId: createRendererOperationId('text_editor_file_read') }
      );
      upsertTab(tabFromDocument(document, 'file'));
      setStatusText(null);
    } catch (error) {
      setStatusText(errorMessage(error));
    }
  };

  const runEditCommand = (command: 'undo' | 'redo') => {
    const textarea = textareaRef.current;
    if (!textarea || !activeTab) {
      return;
    }

    textarea.focus();
    document.execCommand(command);
    patchTab(activeTab.id, { content: textarea.value });
  };

  return (
    <section className="text-editor-window" aria-label="Text editor">
      <header className="text-editor-topbar">
        <div className="text-editor-menu" role="menubar" aria-label="Text editor commands">
          <div className="text-editor-menu-group">
            <span>File</span>
            <button type="button" onClick={() => void saveActive()} disabled={!activeTab}>
              Save
            </button>
            <button type="button" onClick={() => void saveActiveAs()} disabled={!activeTab}>
              Save As
            </button>
            <button type="button" onClick={() => void saveAll()} disabled={dirtyTabs.length === 0}>
              Save All
            </button>
            <button type="button" onClick={() => void openFile()}>
              Open File
            </button>
          </div>
          <div className="text-editor-menu-group">
            <span>Edit</span>
            <button type="button" onClick={() => runEditCommand('undo')} disabled={!activeTab}>
              Undo
            </button>
            <button type="button" onClick={() => runEditCommand('redo')} disabled={!activeTab}>
              Redo
            </button>
          </div>
        </div>

        <div className="text-editor-tabs" role="tablist" aria-label="Open text files">
          {tabs.map((tab) => {
            const isDirty = tab.content !== tab.savedContent;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab?.id === tab.id}
                data-active={activeTab?.id === tab.id}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span
                  className="text-editor-save-dot"
                  data-dirty={isDirty}
                  title={isDirty ? 'Unsaved' : 'Saved'}
                  aria-label={isDirty ? 'Unsaved' : 'Saved'}
                />
                <span>{tab.fileName}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="text-editor-body">
        {activeTab ? (
          <>
            <div className="text-editor-filebar">
              <span title={activeTab.relativePath ?? activeTab.path}>
                {activeTab.relativePath ?? activeTab.path}
              </span>
              <strong>{activeTab.state === 'saving' ? 'Saving' : activeTab.state === 'loading' ? 'Loading' : activeTab.content === activeTab.savedContent ? 'Saved' : 'Unsaved'}</strong>
            </div>
            {activeTab.state === 'error' ? (
              <div className="text-editor-message" role="status">
                {activeTab.errorMessage ?? 'File unavailable.'}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              className="text-editor-textarea"
              value={activeTab.content}
              spellCheck={false}
              disabled={activeTab.state === 'loading'}
              onChange={(event) => updateActiveContent(event.currentTarget.value)}
              onInput={(event) => updateActiveContent(event.currentTarget.value)}
            />
          </>
        ) : (
          <div className="text-editor-empty">
            <span>{project ? 'Open a text file.' : 'Loading build.'}</span>
          </div>
        )}
      </div>

      {statusText ? (
        <footer className="text-editor-status" role="status">
          {statusText}
        </footer>
      ) : null}
    </section>
  );
}
