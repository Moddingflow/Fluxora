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
} from '../../design-system/icons/lucide-compat';
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
import type { TranslationKey } from '../../../localization';
import { useLocalization } from '../../../localization/react';
import {
  createRendererOperationId
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

const languageOptionDescriptors: Array<{ id: string; labelKey: TranslationKey }> = [
  { id: 'plaintext', labelKey: 'editor.language.plainText' },
  { id: 'json', labelKey: 'editor.language.json' },
  { id: 'typescript', labelKey: 'editor.language.typescript' },
  { id: 'javascript', labelKey: 'editor.language.javascript' },
  { id: 'html', labelKey: 'editor.language.html' },
  { id: 'css', labelKey: 'editor.language.css' },
  { id: 'scss', labelKey: 'editor.language.scss' },
  { id: 'less', labelKey: 'editor.language.less' },
  { id: 'markdown', labelKey: 'editor.language.markdown' },
  { id: 'xml', labelKey: 'editor.language.xml' },
  { id: 'yaml', labelKey: 'editor.language.yaml' },
  { id: 'ini', labelKey: 'editor.language.combinedIni' },
  { id: 'papyrus', labelKey: 'editor.language.papyrus' },
  { id: 'cpp', labelKey: 'editor.language.combinedCpp' },
  { id: 'csharp', labelKey: 'editor.language.csharp' },
  { id: 'rust', labelKey: 'editor.language.rust' },
  { id: 'python', labelKey: 'editor.language.python' },
  { id: 'java', labelKey: 'editor.language.java' },
  { id: 'kotlin', labelKey: 'editor.language.kotlin' },
  { id: 'go', labelKey: 'editor.language.go' },
  { id: 'lua', labelKey: 'editor.language.lua' },
  { id: 'powershell', labelKey: 'editor.language.powershell' },
  { id: 'shell', labelKey: 'editor.language.shell' },
  { id: 'sql', labelKey: 'editor.language.sql' },
  { id: 'graphql', labelKey: 'editor.language.graphql' }
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
  const { locale, t } = useLocalization();
  const [tabs, setTabs] = useState<TextEditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState(() => t('editor.status.ready'));
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
  const languageOptions = useMemo<TextEditorQuickInputItem[]>(() =>
    languageOptionDescriptors.map(({ id, labelKey }) => ({ id, label: t(labelKey) })),
  [t]);

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
    const language = textEditorLanguageForFile(fileName, locale);
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
    setStatusText(t('editor.status.opening', { name: fileName }));

    try {
      const document = await window.fluxora.mods.readTextFile(
        projectDirectory,
        initialModPath,
        initialRelativePath,
        { operationId: createRendererOperationId('text_editor_mod_read') }
      );
      upsertTab(createTextEditorTab(document, 'mod', initialModPath, locale));
      setStatusText(t('editor.status.ready'));
    } catch {
      const message = t('editor.error.open');
      patchTab(loadingTab.id, { state: 'error', errorMessage: message });
      setStatusText(message);
    }
  }, [
    initialFileName,
    initialModPath,
    initialRelativePath,
    patchTab,
    projectDirectory,
    locale,
    t,
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
    const fileName = initialFileName || t('editor.empty.title');
    const language = textEditorLanguageForFile(fileName, locale);
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
    setStatusText(t('editor.status.opening', { name: fileName }));
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
          ? t('editor.error.boundedRead')
          : undefined
      });
      pendingRevealRef.current = {
        tabId,
        line: initialLine,
        column: 1,
        matchLength: 1
      };
      requestAnimationFrame(() => surfaceRef.current?.reveal(initialLine, 1, 1));
      setStatusText(readOnly ? t('editor.status.readOnlyOpened') : t('editor.status.ready'));
    } catch {
      const message = t('editor.error.open');
      patchTab(tabId, { state: 'error', errorMessage: message });
      setStatusText(message);
    }
  }, [
    initialAiChatId,
    initialAiFileRef,
    initialFileName,
    initialLine,
    locale,
    patchTab,
    t,
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
          setStatusText(t('editor.error.externalChanged'));
          patchTab(currentTab.id, {
            state: 'error',
            errorMessage: t('editor.error.externalChangedUnsaved')
          });
          return;
        }
        patchTab(currentTab.id, {
          content: document.content,
          savedContent: document.content,
          baseSha256: document.sha256,
          readOnly: document.truncated,
          errorMessage: document.truncated
            ? t('editor.error.boundedRead')
            : undefined
        });
        setStatusText(t('editor.status.externalReloaded'));
      } catch {
        // Transient polling failures do not replace the current editor buffer.
      } finally {
        polling = false;
      }
    };
    const interval = window.setInterval(() => void refreshIfExternallyChanged(), 2500);
    return () => window.clearInterval(interval);
  }, [initialAiChatId, initialAiFileRef, patchTab, t]);

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
    } catch {
      setFileTreeError(t('editor.error.fileTree'));
    } finally {
      treeRequestsRef.current.delete(requestKey);
      setLoadingDirectories((current) => {
        const next = new Set(current);
        next.delete(relativeDirectory);
        return next;
      });
    }
  }, [initialModPath, projectDirectory, t]);

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

    const language = textEditorLanguageForFile(fileName, locale);
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
    setStatusText(t('editor.status.opening', { name: fileName }));
    try {
      const document = await window.fluxora.mods.readTextFile(
        projectDirectory,
        initialModPath,
        relativePath,
        { operationId: createRendererOperationId('text_editor_mod_read') }
      );
      upsertTab(createTextEditorTab(document, 'mod', initialModPath, locale));
      setStatusText(t('editor.status.ready'));
    } catch {
      const message = t('editor.error.open');
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

    setStatusText(t('editor.status.opening', { name: fileNameFromPath(result.path) }));
    try {
      const document = await window.fluxora.textFiles.read(
        result.path,
        { operationId: createRendererOperationId('text_editor_file_read') }
      );
      upsertTab(createTextEditorTab(document, 'file', undefined, locale));
      setStatusText(t('editor.status.ready'));
    } catch {
      setStatusText(t('editor.error.open'));
    }
  };

  const saveTab = useCallback(async (tab: TextEditorTab): Promise<boolean> => {
    if (tab.readOnly) {
      setStatusText(tab.errorMessage || t('editor.error.readOnly'));
      return false;
    }
    const contentToSave = tab.content;
    patchTab(tab.id, { state: 'saving', errorMessage: undefined });
    setStatusText(t('editor.status.saving', { name: tab.fileName }));
    try {
      let result: FluxoraTextFileSaveResult;
      if (tab.source === 'ai') {
        if (!tab.aiChatId || !tab.fileRef || !tab.baseSha256) {
          throw new Error(t('editor.error.aiContext'));
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
            ? t('editor.error.boundedRead')
            : undefined
        } : item));
        setStatusText(t('editor.status.saved', { name: tab.fileName }));
        return true;
      }
      if (tab.source === 'mod') {
        if (!projectDirectory || !tab.modPath || !tab.relativePath) {
          throw new Error(t('editor.error.projectContext'));
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
      setStatusText(t('editor.status.saved', { name: result.fileName || tab.fileName }));
      return true;
    } catch {
      const message = t('editor.error.save');
      patchTab(tab.id, { state: 'error', errorMessage: message });
      setStatusText(message);
      return false;
    }
  }, [patchTab, projectDirectory, replaceTabs, t]);

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
      t('editor.dialog.saveTextFile')
    );
    if (saveTarget.canceled || !saveTarget.path) {
      return;
    }

    const targetId = textEditorTabId('file', saveTarget.path);
    const alreadyOpen = tabsRef.current.find((item) => item.id === targetId && item.id !== tab.id);
    if (alreadyOpen) {
      setActiveTabId(alreadyOpen.id);
      setStatusText(t('editor.error.alreadyOpen', { name: alreadyOpen.fileName }));
      return;
    }

    const contentToSave = tab.content;
    patchTab(tab.id, { state: 'saving', errorMessage: undefined });
    setStatusText(t('editor.status.saving', { name: fileNameFromPath(saveTarget.path) }));
    try {
      const result = await window.fluxora.textFiles.save(
        saveTarget.path,
        contentToSave,
        { operationId: createRendererOperationId('text_editor_file_save_as') }
      );
      const latestTab = tabsRef.current.find((item) => item.id === tab.id) ?? tab;
      const fileName = result.fileName || fileNameFromPath(result.path || saveTarget.path);
      const language = textEditorLanguageForFile(fileName, locale);
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
      setStatusText(t('editor.status.saved', { name: fileName }));
    } catch {
      const message = t('editor.error.save');
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
    void closeWindowAfterConfirmation().catch(() => setStatusText(t('editor.error.close')));
  }, [closeWindowAfterConfirmation, t]);

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
      void closeWindowAfterConfirmation().catch(() => setStatusText(t('editor.error.close')));
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
    setStatusText(t('editor.status.languageMode', { name: languageLabel }));
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
      label: t('editor.menu.file'),
      items: [
        { id: 'file.open', label: t('editor.action.openFileEllipsis'), shortcut: 'Ctrl+O' },
        { id: 'file.save', label: t('editor.action.save'), shortcut: 'Ctrl+S', disabled: !activeTab },
        { id: 'file.saveAs', label: t('editor.action.saveAs'), shortcut: 'Ctrl+Shift+S', disabled: !activeTab },
        { id: 'file.saveAll', label: t('editor.action.saveAll'), shortcut: 'Ctrl+Alt+S', disabled: dirtyTabs.length === 0 },
        { id: 'file.close', label: t('editor.action.closeEditor'), shortcut: 'Ctrl+W', disabled: !activeTab, separatorBefore: true },
        { id: 'file.closeAll', label: t('editor.action.closeAllEditors'), disabled: tabs.length === 0 }
      ]
    },
    {
      id: 'edit',
      label: t('editor.menu.edit'),
      items: [
        { id: 'edit.undo', label: t('editor.action.undo'), shortcut: 'Ctrl+Z', disabled: !activeTab },
        { id: 'edit.redo', label: t('editor.action.redo'), shortcut: 'Ctrl+Y', disabled: !activeTab },
        { id: 'edit.find', label: t('editor.action.find'), shortcut: 'Ctrl+F', disabled: !activeTab, separatorBefore: true },
        { id: 'edit.replace', label: t('editor.action.replace'), shortcut: 'Ctrl+H', disabled: !activeTab },
        { id: 'edit.selectAll', label: t('editor.action.selectAll'), shortcut: 'Ctrl+A', disabled: !activeTab },
        { id: 'edit.format', label: t('editor.action.formatDocument'), shortcut: 'Shift+Alt+F', disabled: !activeTab, separatorBefore: true }
      ]
    },
    {
      id: 'selection',
      label: t('editor.menu.selection'),
      items: [
        { id: 'selection.cursorAbove', label: t('editor.action.addCursorAbove'), shortcut: 'Ctrl+Alt+Up', disabled: !activeTab },
        { id: 'selection.cursorBelow', label: t('editor.action.addCursorBelow'), shortcut: 'Ctrl+Alt+Down', disabled: !activeTab },
        { id: 'selection.addNext', label: t('editor.action.addNextOccurrence'), shortcut: 'Ctrl+D', disabled: !activeTab }
      ]
    },
    {
      id: 'view',
      label: t('editor.menu.view'),
      items: [
        { id: 'view.palette', label: t('editor.action.commandPaletteEllipsis'), shortcut: 'Ctrl+Shift+P' },
        { id: 'view.explorer', label: t('editor.action.explorer'), shortcut: 'Ctrl+B', checked: sidebarOpen && sidebarView === 'explorer', separatorBefore: true },
        { id: 'view.search', label: t('editor.action.search'), shortcut: 'Ctrl+Shift+F', checked: sidebarOpen && sidebarView === 'search' },
        { id: 'view.problems', label: t('editor.action.problems'), shortcut: 'Ctrl+J', checked: panelOpen },
        { id: 'view.minimap', label: t('editor.action.minimap'), checked: minimapEnabled, separatorBefore: true },
        { id: 'view.wordWrap', label: t('editor.action.wordWrap'), shortcut: 'Alt+Z', checked: wordWrapEnabled }
      ]
    },
    {
      id: 'go',
      label: t('editor.menu.go'),
      items: [
        { id: 'go.file', label: t('editor.action.goToFileEllipsis'), shortcut: 'Ctrl+P' },
        { id: 'go.line', label: t('editor.action.goToLine'), shortcut: 'Ctrl+G', disabled: !activeTab },
        { id: 'go.nextProblem', label: t('editor.action.nextProblem'), shortcut: 'F8', disabled: !activeTab, separatorBefore: true },
        { id: 'go.previousProblem', label: t('editor.action.previousProblem'), shortcut: 'Shift+F8', disabled: !activeTab },
        { id: 'go.nextEditor', label: t('editor.action.nextEditor'), shortcut: 'Ctrl+Tab', disabled: tabs.length < 2 },
        { id: 'go.previousEditor', label: t('editor.action.previousEditor'), shortcut: 'Ctrl+Shift+Tab', disabled: tabs.length < 2 }
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
    t,
    wordWrapEnabled
  ]);

  const commandPaletteItems = useMemo<TextEditorQuickInputItem[]>(() =>
    menuGroups.flatMap((group) => group.items
      .filter((item) => !item.disabled)
      .map((item) => ({
          id: item.id,
          label: item.label.replace('…', ''),
          detail: group.label,
          shortcut: item.shortcut
        }))),
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
    ? t('editor.action.commandPalette')
    : quickInputMode === 'files'
      ? t('editor.action.goToFile')
      : t('editor.quickInput.selectLanguage');

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
    ? tabs.find((tab) => tab.id === pendingClose.tabId)?.fileName ?? t('editor.close.thisFile')
    : t('editor.close.unsavedFiles', { count: dirtyTabs.length });

  const breadcrumbs = activeTab ? pathSegments(activeTab.relativePath ?? activeTab.path) : [];

  return (
    <section className="text-editor-window" aria-label={t('editor.aria.window')}>
      <header className="text-editor-topbar">
        <TextEditorMenuBar groups={menuGroups} onCommand={executeCommand} />
        <div className="text-editor-toolbar" aria-label={t('editor.aria.actions')}>
          <button aria-label={t('editor.action.openFile')} title={`${t('editor.action.openFile')} (Ctrl+O)`} type="button" onClick={() => void openFile()}>
            <FolderOpen size={15} />
          </button>
          <button aria-label={t('editor.action.save')} disabled={!activeTab} title={`${t('editor.action.save')} (Ctrl+S)`} type="button" onClick={() => void saveActive()}>
            <Save size={15} />
          </button>
          <button aria-label={t('editor.action.commandPalette')} title={`${t('editor.action.commandPalette')} (Ctrl+Shift+P)`} type="button" onClick={() => setQuickInputMode('commands')}>
            <Command size={15} />
          </button>
          <button aria-label={t('editor.action.toggleProblems')} aria-pressed={panelOpen} title={`${t('editor.action.problems')} (Ctrl+J)`} type="button" onClick={() => setPanelOpen((current) => !current)}>
            <PanelBottom size={15} />
          </button>
        </div>
      </header>

      <div className="text-editor-workbench" data-sidebar-open={sidebarOpen ? 'true' : 'false'}>
        <nav className="text-editor-activitybar" aria-label={t('editor.aria.views')}>
          <button
            aria-label={t('editor.action.explorer')}
            aria-pressed={sidebarOpen && sidebarView === 'explorer'}
            data-active={sidebarOpen && sidebarView === 'explorer' ? 'true' : undefined}
            title={`${t('editor.action.explorer')} (Ctrl+B)`}
            type="button"
            onClick={() => executeCommand('view.explorer')}
          >
            <Files size={21} />
          </button>
          <button
            aria-label={t('editor.action.search')}
            aria-pressed={sidebarOpen && sidebarView === 'search'}
            data-active={sidebarOpen && sidebarView === 'search' ? 'true' : undefined}
            title={`${t('editor.action.search')} (Ctrl+Shift+F)`}
            type="button"
            onClick={() => executeCommand('view.search')}
          >
            <Search size={21} />
          </button>
          <button
            aria-label={t('editor.action.problems')}
            aria-pressed={panelOpen}
            data-active={panelOpen ? 'true' : undefined}
            title={`${t('editor.action.problems')} (Ctrl+J)`}
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
          <div className="text-editor-editor-tabs" role="tablist" aria-label={t('editor.aria.openEditors')}>
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
                    aria-label={t('editor.aria.closeFile', { name: tab.fileName })}
                    className="text-editor-tab-close"
                    title={t('editor.action.closeEditor')}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestCloseTab(tab.id);
                    }}
                  >
                    {dirty ? <i aria-label={t('editor.aria.unsaved')} /> : <X size={13} />}
                  </button>
                </div>
              );
            })}
          </div>

          <nav className="text-editor-breadcrumbs" aria-label={t('editor.aria.breadcrumbs')}>
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
                <div className="text-editor-loading" aria-busy="true" aria-label={t('editor.aria.loadingFile', { name: activeTab.fileName })}>
                  <span />
                  <span />
                  <span />
                </div>
              ) : activeTab.state === 'error' ? (
                <div className="text-editor-error" role="status">
                  <CircleAlert size={20} />
                  <strong>{t('editor.fileOpenFailed', { name: activeTab.fileName })}</strong>
                  <span>{activeTab.errorMessage ?? t('editor.error.fileUnavailable')}</span>
                  <button type="button" onClick={() => requestCloseTab(activeTab.id)}>{t('editor.action.closeEditor')}</button>
                </div>
              ) : (
                <Suspense fallback={<div className="text-editor-loading" aria-label={t('editor.aria.loadingEditor')} aria-busy="true"><span /><span /><span /></div>}>
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
                <strong>{t('editor.empty.title')}</strong>
                <span>{t('editor.empty.description')}</span>
                <div>
                  <button type="button" onClick={() => void openFile()}>
                    <FolderOpen size={15} /> {t('editor.action.openFile')}
                  </button>
                  <button type="button" onClick={() => setQuickInputMode('commands')}>
                    <Command size={15} /> {t('editor.action.commandPalette')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {panelOpen ? (
            <section className="text-editor-panel" aria-label={t('editor.aria.problemsPanel')}>
              <header>
                <button className="text-editor-panel-tab" data-active="true" type="button">
                  {t('editor.problems.heading')} <span>{problemLocations.length}</span>
                </button>
                <button aria-label={t('editor.action.closeProblems')} title={t('editor.action.closePanel')} type="button" onClick={() => setPanelOpen(false)}>
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
                  <div className="text-editor-panel-empty">{t('editor.problems.empty')}</div>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      </div>

      <footer className="text-editor-statusbar" aria-label={t('editor.aria.status')}>
        <div>
          <button title={t('editor.action.showProblems')} type="button" onClick={() => setPanelOpen(true)}>
            <CircleAlert size={13} /> {errorCount} <span>△ {warningCount}</span>
          </button>
          <span title={statusText}>{statusText}</span>
        </div>
        <div>
          {activeTab ? (
            <>
              {cursor.selectionCount > 1 ? <span>{t('editor.status.selections', { count: cursor.selectionCount })}</span> : null}
              <button title={`${t('editor.action.goToLine')} (Ctrl+G)`} type="button" onClick={() => runEditorAction('editor.action.gotoLine')}>
                {t('editor.status.position', { line: cursor.line, column: cursor.column })}
              </button>
              <span>{cursor.insertSpaces ? t('editor.status.spaces') : t('editor.status.tabSize')}: {cursor.tabSize}</span>
              <span>UTF-8</span>
              <span>{detectLineEnding(activeTab.content)}</span>
              {wordWrapEnabled ? <span>{t('editor.action.wordWrap')}</span> : null}
              <button title={t('editor.action.selectLanguageMode')} type="button" onClick={() => setQuickInputMode('language')}>
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
          placeholder={quickInputMode === 'commands'
            ? t('editor.quickInput.typeCommand')
            : quickInputMode === 'files'
              ? t('editor.quickInput.typeFile')
              : t('editor.quickInput.selectLanguagePlaceholder')}
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
              <h2 id="text-editor-close-title">{t('editor.close.title')}</h2>
              <p>{t('editor.close.description', { name: closeDialogLabel })}</p>
            </div>
            <footer>
              <button autoFocus disabled={closeActionBusy} type="button" onClick={() => void saveBeforePendingClose()}>
                {pendingClose.kind === 'tab' ? t('editor.action.save') : t('editor.action.saveAll')}
              </button>
              <button disabled={closeActionBusy} type="button" onClick={discardPendingClose}>{t('editor.action.dontSave')}</button>
              <button disabled={closeActionBusy} type="button" onClick={() => setPendingClose(null)}>{t('editor.action.cancel')}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
