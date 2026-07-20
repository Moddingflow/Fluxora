import {
  CircleAlert,
  Command,
  FileCode2,
  Files,
  FolderOpen,
  PanelBottom,
  Save,
  Search,
  X
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import type {
  FluxoraModFileTreeEntry,
  FluxoraTextFileSaveResult
} from '../../../shared/fluxora-api';
import {
  createRendererOperationId,
  errorMessage
} from '../../services/renderer-operation-service';
import type {
  MonacoEditorSurfaceHandle,
  TextEditorCursorState,
  TextEditorMarker
} from './MonacoEditorSurface';
import { TextEditorMenuBar, type TextEditorMenuGroup } from './TextEditorMenuBar';
import {
  TextEditorQuickInput,
  type TextEditorQuickInputItem
} from './TextEditorQuickInput';
import {
  TextEditorSidebar,
  type TextEditorSidebarView
} from './TextEditorSidebar';
import {
  createTextEditorTab,
  detectLineEnding,
  fileNameFromPath,
  flattenTextEditorFileTree,
  isTextEditorTabDirty,
  searchTextEditorTabs,
  textEditorLanguageForFile,
  textEditorTabId,
  type TextEditorFileTreeRow,
  type TextEditorSearchOptions,
  type TextEditorSearchResult,
  type TextEditorTab
} from './text-editor-model';

export { isTextEditorFileName } from './text-editor-model';

export const TEXT_EDITOR_REQUEST_CLOSE_EVENT = 'fluxora:text-editor-request-close';

let monacoSurfaceModule: Promise<{ default: typeof import('./MonacoEditorSurface').MonacoEditorSurface }> | null = null;

const loadMonacoEditorSurface = () => {
  monacoSurfaceModule ??= import('./MonacoEditorSurface').then((module) => ({
    default: module.MonacoEditorSurface
  }));
  return monacoSurfaceModule;
};

const LazyMonacoEditorSurface = lazy(loadMonacoEditorSurface);

interface TextEditorWorkspaceProps {
  projectDirectory: string;
  initialModPath: string;
  initialRelativePath: string;
  initialFileName: string;
  initialAiChatId?: string;
  initialAiFileRef?: string;
  initialLine?: number;
}

type QuickInputMode = 'commands' | 'files' | 'language' | null;
type PendingClose =
  | { kind: 'tab'; tabId: string }
  | { kind: 'all' }
  | { kind: 'window' };

interface PendingReveal {
  tabId: string;
  line: number;
  column: number;
  matchLength: number;
}

const languageOptions: TextEditorQuickInputItem[] = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'json', label: 'JSON' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'less', label: 'Less' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
  { id: 'ini', label: 'INI / Configuration' },
  { id: 'papyrus', label: 'Papyrus' },
  { id: 'cpp', label: 'C / C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'rust', label: 'Rust' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'go', label: 'Go' },
  { id: 'lua', label: 'Lua' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'shell', label: 'Shell Script' },
  { id: 'sql', label: 'SQL' },
  { id: 'graphql', label: 'GraphQL' }
];

const formatFileSize = (content: string): string => {
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const pathSegments = (path: string): string[] =>
  path.replaceAll('\\', '/').split('/').filter(Boolean);

export function TextEditorWorkspace({
  projectDirectory,
  initialModPath,
  initialRelativePath,
  initialFileName,
  initialAiChatId = '',
  initialAiFileRef = '',
  initialLine = 1
}: TextEditorWorkspaceProps) {
  const [tabs, setTabs] = useState<TextEditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Ready');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarView, setSidebarView] = useState<TextEditorSidebarView>('explorer');
  const [panelOpen, setPanelOpen] = useState(false);
  const [minimapEnabled, setMinimapEnabled] = useState(true);
  const [wordWrapEnabled, setWordWrapEnabled] = useState(false);
  const [quickInputMode, setQuickInputMode] = useState<QuickInputMode>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [closeActionBusy, setCloseActionBusy] = useState(false);
  const [cursor, setCursor] = useState<TextEditorCursorState>({
    line: 1,
    column: 1,
    selectionCount: 1,
    tabSize: 2,
    insertSpaces: true
  });
  const [markersByTab, setMarkersByTab] = useState<Record<string, TextEditorMarker[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState<TextEditorSearchOptions>({});
  const [fileTreeCache, setFileTreeCache] = useState<Record<string, FluxoraModFileTreeEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);

  const surfaceRef = useRef<MonacoEditorSurfaceHandle | null>(null);
  const tabsRef = useRef<TextEditorTab[]>(tabs);
  const loadedInitialRef = useRef<string | null>(null);
  const loadedTreeRootRef = useRef<string | null>(null);
  const treeRequestsRef = useRef(new Set<string>());
  const pendingRevealRef = useRef<PendingReveal | null>(null);
  const allowWindowCloseRef = useRef(false);
  const executeCommandRef = useRef<(commandId: string) => void>(() => undefined);
  tabsRef.current = tabs;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs]
  );
  const dirtyTabs = useMemo(() => tabs.filter(isTextEditorTabDirty), [tabs]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchResults = useMemo(
    () => searchTextEditorTabs(tabs, deferredSearchQuery, searchOptions),
    [deferredSearchQuery, searchOptions, tabs]
  );
  const fileTreeRows = useMemo(
    () => flattenTextEditorFileTree(fileTreeCache, expandedDirectories),
    [expandedDirectories, fileTreeCache]
  );
  const modName = initialModPath ? fileNameFromPath(initialModPath) : null;

  useEffect(() => {
    void loadMonacoEditorSurface();
  }, []);

  const problemLocations = useMemo(
    () => tabs.flatMap((tab) => (markersByTab[tab.id] ?? []).map((marker) => ({
      tab,
      marker
    }))),
    [markersByTab, tabs]
  );
  const errorCount = problemLocations.filter(({ marker }) => marker.severity === 'error').length;
  const warningCount = problemLocations.filter(({ marker }) => marker.severity === 'warning').length;

  const replaceTabs = useCallback((mutator: (current: TextEditorTab[]) => TextEditorTab[]) => {
    setTabs((current) => {
      const next = mutator(current);
      tabsRef.current = next;
      return next;
    });
  }, []);

  const upsertTab = useCallback((tab: TextEditorTab, activate = true) => {
    replaceTabs((current) => {
      const existingIndex = current.findIndex((item) => item.id === tab.id);
      if (existingIndex === -1) {
        return [...current, tab];
      }
      return current.map((item, index) => index === existingIndex ? tab : item);
    });
    if (activate) {
      setActiveTabId(tab.id);
    }
  }, [replaceTabs]);

  const patchTab = useCallback((tabId: string, patch: Partial<TextEditorTab>) => {
    replaceTabs((current) => current.map((tab) =>
      tab.id === tabId ? { ...tab, ...patch } : tab
    ));
  }, [replaceTabs]);

  const loadInitialModFile = useCallback(async () => {
    if (!projectDirectory || !initialModPath || !initialRelativePath) {
      return;
    }

    const key = `${projectDirectory}\0${initialModPath}\0${initialRelativePath}`;
    if (loadedInitialRef.current === key) {
      return;
    }
    loadedInitialRef.current = key;
    const fileName = initialFileName || fileNameFromPath(initialRelativePath);
    const language = textEditorLanguageForFile(fileName);
    const loadingTab: TextEditorTab = {
      id: textEditorTabId('mod', `${initialModPath}:${initialRelativePath}`),
      source: 'mod',
      path: initialRelativePath,
      fileName,
      relativePath: initialRelativePath,
      modPath: initialModPath,
      content: '',
      savedContent: '',
      languageId: language.id,
      languageLabel: language.label,
      state: 'loading'
    };
    upsertTab(loadingTab);
    setStatusText(`Opening ${fileName}`);

    try {
      const document = await window.fluxora.mods.readTextFile(
        projectDirectory,
        initialModPath,
        initialRelativePath,
        { operationId: createRendererOperationId('text_editor_mod_read') }
      );
      upsertTab(createTextEditorTab(document, 'mod', initialModPath));
      setStatusText('Ready');
    } catch (error) {
      const message = errorMessage(error);
      patchTab(loadingTab.id, { state: 'error', errorMessage: message });
      setStatusText(message);
    }
  }, [
    initialFileName,
    initialModPath,
    initialRelativePath,
    patchTab,
    projectDirectory,
    upsertTab
  ]);

  useEffect(() => {
    void loadInitialModFile();
  }, [loadInitialModFile]);

  const loadInitialAiFile = useCallback(async () => {
    if (!initialAiChatId || !initialAiFileRef) {
      return;
    }
    const key = `ai\0${initialAiChatId}\0${initialAiFileRef}`;
    if (loadedInitialRef.current === key) {
      return;
    }
    loadedInitialRef.current = key;
    const fileName = initialFileName || 'Editor';
    const language = textEditorLanguageForFile(fileName);
    const tabId = textEditorTabId('ai', initialAiFileRef);
    upsertTab({
      id: tabId,
      source: 'ai',
      path: fileName,
      fileName,
      aiChatId: initialAiChatId,
      fileRef: initialAiFileRef,
      content: '',
      savedContent: '',
      languageId: language.id,
      languageLabel: language.label,
      state: 'loading'
    });
    setStatusText(`Opening ${fileName}`);
    try {
      const document = await window.fluxora.ai.readFile({
        chatId: initialAiChatId,
        fileRef: initialAiFileRef,
        startLine: 1,
        maxLines: 65_536,
        maxBytes: 64 * 1024,
        editorMode: true,
        operationId: createRendererOperationId('ai_text_editor_read')
      });
      const readOnly = document.truncated;
      upsertTab({
        id: tabId,
        source: 'ai',
        path: document.relativePath || fileName,
        fileName,
        relativePath: document.relativePath,
        aiChatId: initialAiChatId,
        fileRef: initialAiFileRef,
        baseSha256: document.sha256,
        content: document.content,
        savedContent: document.content,
        languageId: language.id,
        languageLabel: language.label,
        state: 'idle',
        readOnly,
        errorMessage: readOnly
          ? 'This file exceeds the bounded editor read window and is open read-only.'
          : undefined
      });
      pendingRevealRef.current = {
        tabId,
        line: initialLine,
        column: 1,
        matchLength: 1
      };
      requestAnimationFrame(() => surfaceRef.current?.reveal(initialLine, 1, 1));
      setStatusText(readOnly ? 'Opened read-only: bounded read was truncated.' : 'Ready');
    } catch (error) {
      const message = errorMessage(error);
      patchTab(tabId, { state: 'error', errorMessage: message });
      setStatusText(message);
    }
  }, [
    initialAiChatId,
    initialAiFileRef,
    initialFileName,
    initialLine,
    patchTab,
    upsertTab
  ]);

  useEffect(() => {
    void loadInitialAiFile();
  }, [loadInitialAiFile]);

  const dirtyAiRefs = useMemo(
    () => tabs
      .filter((tab) => tab.source === 'ai' && tab.fileRef && isTextEditorTabDirty(tab))
      .map((tab) => tab.fileRef as string)
      .sort(),
    [tabs]
  );
  const registeredDirtyAiRefs = useRef<Set<string>>(new Set());

  useEffect(() => {
    const next = new Set(dirtyAiRefs);
    for (const fileRef of registeredDirtyAiRefs.current) {
      if (!next.has(fileRef)) {
        void window.fluxora.ai.setFileDirty(fileRef, false);
      }
    }
    for (const fileRef of next) {
      if (!registeredDirtyAiRefs.current.has(fileRef)) {
        void window.fluxora.ai.setFileDirty(fileRef, true);
      }
    }
    registeredDirtyAiRefs.current = next;
  }, [dirtyAiRefs]);

  useEffect(() => () => {
    for (const fileRef of registeredDirtyAiRefs.current) {
      void window.fluxora.ai.setFileDirty(fileRef, false);
    }
  }, []);

  useEffect(() => {
    if (!initialAiChatId || !initialAiFileRef) {
      return;
    }
    let polling = false;
    const refreshIfExternallyChanged = async () => {
      if (polling) {
        return;
      }
      polling = true;
      try {
        const currentTab = tabsRef.current.find((tab) =>
          tab.source === 'ai' && tab.fileRef === initialAiFileRef
        );
        if (!currentTab || !currentTab.baseSha256 || currentTab.state !== 'idle') {
          return;
        }
        const document = await window.fluxora.ai.readFile({
          chatId: initialAiChatId,
          fileRef: initialAiFileRef,
          startLine: 1,
          maxLines: 65_536,
          maxBytes: 64 * 1024,
          editorMode: true,
          operationId: createRendererOperationId('ai_text_editor_external_change')
        });
        if (document.sha256 === currentTab.baseSha256) {
          return;
        }
        if (isTextEditorTabDirty(currentTab)) {
          setStatusText('File changed outside Fluxora Editor. Save is blocked until you reopen or resolve it.');
          patchTab(currentTab.id, {
            state: 'error',
            errorMessage: 'External change detected while this tab has unsaved edits.'
          });
          return;
        }
        patchTab(currentTab.id, {
          content: document.content,
          savedContent: document.content,
          baseSha256: document.sha256,
          readOnly: document.truncated,
          errorMessage: document.truncated
            ? 'This file exceeds the bounded editor read window and is open read-only.'
            : undefined
        });
        setStatusText('Reloaded an external file change.');
      } catch {
        // Transient polling failures do not replace the current editor buffer.
      } finally {
        polling = false;
      }
    };
    const interval = window.setInterval(() => void refreshIfExternallyChanged(), 2500);
    return () => window.clearInterval(interval);
  }, [initialAiChatId, initialAiFileRef, patchTab]);

  const loadTreeDirectory = useCallback(async (relativeDirectory: string) => {
    if (!projectDirectory || !initialModPath) {
      return;
    }
    const requestKey = `${projectDirectory}\0${initialModPath}\0${relativeDirectory}`;
    if (treeRequestsRef.current.has(requestKey)) {
      return;
    }
    treeRequestsRef.current.add(requestKey);
    setLoadingDirectories((current) => new Set(current).add(relativeDirectory));
    setFileTreeError(null);

    try {
      const entries = await window.fluxora.mods.getFileTree(
        projectDirectory,
        initialModPath,
        relativeDirectory || undefined,
        { operationId: createRendererOperationId('text_editor_file_tree') }
      );
      setFileTreeCache((current) => ({ ...current, [relativeDirectory]: entries }));
    } catch (error) {
      setFileTreeError(errorMessage(error));
    } finally {
      treeRequestsRef.current.delete(requestKey);
      setLoadingDirectories((current) => {
        const next = new Set(current);
        next.delete(relativeDirectory);
        return next;
      });
    }
  }, [initialModPath, projectDirectory]);

  useEffect(() => {
    if (!projectDirectory || !initialModPath) {
      return;
    }
    const key = `${projectDirectory}\0${initialModPath}`;
    if (loadedTreeRootRef.current === key) {
      return;
    }
    loadedTreeRootRef.current = key;
    treeRequestsRef.current.clear();
    setFileTreeCache({});
    setExpandedDirectories(new Set());
    void loadTreeDirectory('');
  }, [initialModPath, loadTreeDirectory, projectDirectory]);

  const refreshFileTree = () => {
    setFileTreeCache({});
    setExpandedDirectories(new Set());
    setFileTreeError(null);
    treeRequestsRef.current.clear();
    void loadTreeDirectory('');
  };

  const toggleTreeDirectory = (row: TextEditorFileTreeRow) => {
    const relativePath = row.entry.relativePath;
    const willExpand = !expandedDirectories.has(relativePath);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
    if (willExpand && !fileTreeCache[relativePath]) {
      void loadTreeDirectory(relativePath);
    }
  };

  const openModFile = async (relativePath: string, fileName: string) => {
    if (!projectDirectory || !initialModPath) {
      return;
    }
    const tabId = textEditorTabId('mod', `${initialModPath}:${relativePath}`);
    if (tabsRef.current.some((tab) => tab.id === tabId)) {
      setActiveTabId(tabId);
      return;
    }

    const language = textEditorLanguageForFile(fileName);
    const loadingTab: TextEditorTab = {
      id: tabId,
      source: 'mod',
      path: relativePath,
      fileName,
      relativePath,
      modPath: initialModPath,
      content: '',
      savedContent: '',
      languageId: language.id,
      languageLabel: language.label,
      state: 'loading'
    };
    upsertTab(loadingTab);
    setStatusText(`Opening ${fileName}`);
    try {
      const document = await window.fluxora.mods.readTextFile(
        projectDirectory,
        initialModPath,
        relativePath,
        { operationId: createRendererOperationId('text_editor_mod_read') }
      );
      upsertTab(createTextEditorTab(document, 'mod', initialModPath));
      setStatusText('Ready');
    } catch (error) {
      const message = errorMessage(error);
      patchTab(tabId, { state: 'error', errorMessage: message });
      setStatusText(message);
    }
  };

  const openFile = async () => {
    const result = await window.fluxora.dialogs.pickTextFile();
    if (result.canceled || !result.path) {
      return;
    }
    const tabId = textEditorTabId('file', result.path);
    if (tabsRef.current.some((tab) => tab.id === tabId)) {
      setActiveTabId(tabId);
      return;
    }

    setStatusText(`Opening ${fileNameFromPath(result.path)}`);
    try {
      const document = await window.fluxora.textFiles.read(
        result.path,
        { operationId: createRendererOperationId('text_editor_file_read') }
      );
      upsertTab(createTextEditorTab(document, 'file'));
      setStatusText('Ready');
    } catch (error) {
      setStatusText(errorMessage(error));
    }
  };

  const saveTab = useCallback(async (tab: TextEditorTab): Promise<boolean> => {
    if (tab.readOnly) {
      setStatusText(tab.errorMessage || 'This tab is read-only.');
      return false;
    }
    const contentToSave = tab.content;
    patchTab(tab.id, { state: 'saving', errorMessage: undefined });
    setStatusText(`Saving ${tab.fileName}`);
    try {
      let result: FluxoraTextFileSaveResult;
      if (tab.source === 'ai') {
        if (!tab.aiChatId || !tab.fileRef || !tab.baseSha256) {
          throw new Error('AI file context is unavailable.');
        }
        const extension = tab.fileName.toLowerCase().split('.').pop() ?? '';
        const format = extension === 'json'
          ? 'json'
          : extension === 'jsonc'
            ? 'jsonc'
            : ['ini', 'cfg', 'conf'].includes(extension)
              ? 'ini'
              : extension === 'txt' || extension === 'md' || extension === 'log'
                ? 'plain-text'
                : 'exact-text';
        await window.fluxora.ai.saveFile({
          chatId: tab.aiChatId,
          runId: createRendererOperationId('ai_text_editor_save_run'),
          fileRef: tab.fileRef,
          baseSha256: tab.baseSha256,
          expectedText: tab.savedContent,
          replacementText: contentToSave,
          format,
          operationId: createRendererOperationId('ai_text_editor_save')
        });
        const refreshed = await window.fluxora.ai.readFile({
          chatId: tab.aiChatId,
          fileRef: tab.fileRef,
          startLine: 1,
          maxLines: 65_536,
          maxBytes: 64 * 1024,
          editorMode: true,
          operationId: createRendererOperationId('ai_text_editor_refresh')
        });
        replaceTabs((current) => current.map((item) => item.id === tab.id ? {
          ...item,
          path: refreshed.relativePath || item.path,
          relativePath: refreshed.relativePath,
          content: refreshed.content,
          savedContent: refreshed.content,
          baseSha256: refreshed.sha256,
          readOnly: refreshed.truncated,
          state: 'idle',
          errorMessage: refreshed.truncated
            ? 'This file exceeds the bounded editor read window and is open read-only.'
            : undefined
        } : item));
        setStatusText(`Saved ${tab.fileName}`);
        return true;
      }
      if (tab.source === 'mod') {
        if (!projectDirectory || !tab.modPath || !tab.relativePath) {
          throw new Error('Project or mod file context is unavailable.');
        }
        result = await window.fluxora.mods.saveTextFile(
          projectDirectory,
          tab.modPath,
          tab.relativePath,
          contentToSave,
          { operationId: createRendererOperationId('text_editor_mod_save') }
        );
      } else {
        result = await window.fluxora.textFiles.save(
          tab.path,
          contentToSave,
          { operationId: createRendererOperationId('text_editor_file_save') }
        );
      }

      replaceTabs((current) => current.map((item) => item.id === tab.id ? {
        ...item,
        path: result.path,
        fileName: result.fileName || item.fileName,
        relativePath: result.relativePath ?? item.relativePath,
        savedContent: contentToSave,
        state: 'idle',
        errorMessage: undefined
      } : item));
      setStatusText(`Saved ${result.fileName || tab.fileName}`);
      return true;
    } catch (error) {
      const message = errorMessage(error);
      patchTab(tab.id, { state: 'error', errorMessage: message });
      setStatusText(message);
      return false;
    }
  }, [patchTab, projectDirectory, replaceTabs]);

  const saveActive = async () => {
    const tab = tabsRef.current.find((item) => item.id === activeTabId);
    if (tab) {
      await saveTab(tab);
    }
  };

  const saveActiveAs = async () => {
    const tab = tabsRef.current.find((item) => item.id === activeTabId);
    if (!tab) {
      return;
    }
    const saveTarget = await window.fluxora.dialogs.saveTextFile(
      tab.path || tab.fileName,
      'Save text file'
    );
    if (saveTarget.canceled || !saveTarget.path) {
      return;
    }

    const targetId = textEditorTabId('file', saveTarget.path);
    const alreadyOpen = tabsRef.current.find((item) => item.id === targetId && item.id !== tab.id);
    if (alreadyOpen) {
      setActiveTabId(alreadyOpen.id);
      setStatusText(`${alreadyOpen.fileName} is already open. Close it before Save As.`);
      return;
    }

    const contentToSave = tab.content;
    patchTab(tab.id, { state: 'saving', errorMessage: undefined });
    setStatusText(`Saving ${fileNameFromPath(saveTarget.path)}`);
    try {
      const result = await window.fluxora.textFiles.save(
        saveTarget.path,
        contentToSave,
        { operationId: createRendererOperationId('text_editor_file_save_as') }
      );
      const latestTab = tabsRef.current.find((item) => item.id === tab.id) ?? tab;
      const fileName = result.fileName || fileNameFromPath(result.path || saveTarget.path);
      const language = textEditorLanguageForFile(fileName);
      const nextTab: TextEditorTab = {
        ...latestTab,
        id: textEditorTabId('file', result.path || saveTarget.path),
        source: 'file',
        path: result.path || saveTarget.path,
        fileName,
        relativePath: undefined,
        modPath: undefined,
        savedContent: contentToSave,
        languageId: language.id,
        languageLabel: language.label,
        state: 'idle',
        errorMessage: undefined
      };
      replaceTabs((current) => current.map((item) => item.id === tab.id ? nextTab : item));
      surfaceRef.current?.disposeModel(tab.id);
      setActiveTabId(nextTab.id);
      setStatusText(`Saved ${fileName}`);
    } catch (error) {
      const message = errorMessage(error);
      patchTab(tab.id, { state: 'error', errorMessage: message });
      setStatusText(message);
    }
  };

  const saveAllTabs = useCallback(async (onlyTabs?: readonly TextEditorTab[]): Promise<boolean> => {
    const targets = onlyTabs ?? tabsRef.current.filter(isTextEditorTabDirty);
    for (const target of targets) {
      const latest = tabsRef.current.find((tab) => tab.id === target.id) ?? target;
      if (!(await saveTab(latest))) {
        return false;
      }
    }
    return true;
  }, [saveTab]);

  const closeTabNow = useCallback((tabId: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === tabId);
    if (index === -1) {
      return;
    }
    const nextTabs = current.filter((tab) => tab.id !== tabId);
    surfaceRef.current?.disposeModel(tabId);
    replaceTabs(() => nextTabs);
    setMarkersByTab((markers) => {
      const next = { ...markers };
      delete next[tabId];
      return next;
    });
    if (activeTabId === tabId) {
      setActiveTabId(nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? null);
    }
  }, [activeTabId, replaceTabs]);

  const closeAllNow = useCallback(() => {
    tabsRef.current.forEach((tab) => surfaceRef.current?.disposeModel(tab.id));
    replaceTabs(() => []);
    setActiveTabId(null);
    setMarkersByTab({});
  }, [replaceTabs]);

  const requestCloseTab = (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    if (isTextEditorTabDirty(tab)) {
      setPendingClose({ kind: 'tab', tabId });
      return;
    }
    closeTabNow(tabId);
  };

  const requestCloseAll = () => {
    if (tabsRef.current.some(isTextEditorTabDirty)) {
      setPendingClose({ kind: 'all' });
      return;
    }
    closeAllNow();
  };

  const closeWindowAfterConfirmation = useCallback(async () => {
    allowWindowCloseRef.current = true;
    try {
      await window.fluxora.windowControls.close();
    } catch (error) {
      allowWindowCloseRef.current = false;
      throw error;
    }
  }, []);

  const requestWindowClose = useCallback(() => {
    if (tabsRef.current.some(isTextEditorTabDirty)) {
      setPendingClose({ kind: 'window' });
      return;
    }
    void closeWindowAfterConfirmation().catch((error) => setStatusText(errorMessage(error)));
  }, [closeWindowAfterConfirmation]);

  useEffect(() => {
    const handleRequest = () => requestWindowClose();
    window.addEventListener(TEXT_EDITOR_REQUEST_CLOSE_EVENT, handleRequest);
    return () => window.removeEventListener(TEXT_EDITOR_REQUEST_CLOSE_EVENT, handleRequest);
  }, [requestWindowClose]);

  useEffect(() => {
    if (dirtyTabs.length === 0) {
      return;
    }
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      if (allowWindowCloseRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalClose);
    return () => window.removeEventListener('beforeunload', preventAccidentalClose);
  }, [dirtyTabs.length]);

  const saveBeforePendingClose = async () => {
    if (!pendingClose) {
      return;
    }
    setCloseActionBusy(true);
    try {
      if (pendingClose.kind === 'tab') {
        const tab = tabsRef.current.find((item) => item.id === pendingClose.tabId);
        if (tab && await saveTab(tab)) {
          closeTabNow(tab.id);
          setPendingClose(null);
        }
        return;
      }

      const unsavedTabs = tabsRef.current.filter(isTextEditorTabDirty);
      if (!(await saveAllTabs(unsavedTabs))) {
        return;
      }
      const closeKind = pendingClose.kind;
      setPendingClose(null);
      if (closeKind === 'all') {
        closeAllNow();
      } else {
        await closeWindowAfterConfirmation();
      }
    } finally {
      setCloseActionBusy(false);
    }
  };

  const discardPendingClose = () => {
    if (!pendingClose) {
      return;
    }
    const closeKind = pendingClose.kind;
    setPendingClose(null);
    if (closeKind === 'tab') {
      closeTabNow(pendingClose.tabId);
    } else if (closeKind === 'all') {
      closeAllNow();
    } else {
      void closeWindowAfterConfirmation().catch((error) => setStatusText(errorMessage(error)));
    }
  };

  const updateActiveContent = useCallback((content: string) => {
    const tabId = activeTabId;
    if (!tabId) {
      return;
    }
    patchTab(tabId, { content, state: 'idle', errorMessage: undefined });
  }, [activeTabId, patchTab]);

  const updateActiveLanguage = (languageId: string, languageLabel: string) => {
    if (!activeTab) {
      return;
    }
    patchTab(activeTab.id, { languageId, languageLabel });
    setStatusText(`Language mode: ${languageLabel}`);
  };

  const revealLocation = (location: PendingReveal) => {
    pendingRevealRef.current = location;
    if (activeTabId === location.tabId) {
      requestAnimationFrame(() => {
        surfaceRef.current?.reveal(location.line, location.column, location.matchLength);
        pendingRevealRef.current = null;
      });
    } else {
      setActiveTabId(location.tabId);
    }
  };

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || pending.tabId !== activeTabId) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      surfaceRef.current?.reveal(pending.line, pending.column, pending.matchLength);
      pendingRevealRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTabId]);

  const selectSearchResult = (result: TextEditorSearchResult) => {
    revealLocation({
      tabId: result.tabId,
      line: result.line,
      column: result.column,
      matchLength: result.matchLength
    });
  };

  const cycleTabs = (direction: 1 | -1) => {
    const current = tabsRef.current;
    if (current.length < 2) {
      return;
    }
    const index = Math.max(0, current.findIndex((tab) => tab.id === activeTabId));
    const nextIndex = (index + direction + current.length) % current.length;
    setActiveTabId(current[nextIndex].id);
  };

  const runEditorAction = (actionId: string) => {
    void surfaceRef.current?.runAction(actionId);
  };

  const executeCommand = (commandId: string) => {
    switch (commandId) {
      case 'file.open': void openFile(); break;
      case 'file.save': void saveActive(); break;
      case 'file.saveAs': void saveActiveAs(); break;
      case 'file.saveAll': void saveAllTabs(); break;
      case 'file.close': if (activeTabId) requestCloseTab(activeTabId); break;
      case 'file.closeAll': requestCloseAll(); break;
      case 'edit.undo': runEditorAction('undo'); break;
      case 'edit.redo': runEditorAction('redo'); break;
      case 'edit.find': runEditorAction('actions.find'); break;
      case 'edit.replace': runEditorAction('editor.action.startFindReplaceAction'); break;
      case 'edit.selectAll': runEditorAction('editor.action.selectAll'); break;
      case 'edit.format': runEditorAction('editor.action.formatDocument'); break;
      case 'selection.cursorAbove': runEditorAction('editor.action.insertCursorAbove'); break;
      case 'selection.cursorBelow': runEditorAction('editor.action.insertCursorBelow'); break;
      case 'selection.addNext': runEditorAction('editor.action.addSelectionToNextFindMatch'); break;
      case 'view.palette': setQuickInputMode('commands'); break;
      case 'view.explorer':
        if (sidebarOpen && sidebarView === 'explorer') {
          setSidebarOpen(false);
        } else {
          setSidebarView('explorer');
          setSidebarOpen(true);
        }
        break;
      case 'view.search':
        if (sidebarOpen && sidebarView === 'search') {
          setSidebarOpen(false);
        } else {
          setSidebarView('search');
          setSidebarOpen(true);
        }
        break;
      case 'view.problems': setPanelOpen((current) => !current); break;
      case 'view.minimap': setMinimapEnabled((current) => !current); break;
      case 'view.wordWrap': setWordWrapEnabled((current) => !current); break;
      case 'go.file': setQuickInputMode('files'); break;
      case 'go.line': runEditorAction('editor.action.gotoLine'); break;
      case 'go.nextProblem': runEditorAction('editor.action.marker.next'); break;
      case 'go.previousProblem': runEditorAction('editor.action.marker.prev'); break;
      case 'go.nextEditor': cycleTabs(1); break;
      case 'go.previousEditor': cycleTabs(-1); break;
    }
  };
  executeCommandRef.current = executeCommand;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        modifier &&
        !event.altKey &&
        !event.shiftKey &&
        key === 's' &&
        target?.closest('.monaco-editor')
      ) {
        return;
      }
      if (modifier && event.shiftKey && key === 'p') {
        event.preventDefault();
        executeCommandRef.current('view.palette');
      } else if (modifier && event.altKey && key === 's') {
        event.preventDefault();
        executeCommandRef.current('file.saveAll');
      } else if (modifier && event.shiftKey && key === 's') {
        event.preventDefault();
        executeCommandRef.current('file.saveAs');
      } else if (modifier && event.shiftKey && key === 'f') {
        event.preventDefault();
        executeCommandRef.current('view.search');
      } else if (modifier && key === 'p') {
        event.preventDefault();
        executeCommandRef.current('go.file');
      } else if (modifier && key === 'o') {
        event.preventDefault();
        executeCommandRef.current('file.open');
      } else if (modifier && key === 's') {
        event.preventDefault();
        executeCommandRef.current('file.save');
      } else if (modifier && key === 'w') {
        event.preventDefault();
        executeCommandRef.current('file.close');
      } else if (modifier && key === 'b') {
        event.preventDefault();
        executeCommandRef.current('view.explorer');
      } else if (modifier && key === 'j') {
        event.preventDefault();
        executeCommandRef.current('view.problems');
      } else if (modifier && key === 'g') {
        event.preventDefault();
        executeCommandRef.current('go.line');
      } else if (modifier && key === 'tab') {
        event.preventDefault();
        executeCommandRef.current(event.shiftKey ? 'go.previousEditor' : 'go.nextEditor');
      } else if (event.altKey && key === 'z') {
        event.preventDefault();
        executeCommandRef.current('view.wordWrap');
      } else if (event.key === 'F8') {
        event.preventDefault();
        executeCommandRef.current(event.shiftKey ? 'go.previousProblem' : 'go.nextProblem');
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const menuGroups = useMemo<TextEditorMenuGroup[]>(() => [
    {
      id: 'file',
      label: 'File',
      items: [
        { id: 'file.open', label: 'Open File…', shortcut: 'Ctrl+O' },
        { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', disabled: !activeTab },
        { id: 'file.saveAs', label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: !activeTab },
        { id: 'file.saveAll', label: 'Save All', shortcut: 'Ctrl+Alt+S', disabled: dirtyTabs.length === 0 },
        { id: 'file.close', label: 'Close Editor', shortcut: 'Ctrl+W', disabled: !activeTab, separatorBefore: true },
        { id: 'file.closeAll', label: 'Close All Editors', disabled: tabs.length === 0 }
      ]
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !activeTab },
        { id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !activeTab },
        { id: 'edit.find', label: 'Find', shortcut: 'Ctrl+F', disabled: !activeTab, separatorBefore: true },
        { id: 'edit.replace', label: 'Replace', shortcut: 'Ctrl+H', disabled: !activeTab },
        { id: 'edit.selectAll', label: 'Select All', shortcut: 'Ctrl+A', disabled: !activeTab },
        { id: 'edit.format', label: 'Format Document', shortcut: 'Shift+Alt+F', disabled: !activeTab, separatorBefore: true }
      ]
    },
    {
      id: 'selection',
      label: 'Selection',
      items: [
        { id: 'selection.cursorAbove', label: 'Add Cursor Above', shortcut: 'Ctrl+Alt+Up', disabled: !activeTab },
        { id: 'selection.cursorBelow', label: 'Add Cursor Below', shortcut: 'Ctrl+Alt+Down', disabled: !activeTab },
        { id: 'selection.addNext', label: 'Add Next Occurrence', shortcut: 'Ctrl+D', disabled: !activeTab }
      ]
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { id: 'view.palette', label: 'Command Palette…', shortcut: 'Ctrl+Shift+P' },
        { id: 'view.explorer', label: 'Explorer', shortcut: 'Ctrl+B', checked: sidebarOpen && sidebarView === 'explorer', separatorBefore: true },
        { id: 'view.search', label: 'Search', shortcut: 'Ctrl+Shift+F', checked: sidebarOpen && sidebarView === 'search' },
        { id: 'view.problems', label: 'Problems', shortcut: 'Ctrl+J', checked: panelOpen },
        { id: 'view.minimap', label: 'Minimap', checked: minimapEnabled, separatorBefore: true },
        { id: 'view.wordWrap', label: 'Word Wrap', shortcut: 'Alt+Z', checked: wordWrapEnabled }
      ]
    },
    {
      id: 'go',
      label: 'Go',
      items: [
        { id: 'go.file', label: 'Go to File…', shortcut: 'Ctrl+P' },
        { id: 'go.line', label: 'Go to Line…', shortcut: 'Ctrl+G', disabled: !activeTab },
        { id: 'go.nextProblem', label: 'Next Problem', shortcut: 'F8', disabled: !activeTab, separatorBefore: true },
        { id: 'go.previousProblem', label: 'Previous Problem', shortcut: 'Shift+F8', disabled: !activeTab },
        { id: 'go.nextEditor', label: 'Next Editor', shortcut: 'Ctrl+Tab', disabled: tabs.length < 2 },
        { id: 'go.previousEditor', label: 'Previous Editor', shortcut: 'Ctrl+Shift+Tab', disabled: tabs.length < 2 }
      ]
    }
  ], [
    activeTab,
    dirtyTabs.length,
    minimapEnabled,
    panelOpen,
    sidebarOpen,
    sidebarView,
    tabs.length,
    wordWrapEnabled
  ]);

  const commandPaletteItems = useMemo<TextEditorQuickInputItem[]>(() =>
    menuGroups.flatMap((group) => group.items)
      .filter((item) => !item.disabled)
      .map((item) => ({
        id: item.id,
        label: item.label.replace('…', ''),
        detail: groupLabelForCommand(item.id),
        shortcut: item.shortcut
      })),
  [menuGroups]);

  const quickInputItems = quickInputMode === 'commands'
    ? commandPaletteItems
    : quickInputMode === 'files'
      ? tabs.map((tab) => ({
          id: tab.id,
          label: tab.fileName,
          detail: tab.relativePath ?? tab.path
        }))
      : quickInputMode === 'language'
        ? languageOptions
        : [];

  const quickInputLabel = quickInputMode === 'commands'
    ? 'Command Palette'
    : quickInputMode === 'files'
      ? 'Go to File'
      : 'Select Language Mode';

  const handleQuickInputAccept = (item: TextEditorQuickInputItem) => {
    const mode = quickInputMode;
    setQuickInputMode(null);
    if (mode === 'commands') {
      executeCommand(item.id);
    } else if (mode === 'files') {
      setActiveTabId(item.id);
    } else if (mode === 'language') {
      updateActiveLanguage(item.id, item.label);
    }
  };

  const closeDialogLabel = pendingClose?.kind === 'tab'
    ? tabs.find((tab) => tab.id === pendingClose.tabId)?.fileName ?? 'this file'
    : `${dirtyTabs.length} unsaved file${dirtyTabs.length === 1 ? '' : 's'}`;

  const breadcrumbs = activeTab ? pathSegments(activeTab.relativePath ?? activeTab.path) : [];

  return (
    <section className="text-editor-window" aria-label="Fluxora code editor">
      <header className="text-editor-topbar">
        <TextEditorMenuBar groups={menuGroups} onCommand={executeCommand} />
        <div className="text-editor-toolbar" aria-label="Editor actions">
          <button aria-label="Open File" title="Open File (Ctrl+O)" type="button" onClick={() => void openFile()}>
            <FolderOpen size={15} />
          </button>
          <button aria-label="Save" disabled={!activeTab} title="Save (Ctrl+S)" type="button" onClick={() => void saveActive()}>
            <Save size={15} />
          </button>
          <button aria-label="Command Palette" title="Command Palette (Ctrl+Shift+P)" type="button" onClick={() => setQuickInputMode('commands')}>
            <Command size={15} />
          </button>
          <button aria-label="Toggle Problems" aria-pressed={panelOpen} title="Problems (Ctrl+J)" type="button" onClick={() => setPanelOpen((current) => !current)}>
            <PanelBottom size={15} />
          </button>
        </div>
      </header>

      <div className="text-editor-workbench" data-sidebar-open={sidebarOpen ? 'true' : 'false'}>
        <nav className="text-editor-activitybar" aria-label="Editor views">
          <button
            aria-label="Explorer"
            aria-pressed={sidebarOpen && sidebarView === 'explorer'}
            data-active={sidebarOpen && sidebarView === 'explorer' ? 'true' : undefined}
            title="Explorer (Ctrl+B)"
            type="button"
            onClick={() => executeCommand('view.explorer')}
          >
            <Files size={21} />
          </button>
          <button
            aria-label="Search"
            aria-pressed={sidebarOpen && sidebarView === 'search'}
            data-active={sidebarOpen && sidebarView === 'search' ? 'true' : undefined}
            title="Search (Ctrl+Shift+F)"
            type="button"
            onClick={() => executeCommand('view.search')}
          >
            <Search size={21} />
          </button>
          <button
            aria-label="Problems"
            aria-pressed={panelOpen}
            data-active={panelOpen ? 'true' : undefined}
            title="Problems (Ctrl+J)"
            type="button"
            onClick={() => executeCommand('view.problems')}
          >
            <CircleAlert size={21} />
            {problemLocations.length > 0 ? <span>{problemLocations.length}</span> : null}
          </button>
        </nav>

        {sidebarOpen ? (
          <TextEditorSidebar
            activeTabId={activeTabId}
            expandedDirectories={expandedDirectories}
            fileTreeError={fileTreeError}
            fileTreeRows={fileTreeRows}
            loadingDirectories={loadingDirectories}
            modName={modName}
            searchOptions={searchOptions}
            searchQuery={searchQuery}
            searchResults={searchResults}
            tabs={tabs}
            view={sidebarView}
            onActivateTab={setActiveTabId}
            onCloseTab={requestCloseTab}
            onOpenFile={() => void openFile()}
            onOpenModFile={(relativePath, fileName) => void openModFile(relativePath, fileName)}
            onRefreshTree={refreshFileTree}
            onSearchOptionsChange={setSearchOptions}
            onSearchQueryChange={setSearchQuery}
            onSelectSearchResult={selectSearchResult}
            onToggleDirectory={toggleTreeDirectory}
          />
        ) : null}

        <main className="text-editor-editor-group">
          <div className="text-editor-editor-tabs" role="tablist" aria-label="Open editors">
            {tabs.map((tab) => {
              const dirty = isTextEditorTabDirty(tab);
              return (
                <div
                  aria-selected={activeTab?.id === tab.id}
                  className="text-editor-tab"
                  data-active={activeTab?.id === tab.id ? 'true' : undefined}
                  key={tab.id}
                  role="tab"
                  tabIndex={activeTab?.id === tab.id ? 0 : -1}
                  title={tab.relativePath ?? tab.path}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      requestCloseTab(tab.id);
                    }
                  }}
                  onClick={() => setActiveTabId(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActiveTabId(tab.id);
                    }
                  }}
                >
                  <FileCode2 size={14} />
                  <span>{tab.fileName}</span>
                  <button
                    aria-label={`Close ${tab.fileName}`}
                    className="text-editor-tab-close"
                    title="Close Editor"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestCloseTab(tab.id);
                    }}
                  >
                    {dirty ? <i aria-label="Unsaved" /> : <X size={13} />}
                  </button>
                </div>
              );
            })}
          </div>

          <nav className="text-editor-breadcrumbs" aria-label="File breadcrumbs">
            {breadcrumbs.map((segment, index) => (
              <span key={`${segment}:${index}`}>
                {index > 0 ? <b aria-hidden="true">›</b> : null}
                {index === breadcrumbs.length - 1 ? <FileCode2 size={13} /> : null}
                {segment}
              </span>
            ))}
          </nav>

          <div className="text-editor-canvas">
            {activeTab ? (
              activeTab.state === 'loading' ? (
                <div className="text-editor-loading" aria-busy="true" aria-label={`Loading ${activeTab.fileName}`}>
                  <span />
                  <span />
                  <span />
                </div>
              ) : activeTab.state === 'error' ? (
                <div className="text-editor-error" role="status">
                  <CircleAlert size={20} />
                  <strong>Could not open {activeTab.fileName}</strong>
                  <span>{activeTab.errorMessage ?? 'File unavailable.'}</span>
                  <button type="button" onClick={() => requestCloseTab(activeTab.id)}>Close Editor</button>
                </div>
              ) : (
                <Suspense fallback={<div className="text-editor-loading" aria-label="Loading code editor" aria-busy="true"><span /><span /><span /></div>}>
                  <LazyMonacoEditorSurface
                    minimapEnabled={minimapEnabled}
                    onChange={updateActiveContent}
                    onCursorChange={setCursor}
                    onMarkersChange={(markers) => setMarkersByTab((current) => ({
                      ...current,
                      [activeTab.id]: markers
                    }))}
                    onSave={() => void saveActive()}
                    ref={surfaceRef}
                    tab={activeTab}
                    wordWrapEnabled={wordWrapEnabled}
                  />
                </Suspense>
              )
            ) : (
              <div className="text-editor-empty">
                <FileCode2 size={34} />
                <strong>Fluxora Editor</strong>
                <span>Open a code or text file to begin.</span>
                <div>
                  <button type="button" onClick={() => void openFile()}>
                    <FolderOpen size={15} /> Open File
                  </button>
                  <button type="button" onClick={() => setQuickInputMode('commands')}>
                    <Command size={15} /> Command Palette
                  </button>
                </div>
              </div>
            )}
          </div>

          {panelOpen ? (
            <section className="text-editor-panel" aria-label="Problems panel">
              <header>
                <button className="text-editor-panel-tab" data-active="true" type="button">
                  PROBLEMS <span>{problemLocations.length}</span>
                </button>
                <button aria-label="Close Problems" title="Close Panel" type="button" onClick={() => setPanelOpen(false)}>
                  <X size={14} />
                </button>
              </header>
              <div className="text-editor-problems" role="list">
                {problemLocations.map(({ tab, marker }, index) => (
                  <button
                    className="text-editor-problem"
                    data-severity={marker.severity}
                    key={`${tab.id}:${marker.line}:${marker.column}:${index}`}
                    role="listitem"
                    type="button"
                    onClick={() => revealLocation({
                      tabId: tab.id,
                      line: marker.line,
                      column: marker.column,
                      matchLength: Math.max(1, marker.endColumn - marker.column)
                    })}
                  >
                    <CircleAlert size={14} />
                    <span>{marker.message}</span>
                    <small>{tab.fileName} [{marker.line}, {marker.column}]</small>
                  </button>
                ))}
                {problemLocations.length === 0 ? (
                  <div className="text-editor-panel-empty">No problems detected in open editors.</div>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      </div>

      <footer className="text-editor-statusbar" aria-label="Editor status">
        <div>
          <button title="Show Problems" type="button" onClick={() => setPanelOpen(true)}>
            <CircleAlert size={13} /> {errorCount} <span>△ {warningCount}</span>
          </button>
          <span title={statusText}>{statusText}</span>
        </div>
        <div>
          {activeTab ? (
            <>
              {cursor.selectionCount > 1 ? <span>{cursor.selectionCount} selections</span> : null}
              <button title="Go to Line (Ctrl+G)" type="button" onClick={() => runEditorAction('editor.action.gotoLine')}>
                Ln {cursor.line}, Col {cursor.column}
              </button>
              <span>{cursor.insertSpaces ? 'Spaces' : 'Tab Size'}: {cursor.tabSize}</span>
              <span>UTF-8</span>
              <span>{detectLineEnding(activeTab.content)}</span>
              {wordWrapEnabled ? <span>Word Wrap</span> : null}
              <button title="Select Language Mode" type="button" onClick={() => setQuickInputMode('language')}>
                {activeTab.languageLabel}
              </button>
              <span>{formatFileSize(activeTab.content)}</span>
            </>
          ) : null}
        </div>
      </footer>

      {quickInputMode ? (
        <TextEditorQuickInput
          items={quickInputItems}
          label={quickInputLabel}
          placeholder={quickInputMode === 'commands' ? 'Type a command' : quickInputMode === 'files' ? 'Type a file name' : 'Select language mode'}
          prefix={quickInputMode === 'commands' ? '>' : undefined}
          onAccept={handleQuickInputAccept}
          onDismiss={() => setQuickInputMode(null)}
        />
      ) : null}

      {pendingClose ? (
        <div className="text-editor-dialog-layer" onKeyDown={(event) => {
          if (event.key === 'Escape' && !closeActionBusy) {
            setPendingClose(null);
          }
        }}>
          <section className="text-editor-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="text-editor-close-title">
            <CircleAlert size={20} />
            <div>
              <h2 id="text-editor-close-title">Save changes?</h2>
              <p>Save changes to {closeDialogLabel} before closing.</p>
            </div>
            <footer>
              <button autoFocus disabled={closeActionBusy} type="button" onClick={() => void saveBeforePendingClose()}>
                {pendingClose.kind === 'tab' ? 'Save' : 'Save All'}
              </button>
              <button disabled={closeActionBusy} type="button" onClick={discardPendingClose}>Don&apos;t Save</button>
              <button disabled={closeActionBusy} type="button" onClick={() => setPendingClose(null)}>Cancel</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

const groupLabelForCommand = (commandId: string): string => {
  if (commandId.startsWith('file.')) return 'File';
  if (commandId.startsWith('edit.')) return 'Edit';
  if (commandId.startsWith('selection.')) return 'Selection';
  if (commandId.startsWith('view.')) return 'View';
  return 'Go';
};
