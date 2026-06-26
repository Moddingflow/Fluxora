import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  File,
  FolderOpen,
  FolderTree,
  Home,
  Layers,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';

import { AppTitlebar } from './components/chrome/AppTitlebar';
import { EmptyState, LoadingSplash, StatusDot } from './design-system';
import { PrimitivePreview } from './design-system/PrimitivePreview';
import {
  LibraryHome,
  type LibraryCatalogState
} from './features/library/LibraryHome';
import {
  buildProjectLibraryStats,
  type ProjectRuntimeSummary
} from './features/library/projectLibraryStats';
import { BuildPathsInspector } from './features/build/BuildPathsInspector';
import { BuildDetailHeader } from './features/build/BuildDetailHeader';
import {
  InstallDialog,
  type InstallDialogState
} from './features/install/InstallDialog';
import {
  OperationOverlay,
  type OperationOverlayState
} from './features/operations/OperationOverlay';
import { SettingsWorkspace } from './features/settings/SettingsWorkspace';
import {
  emptyProjectDraft,
  filterProjects,
  filterTemplates,
  isProjectDraftStepComplete,
  projectCapabilitiesLabel,
  type ProjectDraft
} from './project-catalog-state';
import {
  bridgeStatusLabel,
  cleanupCreatedProject,
  createProjectFromDraft,
  deleteProjectConfig,
  loadProjectCatalog,
  openProjectConfig,
  previewProjectDirectory,
  projectCatalogFallback,
  renameProjectConfig,
  upsertProject
} from './services/project-catalog-service';
import {
  emptyModWorkspaceState,
  filterModOrderItems,
  formatFileSize,
  hasConflict,
  isModNestedUnderSeparator,
  modItemTitle,
  modLatestVersionText,
  modOverwriteView,
  modSeparatorChildCount,
  modStatusText,
  modTableStatusView,
  modVersionText,
  modWorkspaceReducer,
  selectedModOrderItem,
  targetIndexForDrop,
  targetIndexForMove
} from './mod-workspace-state';
import {
  emptyPluginWorkspaceState,
  filterPluginOrderItems,
  pluginCapabilityView,
  pluginHexIndex,
  pluginItemTitle,
  pluginStatusText,
  pluginTypeLabel,
  pluginWorkspaceReducer,
  selectedPluginOrderItem,
  targetIndexForPluginMove
} from './plugin-workspace-state';
import {
  downloadCapabilityView,
  downloadProgressValue,
  downloadStatusText,
  downloadTitle,
  downloadWorkspaceReducer,
  emptyDownloadWorkspaceState,
  filterDownloadEntries,
  selectedDownloadEntry
} from './download-workspace-state';
import {
  emptyExecutablesWorkspaceState,
  emptyProfilesWorkspaceState,
  executableTitle,
  executablesCapabilityView,
  executablesWorkspaceReducer,
  filterExecutables,
  filterProfileNames,
  isDefaultProfileName,
  profilesCapabilityView,
  profilesWorkspaceReducer,
  projectDefaultProfileName,
  selectedExecutable,
  selectedProfileName
} from './profiles-executables-workspace-state';
import {
  normalizeThemeMode,
  selectPreferredTransferDrive,
  settingsCapabilityView,
  type SettingsSectionId
} from './settings-workspace-state';
import {
  type TransferStepId
} from './TransferSettingsPanel';
import {
  TransferMo2Page,
  type TransferDriveListState
} from './TransferMo2Page';
import {
  buildPathSaveRequest,
  buildHeaderCapabilityView,
  buildPrimaryExecutableList,
  directoryFromExecutablePath,
  draftFromBuildPathSettings,
  emptyBuildPathDraft,
  fluxPackSummaryFacts,
  validateBuildPathDraft,
  type BuildPathDraft
} from './build-workspace-state';
import {
  createPlacementOverrides,
  currentFomodStepValidation,
  defaultInstallModName,
  evaluateFomodWizard,
  fileNameFromPath,
  findExistingInstalledModName,
  initialFomodSelection,
  normalizeInstallModName,
  validateInstallModName,
  type InstallSource
} from './install-workspace-state';
import { defaultModNameFromPath, shortPath } from './services/path-display-service';
import { createRendererOperationId, errorMessage } from './services/renderer-operation-service';
import { createMo2TransferImportRequest } from './mo2-transfer-request';
import { createVirtualWindow } from './ui-performance';
import type {
  FluxoraAppInfo,
  FluxoraContentLayoutPreview,
  FluxoraDownloadEntry,
  FluxoraExecutable,
  FluxoraExecutableLaunchResult,
  FluxoraExistingModInstallMode,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackSummary,
  FluxoraGameTemplate,
  FluxoraInstalledMod,
  FluxoraInstalledModSummary,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraMo2TransferHandoff,
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem,
  FluxoraNexusModsAuthStatus,
  FluxoraPluginOrderItem,
  FluxoraProject,
  FluxoraSecurityState,
  FluxoraThemeMode,
  FluxoraTransferDriveOption,
  NativeBridgeStatus
} from '../shared/fluxora-api';

type RouteId =
  | 'home'
  | 'build'
  | 'workspace'
  | 'mods'
  | 'plugins'
  | 'downloads'
  | 'profiles'
  | 'executables'
  | 'settings';

type CatalogState = LibraryCatalogState;

interface ProjectMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface StartMo2TransferOptions {
  analysis?: FluxoraModOrganizerImportAnalysis | null;
  skipMainHandoff?: boolean;
}

interface LaunchSplashState {
  appName: string;
  buildName: string;
  detail: string;
  operationId: string;
}

type RightPaneId = 'plugins' | 'data' | 'downloads' | 'build';

const navItems: Array<{ id: RouteId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'build', label: 'Build', icon: Layers }
];

const wizardSteps = [
  { id: 'name', label: 'Build name' },
  { id: 'game', label: 'Game template' },
  { id: 'executable', label: 'Game executable' },
  { id: 'location', label: 'Install location' }
] as const;

const rightPaneTabs: Array<{ id: RightPaneId; label: string; icon: typeof Layers }> = [
  { id: 'plugins', label: 'Плагины', icon: Layers },
  { id: 'data', label: 'Данные', icon: FolderTree },
  { id: 'downloads', label: 'Загрузки', icon: Download },
  { id: 'build', label: 'Сборка', icon: Box }
];

const modRowHeight = 48;
const modVisibleRows = 28;
const modOverscanRows = 8;
const pluginRowHeight = 48;
const pluginVisibleRows = 28;
const pluginOverscanRows = 8;
const downloadRowHeight = 48;
const downloadVisibleRows = 28;
const downloadOverscanRows = 8;
const projectMenuWidth = 174;
const projectMenuEstimatedHeight = 116;
const projectMenuViewportPadding = 8;

const projectMenuPositionFromAnchor = (anchor: DOMRect): ProjectMenuPosition => {
  const left = Math.max(
    projectMenuViewportPadding,
    Math.min(anchor.right - projectMenuWidth, window.innerWidth - projectMenuWidth - projectMenuViewportPadding)
  );
  const preferredTop = anchor.bottom + projectMenuViewportPadding;
  const fitsBelow =
    preferredTop + projectMenuEstimatedHeight <= window.innerHeight - projectMenuViewportPadding;
  const top = fitsBelow
    ? preferredTop
    : Math.max(projectMenuViewportPadding, anchor.top - projectMenuEstimatedHeight - projectMenuViewportPadding);

  return {
    left,
    top,
    maxHeight: Math.max(
      96,
      Math.min(projectMenuEstimatedHeight, window.innerHeight - top - projectMenuViewportPadding)
    )
  };
};

export const App = () => {
  const isSettingsWindow = useMemo(
    () => new URLSearchParams(window.location.search).get('window') === 'settings',
    []
  );
  const [activeRoute, setActiveRoute] = useState<RouteId>(() =>
    isSettingsWindow ? 'settings' : 'home'
  );
  const [appInfo, setAppInfo] = useState<FluxoraAppInfo | null>(null);
  const [securityState, setSecurityState] = useState<FluxoraSecurityState | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<NativeBridgeStatus | null>(null);
  const [catalog, setCatalog] = useState(projectCatalogFallback);
  const [projects, setProjects] = useState<FluxoraProject[]>([]);
  const [templates, setTemplates] = useState<FluxoraGameTemplate[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [projectMenuPosition, setProjectMenuPosition] = useState<ProjectMenuPosition | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>('idle');
  const [searchText, setSearchText] = useState('');
  const [templateSearchText, setTemplateSearchText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [languageBusy, setLanguageBusy] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<FluxoraThemeMode>('dark');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('connections');
  const [settingsBusyLabel, setSettingsBusyLabel] = useState<string | null>(null);
  const [nexusStatus, setNexusStatus] = useState<FluxoraNexusModsAuthStatus | null>(null);
  const [nexusBusy, setNexusBusy] = useState(false);
  const [transferSourceDirectory, setTransferSourceDirectory] = useState('');
  const [transferDestinationRootDirectory, setTransferDestinationRootDirectory] = useState('');
  const [transferStep, setTransferStep] = useState<TransferStepId>('name');
  const [transferDestinationDrives, setTransferDestinationDrives] = useState<FluxoraTransferDriveOption[]>([]);
  const [transferDriveState, setTransferDriveState] = useState<TransferDriveListState>('idle');
  const [transferAnalysis, setTransferAnalysis] =
    useState<FluxoraModOrganizerImportAnalysis | null>(null);
  const [transferProgress, setTransferProgress] =
    useState<FluxoraModOrganizerImportProgress | null>(null);
  const [transferRunningOperationId, setTransferRunningOperationId] = useState<string | null>(null);
  const transferRunningOperationIdRef = useRef<string | null>(null);
  const [transferCancelRequested, setTransferCancelRequested] = useState(false);
  const [transferResult, setTransferResult] = useState<FluxoraProject | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [draft, setDraft] = useState<ProjectDraft>(emptyProjectDraft());
  const [previewDirectory, setPreviewDirectory] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [modsWorkspace, dispatchModsWorkspace] = useReducer(
    modWorkspaceReducer,
    undefined,
    emptyModWorkspaceState
  );
  const [installedMods, setInstalledMods] = useState<FluxoraInstalledMod[]>([]);
  const [modsBusyLabel, setModsBusyLabel] = useState<string | null>(null);
  const [modMenuOrderId, setModMenuOrderId] = useState<string | null>(null);
  const [modListScrollTop, setModListScrollTop] = useState(0);
  const [draggedModOrderId, setDraggedModOrderId] = useState<string | null>(null);
  const [modDropTargetOrderId, setModDropTargetOrderId] = useState<string | null>(null);
  const [fileTreeCache, setFileTreeCache] = useState<Record<string, FluxoraModFileTreeEntry[]>>({});
  const [expandedFileTree, setExpandedFileTree] = useState<Record<string, boolean>>({});
  const [fileTreeState, setFileTreeState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [fileTreeLoadingPath, setFileTreeLoadingPath] = useState<string | null>(null);
  const [pluginsWorkspace, dispatchPluginsWorkspace] = useReducer(
    pluginWorkspaceReducer,
    undefined,
    emptyPluginWorkspaceState
  );
  const [pluginsBusyLabel, setPluginsBusyLabel] = useState<string | null>(null);
  const [pluginMenuOrderId, setPluginMenuOrderId] = useState<string | null>(null);
  const [pluginListScrollTop, setPluginListScrollTop] = useState(0);
  const [downloadsWorkspace, dispatchDownloadsWorkspace] = useReducer(
    downloadWorkspaceReducer,
    undefined,
    emptyDownloadWorkspaceState
  );
  const [downloadsBusyLabel, setDownloadsBusyLabel] = useState<string | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [downloadListScrollTop, setDownloadListScrollTop] = useState(0);
  const [activeRightPane, setActiveRightPane] = useState<RightPaneId>('plugins');
  const [archiveTreeScrollTop, setArchiveTreeScrollTop] = useState(0);
  const [profilesWorkspace, dispatchProfilesWorkspace] = useReducer(
    profilesWorkspaceReducer,
    undefined,
    emptyProfilesWorkspaceState
  );
  const [profilesBusyLabel, setProfilesBusyLabel] = useState<string | null>(null);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDeleteArmedName, setProfileDeleteArmedName] = useState<string | null>(null);
  const [executablesWorkspace, dispatchExecutablesWorkspace] = useReducer(
    executablesWorkspaceReducer,
    undefined,
    emptyExecutablesWorkspaceState
  );
  const [executablesBusyLabel, setExecutablesBusyLabel] = useState<string | null>(null);
  const [executableDraft, setExecutableDraft] = useState<FluxoraExecutable | null>(null);
  const [executableLaunchResult, setExecutableLaunchResult] =
    useState<FluxoraExecutableLaunchResult | null>(null);
  const [launchSplash, setLaunchSplash] = useState<LaunchSplashState | null>(null);
  const [executableDeleteArmedId, setExecutableDeleteArmedId] = useState<string | null>(null);
  const [installDialog, setInstallDialog] = useState<InstallDialogState | null>(null);
  const [isBuildPathsOpen, setIsBuildPathsOpen] = useState(false);
  const [buildPathDraft, setBuildPathDraft] = useState<BuildPathDraft>(
    emptyBuildPathDraft(null)
  );
  const [buildPathExecutables, setBuildPathExecutables] = useState<FluxoraExecutable[]>([]);
  const [buildPathsBusyLabel, setBuildPathsBusyLabel] = useState<string | null>(null);
  const [buildPathsError, setBuildPathsError] = useState<string | null>(null);
  const [fluxPackSummary, setFluxPackSummary] = useState<FluxoraFluxPackSummary | null>(null);
  const [fluxPackInstallResult, setFluxPackInstallResult] =
    useState<FluxoraFluxPackInstallResult | null>(null);
  const [operationOverlay, setOperationOverlay] = useState<OperationOverlayState | null>(null);
  const createCancelRequestsRef = useRef<Set<string>>(new Set());
  const [isTransferPageOpen, setIsTransferPageOpen] = useState(false);

  const selectedProject = useMemo(
    () =>
      projects.find(
        (project) =>
          project.id === selectedProjectId ||
          project.configPath === selectedProjectId ||
          project.projectDirectory === selectedProjectId
      ) ?? null,
    [projects, selectedProjectId]
  );

  const deferredSearchText = useDeferredValue(searchText);
  const deferredTemplateSearchText = useDeferredValue(templateSearchText);
  const deferredModSearchText = useDeferredValue(modsWorkspace.searchText);
  const deferredPluginSearchText = useDeferredValue(pluginsWorkspace.searchText);
  const deferredDownloadSearchText = useDeferredValue(downloadsWorkspace.searchText);
  const deferredProfileSearchText = useDeferredValue(profilesWorkspace.searchText);
  const deferredExecutableSearchText = useDeferredValue(executablesWorkspace.searchText);

  const filteredProjects = useMemo(
    () => filterProjects(projects, deferredSearchText),
    [projects, deferredSearchText]
  );

  const filteredTemplates = useMemo(
    () => filterTemplates(templates, deferredTemplateSearchText),
    [templates, deferredTemplateSearchText]
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.templateId) ?? null,
    [templates, draft.templateId]
  );

  const filteredModItems = useMemo(
    () => filterModOrderItems(modsWorkspace.items, deferredModSearchText),
    [modsWorkspace.items, deferredModSearchText]
  );

  const selectedModItem = useMemo(
    () => selectedModOrderItem(modsWorkspace.items, modsWorkspace.selectedOrderId),
    [modsWorkspace.items, modsWorkspace.selectedOrderId]
  );

  const totalModCount = useMemo(
    () => modsWorkspace.items.filter((item) => item.isMod).length,
    [modsWorkspace.items]
  );

  const enabledModCount = useMemo(
    () => modsWorkspace.items.filter((item) => item.isMod && item.isEnabled).length,
    [modsWorkspace.items]
  );

  const filteredPluginItems = useMemo(
    () => filterPluginOrderItems(pluginsWorkspace.items, deferredPluginSearchText),
    [pluginsWorkspace.items, deferredPluginSearchText]
  );

  const selectedPluginItem = useMemo(
    () => selectedPluginOrderItem(pluginsWorkspace.items, pluginsWorkspace.selectedOrderId),
    [pluginsWorkspace.items, pluginsWorkspace.selectedOrderId]
  );

  const filteredDownloadItems = useMemo(
    () => filterDownloadEntries(downloadsWorkspace.items, deferredDownloadSearchText),
    [downloadsWorkspace.items, deferredDownloadSearchText]
  );

  const selectedDownloadItem = useMemo(
    () => selectedDownloadEntry(downloadsWorkspace.items, downloadsWorkspace.selectedId),
    [downloadsWorkspace.items, downloadsWorkspace.selectedId]
  );

  const selectedProjectDefaultProfileName = useMemo(
    () => projectDefaultProfileName(selectedProject),
    [selectedProject]
  );

  const selectedProjectProfileName = useMemo(
    () =>
      selectedProfileName(
        profilesWorkspace.items,
        profilesWorkspace.selectedName,
        selectedProjectDefaultProfileName
      ),
    [
      profilesWorkspace.items,
      profilesWorkspace.selectedName,
      selectedProjectDefaultProfileName
    ]
  );

  const filteredProfileItems = useMemo(
    () => filterProfileNames(profilesWorkspace.items, deferredProfileSearchText),
    [profilesWorkspace.items, deferredProfileSearchText]
  );

  const filteredExecutableItems = useMemo(
    () => filterExecutables(executablesWorkspace.items, deferredExecutableSearchText),
    [executablesWorkspace.items, deferredExecutableSearchText]
  );

  const selectedExecutableItem = useMemo(
    () => selectedExecutable(executablesWorkspace.items, executablesWorkspace.selectedId),
    [executablesWorkspace.items, executablesWorkspace.selectedId]
  );

  const enabledPluginCount = useMemo(
    () =>
      pluginsWorkspace.items.filter((item) => item.isPlugin && item.isEnabled).length,
    [pluginsWorkspace.items]
  );

  const pluginCount = useMemo(
    () => pluginsWorkspace.items.filter((item) => item.isPlugin).length,
    [pluginsWorkspace.items]
  );

  const selectedProjectRuntimeSummary = useMemo<ProjectRuntimeSummary>(() => {
    const modEntries =
      installedMods.length > 0
        ? installedMods
        : modsWorkspace.items.filter((item) => item.isMod);
    const hasModData = installedMods.length > 0 || modsWorkspace.loadState === 'ready';
    const pluginEntries = pluginsWorkspace.items.filter((item) => item.isPlugin);
    const hasPluginData = pluginsWorkspace.loadState === 'ready';

    return {
      modCount: hasModData ? modEntries.length : undefined,
      disabledModCount: hasModData
        ? modEntries.filter((item) => !item.isEnabled).length
        : undefined,
      enabledPluginCount: hasPluginData
        ? pluginEntries.filter((item) => item.isEnabled).length
        : undefined,
      pluginCount: hasPluginData ? pluginEntries.length : undefined,
      downloadsCount:
        downloadsWorkspace.loadState === 'ready' ? downloadsWorkspace.items.length : undefined
    };
  }, [
    downloadsWorkspace.items,
    downloadsWorkspace.loadState,
    installedMods,
    modsWorkspace.items,
    modsWorkspace.loadState,
    pluginsWorkspace.items,
    pluginsWorkspace.loadState
  ]);

  const selectedProjectLibraryStats = useMemo(
    () =>
      selectedProject
        ? buildProjectLibraryStats(selectedProject, selectedProjectRuntimeSummary)
        : null,
    [selectedProject, selectedProjectRuntimeSummary]
  );

  const buildProfileOptions = useMemo(() => {
    if (profilesWorkspace.items.length > 0) {
      return profilesWorkspace.items;
    }

    return selectedProjectProfileName ? [selectedProjectProfileName] : [];
  }, [profilesWorkspace.items, selectedProjectProfileName]);

  const installPlacementOverrides = useMemo(
    () =>
      installDialog?.layoutPreview
        ? createPlacementOverrides(installDialog.layoutPreview, installDialog.placementOverrides)
        : [],
    [installDialog?.layoutPreview, installDialog?.placementOverrides]
  );

  const installFomodEvaluation = useMemo(
    () =>
      installDialog?.fomodInstaller
        ? evaluateFomodWizard(installDialog.fomodInstaller, installDialog.selectedFomodOptionIds)
        : null,
    [installDialog?.fomodInstaller, installDialog?.selectedFomodOptionIds]
  );

  const installedModNames = useMemo(
    () => installedMods.map((mod) => mod.name).filter(Boolean),
    [installedMods]
  );

  const installExistingModName = useMemo(
    () =>
      installDialog ? findExistingInstalledModName(installedModNames, installDialog.modName) : null,
    [installDialog?.modName, installedModNames]
  );

  const pluginCapabilities = useMemo(
    () => pluginCapabilityView(selectedProject, bridgeStatus),
    [bridgeStatus, selectedProject]
  );

  const downloadCapabilities = useMemo(
    () => downloadCapabilityView(selectedProject, bridgeStatus),
    [bridgeStatus, selectedProject]
  );

  const profilesCapabilities = useMemo(
    () => profilesCapabilityView(selectedProject, bridgeStatus),
    [bridgeStatus, selectedProject]
  );

  const executableCapabilities = useMemo(
    () => executablesCapabilityView(selectedProject, bridgeStatus),
    [bridgeStatus, selectedProject]
  );

  const buildHeaderCapabilities = useMemo(
    () => buildHeaderCapabilityView(bridgeStatus),
    [bridgeStatus]
  );

  const settingsCapabilities = useMemo(
    () => settingsCapabilityView(bridgeStatus),
    [bridgeStatus]
  );

  const isTransferRunning = transferRunningOperationId !== null;
  const operationCancellationSupported =
    bridgeStatus?.capabilities?.features.operationCancellation?.state === 'available';
  const transferCancellationSupported = settingsCapabilities.transferCancellationAvailable;

  const visibleModWindow = useMemo(() => {
    return createVirtualWindow(filteredModItems, modListScrollTop, {
      rowHeight: modRowHeight,
      visibleRows: modVisibleRows,
      overscanRows: modOverscanRows
    });
  }, [filteredModItems, modListScrollTop]);

  const visiblePluginWindow = useMemo(() => {
    return createVirtualWindow(filteredPluginItems, pluginListScrollTop, {
      rowHeight: pluginRowHeight,
      visibleRows: pluginVisibleRows,
      overscanRows: pluginOverscanRows
    });
  }, [filteredPluginItems, pluginListScrollTop]);

  const visibleDownloadWindow = useMemo(() => {
    return createVirtualWindow(filteredDownloadItems, downloadListScrollTop, {
      rowHeight: downloadRowHeight,
      visibleRows: downloadVisibleRows,
      overscanRows: downloadOverscanRows
    });
  }, [filteredDownloadItems, downloadListScrollTop]);

  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === activeRoute)?.label ?? 'Home',
    [activeRoute]
  );

  const loadCatalog = async () => {
    setCatalogState('loading');
    setMessage(null);

    try {
      const { catalog: nextCatalog, templates: nextTemplates } = await loadProjectCatalog();

      setCatalog(nextCatalog);
      setProjects(nextCatalog.projects);
      setTemplates(nextTemplates);
      setCatalogState('ready');
      setSelectedProjectId((current) => {
        if (current && nextCatalog.projects.some((project) => project.id === current)) {
          return current;
        }

        return null;
      });
    } catch (error) {
      setCatalogState('error');
      setMessage(errorMessage(error));
    }
  };

  const loadModsWorkspace = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready) {
      return;
    }

    const operationId = createRendererOperationId('mods_load');
    dispatchModsWorkspace({ type: 'load-started' });
    setModsBusyLabel('Loading mods');
    setMessage(null);

    try {
      const [nextInstalledMods, nextOrder] = await Promise.all([
        window.fluxora.mods.listInstalled(project.projectDirectory, { operationId }),
        window.fluxora.mods.getOrder(project.projectDirectory, selectedProjectProfileName, {
          operationId
        })
      ]);

      setInstalledMods(nextInstalledMods);
      dispatchModsWorkspace({ type: 'items-loaded', items: nextOrder });
      setModListScrollTop(0);
      setDraggedModOrderId(null);
      setModDropTargetOrderId(null);
    } catch (error) {
      dispatchModsWorkspace({ type: 'load-failed', message: errorMessage(error) });
      setMessage(errorMessage(error));
    } finally {
      setModsBusyLabel(null);
    }
  };

  const loadModFileTree = async (
    relativeDirectory = '',
    item: FluxoraModOrderItem | null = selectedModItem
  ) => {
    if (!selectedProject || !item?.isMod) {
      return;
    }

    const operationId = createRendererOperationId('mods_file_tree');
    setFileTreeLoadingPath(relativeDirectory);
    setFileTreeState((current) => (relativeDirectory ? current : 'loading'));

    try {
      const entries = await window.fluxora.mods.getFileTree(
        selectedProject.projectDirectory,
        item.id,
        relativeDirectory,
        { operationId }
      );
      setFileTreeCache((current) => ({ ...current, [relativeDirectory]: entries }));
      setFileTreeState('ready');
    } catch (error) {
      setFileTreeState('error');
      setMessage(errorMessage(error));
    } finally {
      setFileTreeLoadingPath(null);
    }
  };

  const runModMutation = async (
    busyText: string,
    action: (operationId: string) => Promise<unknown>
  ) => {
    if (!selectedProject) {
      return;
    }

    const operationId = createRendererOperationId('mods_mutation');
    setModsBusyLabel(busyText);
    setMessage(null);

    try {
      await action(operationId);
      await loadModsWorkspace(selectedProject);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setModsBusyLabel(null);
    }
  };

  const setModEnabled = async (item: FluxoraModOrderItem, isEnabled: boolean) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    await runModMutation(isEnabled ? 'Enabling mod' : 'Disabling mod', (operationId) =>
      window.fluxora.mods.setEnabled(selectedProject.projectDirectory, item.id, isEnabled, {
        operationId
      })
    );
  };

  const setAllModsEnabled = async (isEnabled: boolean) => {
    if (!selectedProject) {
      return;
    }

    await runModMutation(isEnabled ? 'Enabling all mods' : 'Disabling all mods', (operationId) =>
      window.fluxora.mods.setAllEnabled(selectedProject.projectDirectory, isEnabled, {
        operationId
      })
    );
  };

  const moveModOrderItemToIndex = async (
    item: FluxoraModOrderItem,
    targetIndex: number,
    busyText = 'Moving mod'
  ) => {
    if (!selectedProject) {
      return;
    }

    const sourceIndex = modsWorkspace.items.findIndex((candidate) => candidate.orderId === item.orderId);
    if (sourceIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    await runModMutation(busyText, (operationId) =>
      window.fluxora.mods.moveOrderItem(
        selectedProject.projectDirectory,
        selectedProjectProfileName,
        item.orderId,
        targetIndex,
        { operationId }
      )
    );
  };

  const moveModOrderItem = async (item: FluxoraModOrderItem, direction: -1 | 1) => {
    const targetIndex = targetIndexForMove(modsWorkspace.items, item.orderId, direction);
    if (targetIndex === null) {
      return;
    }

    await moveModOrderItemToIndex(item, targetIndex, direction < 0 ? 'Moving mod up' : 'Moving mod down');
  };

  const dropModOrderItem = async (target: FluxoraModOrderItem) => {
    if (!draggedModOrderId) {
      return;
    }

    const source = modsWorkspace.items.find((item) => item.orderId === draggedModOrderId);
    const targetIndex = targetIndexForDrop(modsWorkspace.items, draggedModOrderId, target.orderId);
    setDraggedModOrderId(null);
    setModDropTargetOrderId(null);

    if (!source || targetIndex === null) {
      return;
    }

    await moveModOrderItemToIndex(source, targetIndex, 'Moving mod');
  };

  const createModSeparator = async () => {
    if (!selectedProject) {
      return;
    }

    const title = window.prompt('Separator title')?.trim();
    if (!title) {
      return;
    }

    const selectedIndex = selectedModItem
      ? modsWorkspace.items.findIndex((item) => item.orderId === selectedModItem.orderId)
      : -1;
    const targetIndex = selectedIndex >= 0 ? selectedIndex + 1 : modsWorkspace.items.length;

    await runModMutation('Creating separator', (operationId) =>
      window.fluxora.mods.createSeparator(
        selectedProject.projectDirectory,
        selectedProjectProfileName,
        title,
        targetIndex,
        { operationId }
      )
    );
  };

  const deleteModSeparator = async (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isSeparator) {
      return;
    }

    await runModMutation('Deleting separator', (operationId) =>
      window.fluxora.mods.deleteSeparator(
        selectedProject.projectDirectory,
        selectedProjectProfileName,
        item.orderId,
        { operationId }
      )
    );
  };

  const createEmptyMod = async () => {
    if (!selectedProject) {
      return;
    }

    const modName = window.prompt('New mod name')?.trim();
    if (!modName) {
      return;
    }

    await runModMutation('Creating empty mod', (operationId) =>
      window.fluxora.mods.createEmpty(selectedProject.projectDirectory, modName, {
        operationId
      })
    );
  };

  const deleteInstalledMod = async (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    if (!window.confirm(`Delete installed mod "${modItemTitle(item)}"?`)) {
      return;
    }

    await runModMutation('Deleting mod', (operationId) =>
      window.fluxora.mods.deleteInstalled(selectedProject.projectDirectory, item.id, {
        operationId
      })
    );
  };

  const openInstalledMod = async (item: FluxoraModOrderItem) => {
    if (!item.isMod) {
      return;
    }

    const result = await window.fluxora.shell.openPath(item.id);
    if (!result.ok) {
      setMessage(result.message ?? 'Mod folder could not be opened.');
    }
  };

  const checkModUpdates = async () => {
    if (!selectedProject) {
      return;
    }

    await runModMutation('Checking updates', async (operationId) => {
      const nextInstalledMods = await window.fluxora.mods.checkUpdates(
        selectedProject.projectDirectory,
        { operationId }
      );
      setInstalledMods(nextInstalledMods);
    });
  };

  const toggleFileTreeDirectory = async (entry: FluxoraModFileTreeEntry) => {
    if (!entry.isDirectory || !entry.hasChildren) {
      return;
    }

    const isExpanded = Boolean(expandedFileTree[entry.relativePath]);
    setExpandedFileTree((current) => ({
      ...current,
      [entry.relativePath]: !isExpanded
    }));

    if (!isExpanded && !fileTreeCache[entry.relativePath]) {
      await loadModFileTree(entry.relativePath);
    }
  };

  const loadPluginsWorkspace = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready || !pluginCapabilities.bridgeAvailable) {
      return;
    }

    if (!pluginCapabilities.projectSupported) {
      dispatchPluginsWorkspace({ type: 'items-loaded', items: [] });
      return;
    }

    const operationId = createRendererOperationId('plugins_load');
    const profileName = selectedProjectProfileName;
    dispatchPluginsWorkspace({ type: 'load-started' });
    setPluginsBusyLabel('Loading plugins');
    setMessage(null);

    try {
      const nextPlugins = await window.fluxora.plugins.list(
        project.projectDirectory,
        project.templateId,
        profileName,
        { operationId }
      );
      dispatchPluginsWorkspace({ type: 'items-loaded', items: nextPlugins });
      setPluginListScrollTop(0);
    } catch (error) {
      dispatchPluginsWorkspace({ type: 'load-failed', message: errorMessage(error) });
      setMessage(errorMessage(error));
    } finally {
      setPluginsBusyLabel(null);
    }
  };

  const runPluginMutation = async (
    busyText: string,
    action: (operationId: string) => Promise<unknown>
  ) => {
    if (!selectedProject || !pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported) {
      return;
    }

    const operationId = createRendererOperationId('plugins_mutation');
    setPluginsBusyLabel(busyText);
    setMessage(null);

    try {
      await action(operationId);
      await loadPluginsWorkspace(selectedProject);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPluginsBusyLabel(null);
    }
  };

  const setPluginEnabled = async (item: FluxoraPluginOrderItem, isEnabled: boolean) => {
    if (!selectedProject || !item.isPlugin || item.isLocked) {
      return;
    }

    await runPluginMutation(isEnabled ? 'Enabling plugin' : 'Disabling plugin', (operationId) =>
      window.fluxora.plugins.setEnabled(
        selectedProject.projectDirectory,
        selectedProject.templateId,
        selectedProjectProfileName,
        item.name,
        isEnabled,
        { operationId }
      )
    );
  };

  const movePluginOrderItem = async (item: FluxoraPluginOrderItem, direction: -1 | 1) => {
    if (!selectedProject || !pluginCapabilities.loadOrderSupported) {
      return;
    }

    const targetIndex = targetIndexForPluginMove(pluginsWorkspace.items, item.orderId, direction);
    if (targetIndex === null) {
      return;
    }

    await runPluginMutation(direction < 0 ? 'Moving plugin up' : 'Moving plugin down', (operationId) =>
      window.fluxora.plugins.move(
        selectedProject.projectDirectory,
        selectedProject.templateId,
        selectedProjectProfileName,
        item.orderId,
        targetIndex,
        { operationId }
      )
    );
  };

  const createPluginSeparator = async () => {
    if (!selectedProject || !pluginCapabilities.loadOrderSupported) {
      return;
    }

    const title = window.prompt('Separator title')?.trim();
    if (!title) {
      return;
    }

    const selectedIndex = selectedPluginItem
      ? pluginsWorkspace.items.findIndex((item) => item.orderId === selectedPluginItem.orderId)
      : -1;
    const targetIndex = selectedIndex >= 0 ? selectedIndex + 1 : pluginsWorkspace.items.length;

    await runPluginMutation('Creating plugin separator', (operationId) =>
      window.fluxora.plugins.createSeparator(
        selectedProject.projectDirectory,
        selectedProject.templateId,
        selectedProjectProfileName,
        title,
        targetIndex,
        { operationId }
      )
    );
  };

  const deletePluginSeparator = async (item: FluxoraPluginOrderItem) => {
    if (!selectedProject || !item.isSeparator || !pluginCapabilities.loadOrderSupported) {
      return;
    }

    await runPluginMutation('Deleting plugin separator', (operationId) =>
      window.fluxora.plugins.deleteSeparator(
        selectedProject.projectDirectory,
        selectedProject.templateId,
        selectedProjectProfileName,
        item.orderId,
        { operationId }
      )
    );
  };

  const cacheProjectExecutables = (
    project: FluxoraProject,
    executables: FluxoraExecutable[]
  ) => {
    setProjects((current) =>
      current.map((candidate) =>
        candidate.id === project.id ||
        candidate.configPath === project.configPath ||
        candidate.projectDirectory === project.projectDirectory
          ? { ...candidate, executables }
          : candidate
      )
    );
  };

  const loadProfilesWorkspace = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready || !profilesCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('profiles_load');
    dispatchProfilesWorkspace({ type: 'load-started' });
    setProfilesBusyLabel('Loading profiles');
    setMessage(null);

    try {
      const profiles = await window.fluxora.profiles.list(
        project.projectDirectory,
        projectDefaultProfileName(project),
        { operationId }
      );
      dispatchProfilesWorkspace({
        type: 'items-loaded',
        items: profiles,
        defaultProfileName: projectDefaultProfileName(project)
      });
    } catch (error) {
      dispatchProfilesWorkspace({ type: 'load-failed', message: errorMessage(error) });
      setMessage(errorMessage(error));
    } finally {
      setProfilesBusyLabel(null);
    }
  };

  const runProfileMutation = async (
    busyText: string,
    action: (operationId: string) => Promise<string[]>,
    nextSelection?: string
  ) => {
    if (!selectedProject || !profilesCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('profiles_mutation');
    setProfilesBusyLabel(busyText);
    setMessage(null);

    try {
      const profiles = await action(operationId);
      setProfileDeleteArmedName(null);
      dispatchProfilesWorkspace({
        type: 'items-loaded',
        items: profiles,
        defaultProfileName: selectedProjectDefaultProfileName
      });
      if (nextSelection) {
        dispatchProfilesWorkspace({ type: 'selected', name: nextSelection });
      }
      setMessage(busyText);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setProfilesBusyLabel(null);
    }
  };

  const createProfile = async () => {
    if (!selectedProject) {
      return;
    }

    const profileName = profileDraftName.trim();
    if (!profileName) {
      setMessage('Enter a profile name first.');
      return;
    }

    await runProfileMutation('Created profile', (operationId) =>
      window.fluxora.profiles.create(
        selectedProject.projectDirectory,
        profileName,
        selectedProjectDefaultProfileName,
        selectedProject.template?.profileFiles ?? [],
        { operationId }
      ),
      profileName
    );
  };

  const cloneProfile = async () => {
    if (!selectedProject || !selectedProjectProfileName) {
      return;
    }

    const profileName =
      profileDraftName.trim() && profileDraftName.trim() !== selectedProjectProfileName
        ? profileDraftName.trim()
        : `${selectedProjectProfileName} Copy`;
    if (!profileName) {
      setMessage('Enter a profile name first.');
      return;
    }

    await runProfileMutation('Cloned profile', (operationId) =>
      window.fluxora.profiles.clone(
        selectedProject.projectDirectory,
        selectedProjectProfileName,
        profileName,
        selectedProjectDefaultProfileName,
        { operationId }
      ),
      profileName
    );
  };

  const renameProfile = async () => {
    if (!selectedProject || !selectedProjectProfileName) {
      return;
    }

    if (isDefaultProfileName(selectedProjectProfileName, selectedProjectDefaultProfileName)) {
      setMessage('The default profile cannot be renamed.');
      return;
    }

    const profileName = profileDraftName.trim();
    if (!profileName || profileName === selectedProjectProfileName) {
      setMessage(
        profileName ? 'Enter a different profile name.' : 'Enter a profile name first.'
      );
      return;
    }

    await runProfileMutation('Renamed profile', (operationId) =>
      window.fluxora.profiles.rename(
        selectedProject.projectDirectory,
        selectedProjectProfileName,
        profileName,
        selectedProjectDefaultProfileName,
        { operationId }
      ),
      profileName
    );
  };

  const deleteProfile = async () => {
    if (!selectedProject || !selectedProjectProfileName) {
      return;
    }

    if (isDefaultProfileName(selectedProjectProfileName, selectedProjectDefaultProfileName)) {
      setMessage('The default profile cannot be deleted.');
      return;
    }

    if (profileDeleteArmedName !== selectedProjectProfileName) {
      setProfileDeleteArmedName(selectedProjectProfileName);
      setMessage(`Click delete again to remove profile "${selectedProjectProfileName}".`);
      return;
    }

    await runProfileMutation('Deleted profile', (operationId) =>
      window.fluxora.profiles.delete(
        selectedProject.projectDirectory,
        selectedProjectProfileName,
        selectedProjectDefaultProfileName,
        { operationId }
      )
    );
  };

  const openProfilesDirectory = async () => {
    if (!selectedProject) {
      return;
    }

    const path = selectedProject.paths?.profilesDirectory;
    if (!path) {
      setMessage('Profiles directory is not reported for this build.');
      return;
    }

    const result = await window.fluxora.shell.openPath(path);
    if (!result.ok) {
      setMessage(result.message ?? 'Profiles directory could not be opened.');
    }
  };

  const loadExecutablesWorkspace = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready || !executableCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('executables_load');
    dispatchExecutablesWorkspace({ type: 'load-started' });
    setExecutablesBusyLabel('Loading executables');
    setMessage(null);

    try {
      const executables = await window.fluxora.executables.list(project.configPath, {
        operationId
      });
      dispatchExecutablesWorkspace({ type: 'items-loaded', items: executables });
      cacheProjectExecutables(project, executables);
    } catch (error) {
      dispatchExecutablesWorkspace({ type: 'load-failed', message: errorMessage(error) });
      setMessage(errorMessage(error));
    } finally {
      setExecutablesBusyLabel(null);
    }
  };

  const saveExecutableList = async (
    executables: FluxoraExecutable[],
    busyText: string,
    preferredSelection?: string
  ): Promise<FluxoraExecutable[] | null> => {
    if (!selectedProject || !executableCapabilities.bridgeAvailable) {
      return null;
    }

    const operationId = createRendererOperationId('executables_save');
    setExecutablesBusyLabel(busyText);
    setMessage(null);

    try {
      const saved = await window.fluxora.executables.save(
        selectedProject.configPath,
        executables,
        { operationId }
      );
      setExecutableDeleteArmedId(null);
      dispatchExecutablesWorkspace({ type: 'items-loaded', items: saved });
      cacheProjectExecutables(selectedProject, saved);
      const preferred =
        saved.find(
          (entry) => entry.id === preferredSelection || entry.executablePath === preferredSelection
        ) ?? saved[0] ?? null;
      if (preferred) {
        dispatchExecutablesWorkspace({ type: 'selected', id: preferred.id });
      }
      setMessage('Executables saved.');
      return saved;
    } catch (error) {
      setMessage(errorMessage(error));
      return null;
    } finally {
      setExecutablesBusyLabel(null);
    }
  };

  const addExecutable = async () => {
    if (!selectedProject) {
      return;
    }

    const picked = await window.fluxora.dialogs.pickExecutable(
      'Add executable',
      selectedProject.gamePath
    );
    if (picked.canceled || !picked.path) {
      return;
    }

    const fileName = fileNameFromPath(picked.path);
    const displayName = fileName.replace(/\.[^.]+$/, '') || 'Executable';
    await saveExecutableList(
      [
        ...executablesWorkspace.items,
        {
          id: '',
          displayName,
          executablePath: picked.path,
          arguments: '',
          workingDirectory: '',
          iconPath: ''
        }
      ],
      'Adding executable',
      picked.path
    );
  };

  const deleteExecutable = async () => {
    if (!selectedExecutableItem) {
      return;
    }

    if (executableDeleteArmedId !== selectedExecutableItem.id) {
      setExecutableDeleteArmedId(selectedExecutableItem.id);
      setMessage(`Click delete again to remove executable "${executableTitle(selectedExecutableItem)}".`);
      return;
    }

    await saveExecutableList(
      executablesWorkspace.items.filter((entry) => entry.id !== selectedExecutableItem.id),
      'Deleting executable'
    );
  };

  const saveExecutableDraft = async () => {
    if (!selectedExecutableItem || !executableDraft) {
      return;
    }

    await saveExecutableList(
      executablesWorkspace.items.map((entry) =>
        entry.id === selectedExecutableItem.id
          ? {
              ...executableDraft,
              id: selectedExecutableItem.id
            }
          : entry
      ),
      'Saving executable',
      selectedExecutableItem.id
    );
  };

  const browseExecutableForDraft = async () => {
    if (!executableDraft) {
      return;
    }

    const picked = await window.fluxora.dialogs.pickExecutable(
      'Select executable',
      executableDraft.executablePath || selectedProject?.gamePath
    );
    if (picked.canceled || !picked.path) {
      return;
    }
    const executablePath = picked.path;

    setExecutableDraft((current) =>
      current
        ? {
            ...current,
            executablePath,
            displayName: current.displayName || fileNameFromPath(executablePath).replace(/\.[^.]+$/, '')
          }
        : current
    );
  };

  const browseExecutableWorkingDirectory = async () => {
    if (!executableDraft) {
      return;
    }

    const picked = await window.fluxora.dialogs.pickFolder(
      'Select working directory',
      executableDraft.workingDirectory || selectedProject?.gamePath
    );
    if (picked.canceled || !picked.path) {
      return;
    }
    const workingDirectory = picked.path;

    setExecutableDraft((current) =>
      current ? { ...current, workingDirectory } : current
    );
  };

  const resolveExecutableIcon = async () => {
    if (!executableDraft?.executablePath) {
      return;
    }

    const operationId = createRendererOperationId('executables_icon');
    setExecutablesBusyLabel('Resolving icon');

    try {
      const result = await window.fluxora.executables.getIcon(executableDraft.executablePath, {
        operationId
      });
      setExecutableDraft((current) =>
        current ? { ...current, iconPath: result.iconPath } : current
      );
      setMessage(result.iconPath ? 'Executable icon resolved.' : 'No icon was resolved.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setExecutablesBusyLabel(null);
    }
  };

  const launchExecutable = async () => {
    if (!selectedProject || !selectedExecutableItem || !executableCapabilities.launchAvailable) {
      return;
    }

    const operationId = createRendererOperationId('executables_launch');
    setExecutablesBusyLabel('Launching executable');
    setExecutableLaunchResult(null);
    setLaunchSplash({
      operationId,
      appName: selectedExecutableItem.displayName,
      buildName: selectedProject.name,
      detail: 'Waiting for launch handoff'
    });
    setMessage(null);

    try {
      const result = await window.fluxora.executables.launch(
        selectedProject.configPath,
        selectedExecutableItem.id,
        selectedProjectProfileName,
        { operationId }
      );
      setExecutableLaunchResult(result);
      setMessage(`Launched ${result.displayName || selectedExecutableItem.displayName}.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLaunchSplash((current) => (current?.operationId === operationId ? null : current));
      setExecutablesBusyLabel(null);
    }
  };

  const downloadPath = (entry: FluxoraDownloadEntry): string => entry.localPath || entry.id;

  const refreshInstalledModNamesForInstall = async (
    project: FluxoraProject,
    operationId: string
  ) => {
    try {
      const mods = await window.fluxora.mods.listInstalled(project.projectDirectory, {
        operationId
      });
      setInstalledMods(mods);
    } catch {
      // Install can still continue; the C++ core will enforce existing-mod safety.
    }
  };

  const setInstallDialogPatch = (patch: Partial<InstallDialogState>) => {
    setInstallDialog((current) => (current ? { ...current, ...patch } : current));
  };

  const analyzeInstallLayout = async (
    source: InstallSource,
    operationId: string,
    selectedFomodOptionIds: string[] = []
  ): Promise<FluxoraContentLayoutPreview> => {
    if (!selectedProject) {
      throw new Error('Open a build before installing mods.');
    }

    if (selectedFomodOptionIds.length > 0) {
      return window.fluxora.downloads.analyzeFomodContentLayout(
        {
          projectDirectory: selectedProject.projectDirectory,
          downloadPath: source.sourcePath,
          existingModMode: 0,
          selectedOptionIds: selectedFomodOptionIds
        },
        { operationId }
      );
    }

    return window.fluxora.downloads.analyzeContentLayout(
      {
        projectDirectory: selectedProject.projectDirectory,
        downloadPath: source.sourcePath,
        existingModMode: 0
      },
      { operationId }
    );
  };

  const startInstallFlow = async (source: InstallSource) => {
    if (!selectedProject || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('install_flow');
    const fallbackName = defaultInstallModName(source.sourcePath, source.displayName);
    setDownloadMenuId(null);
    setDownloadsBusyLabel('Analyzing archive');
    setMessage(null);
    setInstallDialog({
      phase: 'analyzing',
      source,
      operationId,
      isFomod: false,
      fomodInstaller: null,
      selectedFomodOptionIds: [],
      fomodStepIndex: 0,
      activeFomodOptionId: null,
      layoutPreview: null,
      modName: fallbackName,
      existingModMode: 1,
      placementOverrides: {},
      draggedSourcePath: null,
      validationMessage: null,
      errorMessage: null
    });

    try {
      await refreshInstalledModNamesForInstall(selectedProject, operationId);
      const fomodInstaller = await window.fluxora.downloads.analyzeFomod(
        selectedProject.projectDirectory,
        source.sourcePath,
        { operationId }
      );

      if (fomodInstaller.isFomod) {
        setInstallDialogPatch({
          phase: 'fomod',
          isFomod: true,
          fomodInstaller,
          selectedFomodOptionIds: initialFomodSelection(fomodInstaller),
          fomodStepIndex: 0,
          activeFomodOptionId: null,
          modName: fomodInstaller.moduleName.trim() || fallbackName
        });
        return;
      }

      const layoutPreview = await analyzeInstallLayout(source, operationId);
      setInstallDialogPatch({
        phase: 'options',
        layoutPreview,
        modName: fallbackName
      });
    } catch (error) {
      setInstallDialogPatch({
        phase: 'error',
        errorMessage: errorMessage(error)
      });
      setMessage(errorMessage(error));
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const loadDownloadsWorkspace = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('downloads_load');
    dispatchDownloadsWorkspace({ type: 'load-started' });
    setDownloadsBusyLabel('Loading downloads');
    setMessage(null);

    try {
      await window.fluxora.nxm.importInboundDownloads(project.projectDirectory, { operationId });
      const nextDownloads = await window.fluxora.downloads.list(project.projectDirectory, {
        operationId
      });
      dispatchDownloadsWorkspace({ type: 'items-loaded', items: nextDownloads });
      setDownloadListScrollTop(0);
    } catch (error) {
      dispatchDownloadsWorkspace({ type: 'load-failed', message: errorMessage(error) });
      setMessage(errorMessage(error));
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const runDownloadMutation = async (
    busyText: string,
    action: (operationId: string) => Promise<unknown>,
    reloadMods = false
  ) => {
    if (!selectedProject || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('downloads_mutation');
    setDownloadsBusyLabel(busyText);
    setMessage(null);

    try {
      await action(operationId);
      await loadDownloadsWorkspace(selectedProject);
      if (reloadMods) {
        await loadModsWorkspace(selectedProject);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const importDownloadArchive = async () => {
    if (!selectedProject) {
      return;
    }

    const picked = await window.fluxora.dialogs.pickArchive(selectedProject.paths?.downloadsDirectory);
    if (picked.canceled || !picked.path) {
      return;
    }

    const archivePath = picked.path;
    await runDownloadMutation('Importing archive', async (operationId) => {
      const imported = await window.fluxora.downloads.importFile(
        selectedProject.projectDirectory,
        archivePath,
        { operationId }
      );
      dispatchDownloadsWorkspace({ type: 'selected', id: imported.id });
      setMessage(`Imported ${downloadTitle(imported)}`);
    });
  };

  const installArchiveFromDialog = async () => {
    if (!selectedProject) {
      return;
    }

    const picked = await window.fluxora.dialogs.pickArchive(selectedProject.paths?.downloadsDirectory);
    if (picked.canceled || !picked.path) {
      return;
    }

    const archivePath = picked.path;
    await startInstallFlow({
      kind: 'archive',
      sourcePath: archivePath,
      displayName: defaultInstallModName(archivePath, 'Archive'),
      fileName: fileNameFromPath(archivePath)
    });
  };

  const installDownload = async (entry: FluxoraDownloadEntry | null = selectedDownloadItem) => {
    if (!selectedProject || !entry) {
      return;
    }

    if (!entry.canInstall) {
      setMessage('This download is not ready to install yet.');
      return;
    }

    await startInstallFlow({
      kind: 'download',
      sourcePath: downloadPath(entry),
      displayName: downloadTitle(entry),
      fileName: entry.fileName || fileNameFromPath(downloadPath(entry))
    });
  };

  const deleteDownload = async (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canDelete) {
      return;
    }

    if (!window.confirm(`Delete download "${downloadTitle(entry)}"?`)) {
      return;
    }

    await runDownloadMutation('Deleting download', (operationId) =>
      window.fluxora.downloads.delete(selectedProject.projectDirectory, downloadPath(entry), {
        operationId
      })
    );
  };

  const cancelDownload = async (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.isDownloading) {
      return;
    }

    await runDownloadMutation('Cancelling download', (operationId) =>
      window.fluxora.downloads.cancel(selectedProject.projectDirectory, downloadPath(entry), {
        operationId
      })
    );
  };

  const resumeDownload = async (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canResume) {
      return;
    }

    await runDownloadMutation('Resuming download', (operationId) =>
      window.fluxora.downloads.resume(selectedProject.projectDirectory, downloadPath(entry), {
        operationId
      })
    );
  };

  const openDownloadInShell = async (entry: FluxoraDownloadEntry) => {
    const path = downloadPath(entry);
    const result = await window.fluxora.shell.showItemInFolder(path);
    if (!result.ok) {
      setMessage(result.message ?? 'Download location could not be opened.');
    }
  };

  const registerNxmProtocol = async () => {
    const operationId = createRendererOperationId('nxm_register');
    setDownloadsBusyLabel('Registering NXM');
    setMessage(null);

    try {
      const result = await window.fluxora.nxm.registerProtocol({ operationId });
      setMessage(result.message);
      const nextStatus = await window.fluxora.bridge.getStatus({ operationId });
      setBridgeStatus(nextStatus);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const importInboundDownloads = async () => {
    if (!selectedProject) {
      return;
    }

    await runDownloadMutation('Importing NXM queue', async (operationId) => {
      const imported = await window.fluxora.nxm.importInboundDownloads(
        selectedProject.projectDirectory,
        { operationId }
      );
      setMessage(imported.length === 0 ? 'No inbound NXM links found.' : `Imported ${imported.length} NXM link(s).`);
    });
  };

  const moveInstallFomodStep = async (direction: 1 | -1) => {
    if (!installDialog?.fomodInstaller || !installFomodEvaluation) {
      return;
    }

    const nextIndex = installDialog.fomodStepIndex + direction;
    if (nextIndex < 0 || nextIndex >= installFomodEvaluation.visibleSteps.length) {
      return;
    }

    if (direction > 0) {
      const validation = currentFomodStepValidation(
        installFomodEvaluation,
        installDialog.fomodStepIndex
      );
      if (validation) {
        setInstallDialogPatch({ validationMessage: validation });
        return;
      }
    }

    setInstallDialogPatch({
      fomodStepIndex: nextIndex,
      validationMessage: null
    });
  };

  const continueFromFomod = async () => {
    if (!selectedProject || !installDialog?.fomodInstaller || !installFomodEvaluation) {
      return;
    }

    const validation = currentFomodStepValidation(
      installFomodEvaluation,
      installDialog.fomodStepIndex
    );
    if (validation) {
      setInstallDialogPatch({ validationMessage: validation });
      return;
    }

    const operationId = installDialog.operationId;
    setInstallDialogPatch({ phase: 'analyzing', validationMessage: null });
    setDownloadsBusyLabel('Analyzing FOMOD layout');

    try {
      const layoutPreview = await analyzeInstallLayout(
        installDialog.source,
        operationId,
        installFomodEvaluation.selectedOptionIds
      );
      setInstallDialogPatch({
        phase: 'options',
        layoutPreview,
        selectedFomodOptionIds: installFomodEvaluation.selectedOptionIds,
        modName:
          installDialog.fomodInstaller.moduleName.trim() ||
          defaultInstallModName(installDialog.source.sourcePath, installDialog.source.displayName)
      });
    } catch (error) {
      setInstallDialogPatch({
        phase: 'error',
        errorMessage: errorMessage(error)
      });
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const submitInstallOptions = async () => {
    if (!selectedProject || !installDialog || !installDialog.layoutPreview) {
      return;
    }

    const modName = normalizeInstallModName(installDialog.modName);
    const nameValidation = validateInstallModName(modName);
    if (nameValidation) {
      setInstallDialogPatch({ validationMessage: nameValidation });
      return;
    }

    if (!installDialog.layoutPreview.canInstall && installPlacementOverrides.length === 0) {
      setInstallDialogPatch({
        validationMessage: 'The archive is blocked by placement rules. Open Details and move files before installing.'
      });
      return;
    }

    if (installExistingModName && installDialog.existingModMode === 0) {
      setInstallDialogPatch({
        validationMessage: `Choose Replace or Merge for existing mod "${installExistingModName}".`
      });
      return;
    }

    const existingModMode: FluxoraExistingModInstallMode = installExistingModName
      ? installDialog.existingModMode
      : 0;
    const placementOverridesJson =
      installPlacementOverrides.length > 0 ? JSON.stringify(installPlacementOverrides) : undefined;

    setInstallDialogPatch({
      phase: 'installing',
      validationMessage: null
    });
    setDownloadsBusyLabel(installExistingModName ? 'Updating mod' : 'Installing mod');

    try {
      let installed: FluxoraInstalledModSummary;
      if (installDialog.isFomod) {
        if (installDialog.source.kind === 'download') {
          installed = await window.fluxora.downloads.installFomod(
            {
              projectDirectory: selectedProject.projectDirectory,
              downloadPath: installDialog.source.sourcePath,
              modName,
              existingModMode,
              selectedOptionIds: installDialog.selectedFomodOptionIds,
              placementOverridesJson
            },
            { operationId: installDialog.operationId }
          );
        } else {
          installed = await window.fluxora.archives.installFomod(
            {
              projectDirectory: selectedProject.projectDirectory,
              archivePath: installDialog.source.sourcePath,
              modName,
              existingModMode,
              selectedOptionIds: installDialog.selectedFomodOptionIds,
              placementOverridesJson
            },
            { operationId: installDialog.operationId }
          );
        }
      } else if (installDialog.source.kind === 'download') {
        installed = await window.fluxora.downloads.install(
          {
            projectDirectory: selectedProject.projectDirectory,
            downloadPath: installDialog.source.sourcePath,
            modName,
            existingModMode,
            placementOverridesJson
          },
          { operationId: installDialog.operationId }
        );
      } else {
        installed = await window.fluxora.archives.install(
          {
            projectDirectory: selectedProject.projectDirectory,
            archivePath: installDialog.source.sourcePath,
            modName,
            existingModMode,
            placementOverridesJson
          },
          { operationId: installDialog.operationId }
        );
      }

      setMessage(
        existingModMode === 1
          ? `Replaced ${installed.name}`
          : existingModMode === 2
            ? `Merged ${installed.name}`
            : `Installed ${installed.name}`
      );
      setInstallDialog(null);
      await loadDownloadsWorkspace(selectedProject);
      await loadModsWorkspace(selectedProject);
      if (pluginCapabilities.bridgeAvailable && pluginCapabilities.projectSupported) {
        await loadPluginsWorkspace(selectedProject);
      }
    } catch (error) {
      setInstallDialogPatch({
        phase: 'error',
        errorMessage: errorMessage(error)
      });
      setMessage(errorMessage(error));
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const operationId = createRendererOperationId('renderer_startup');

    void window.fluxora.ui.log({
      level: 'info',
      category: 'Startup',
      message: 'renderer requested Phase 5 shell startup',
      operationId
    });

    Promise.all([
      window.fluxora.app.getInfo(),
      window.fluxora.security.getState(),
      window.fluxora.bridge.getStatus({ operationId })
    ]).then(
      async ([nextAppInfo, nextSecurityState, nextBridgeStatus]) => {
        if (!isMounted) {
          return;
        }

        setAppInfo(nextAppInfo);
        setSecurityState(nextSecurityState);
        setBridgeStatus(nextBridgeStatus);
        setThemeMode(normalizeThemeMode(nextBridgeStatus.theme));

        if (nextBridgeStatus.ready) {
          await loadCatalog();
          return;
        }

        setCatalogState('blocked');
      },
      (error) => {
        if (!isMounted) {
          return;
        }

        setCatalogState('error');
        setMessage(errorMessage(error));
      }
    );

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (projectMenuId) {
      return;
    }

    setProjectMenuPosition(null);
  }, [projectMenuId]);

  useEffect(() => {
    if (!projectMenuId) {
      return;
    }

    const closeProjectMenu = () => {
      setProjectMenuId(null);
      setProjectMenuPosition(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-project-menu-surface="true"], [data-project-menu-trigger="true"]')
      ) {
        return;
      }

      closeProjectMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeProjectMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeProjectMenu);
    window.addEventListener('scroll', closeProjectMenu, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeProjectMenu);
      window.removeEventListener('scroll', closeProjectMenu, true);
    };
  }, [projectMenuId]);

  useEffect(() => {
    if (
      !bridgeStatus?.ready ||
      draft.projectName.trim().length === 0 ||
      draft.installRootDirectory.trim().length === 0
    ) {
      setPreviewDirectory('');
      setPreviewBusy(false);
      return;
    }

    let isCanceled = false;
    setPreviewBusy(true);
    const operationId = createRendererOperationId('projects_preview');
    const timeout = window.setTimeout(() => {
      previewProjectDirectory(draft.projectName, draft.installRootDirectory, operationId)
        .then(
          (preview) => {
            if (!isCanceled) {
              setPreviewDirectory(preview.projectDirectory);
            }
          },
          () => {
            if (!isCanceled) {
              setPreviewDirectory('');
            }
          }
        )
        .finally(() => {
          if (!isCanceled) {
            setPreviewBusy(false);
          }
        });
    }, 150);

    return () => {
      isCanceled = true;
      window.clearTimeout(timeout);
    };
  }, [bridgeStatus?.ready, draft.projectName, draft.installRootDirectory]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'mods') ||
      !selectedProject ||
      !bridgeStatus?.ready
    ) {
      return;
    }

    void loadModsWorkspace(selectedProject);
  }, [
    activeRoute,
    bridgeStatus?.ready,
    selectedProject?.projectDirectory,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'plugins') ||
      !selectedProject ||
      !bridgeStatus?.ready
    ) {
      return;
    }

    if (!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported) {
      dispatchPluginsWorkspace({ type: 'items-loaded', items: [] });
      return;
    }

    void loadPluginsWorkspace(selectedProject);
  }, [
    activeRoute,
    bridgeStatus?.ready,
    pluginCapabilities.bridgeAvailable,
    pluginCapabilities.projectSupported,
    selectedProject?.projectDirectory,
    selectedProject?.templateId,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'downloads') ||
      !selectedProject ||
      !bridgeStatus?.ready
    ) {
      return;
    }

    if (!downloadCapabilities.bridgeAvailable) {
      dispatchDownloadsWorkspace({ type: 'items-loaded', items: [] });
      return;
    }

    void loadDownloadsWorkspace(selectedProject);
  }, [
    activeRoute,
    bridgeStatus?.ready,
    downloadCapabilities.bridgeAvailable,
    selectedProject?.projectDirectory
  ]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'profiles') ||
      !selectedProject ||
      !bridgeStatus?.ready
    ) {
      return;
    }

    if (!profilesCapabilities.bridgeAvailable) {
      dispatchProfilesWorkspace({
        type: 'items-loaded',
        items: [],
        defaultProfileName: selectedProjectDefaultProfileName
      });
      return;
    }

    void loadProfilesWorkspace(selectedProject);
  }, [
    activeRoute,
    bridgeStatus?.ready,
    profilesCapabilities.bridgeAvailable,
    selectedProject?.projectDirectory,
    selectedProjectDefaultProfileName
  ]);

  useEffect(() => {
    setProfileDraftName(selectedProjectProfileName);
    setProfileDeleteArmedName(null);
  }, [selectedProjectProfileName, selectedProject?.projectDirectory]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'executables') ||
      !selectedProject ||
      !bridgeStatus?.ready
    ) {
      return;
    }

    if (!executableCapabilities.bridgeAvailable) {
      dispatchExecutablesWorkspace({ type: 'items-loaded', items: [] });
      return;
    }

    void loadExecutablesWorkspace(selectedProject);
  }, [
    activeRoute,
    bridgeStatus?.ready,
    executableCapabilities.bridgeAvailable,
    selectedProject?.configPath
  ]);

  useEffect(() => {
    if ((activeRoute !== 'settings' && !isSettingsWindow) || !bridgeStatus?.ready) {
      return;
    }

    void loadSettingsWorkspace();
  }, [activeRoute, bridgeStatus?.ready, isSettingsWindow]);

  useEffect(() => {
    if (isSettingsWindow) {
      return;
    }

    return window.fluxora.transfer.onMo2Handoff((handoff) => {
      void startMo2TransferFromHandoff(handoff);
    });
  }, [isSettingsWindow, transferRunningOperationId]);

  useEffect(() => {
    transferRunningOperationIdRef.current = transferRunningOperationId;
  }, [transferRunningOperationId]);

  useEffect(() => {
    return window.fluxora.operations.onProgress((progress) => {
      if (progress.operationId === transferRunningOperationIdRef.current) {
        setTransferProgress(progress);
      }
    });
  }, []);

  useEffect(() => {
    if (!operationOverlay?.operationId) {
      return;
    }

    return window.fluxora.operations.onProgress((progress) => {
      if (progress.operationId !== operationOverlay.operationId) {
        return;
      }

      setOperationOverlay((current) =>
        current && current.operationId === progress.operationId
          ? {
              ...current,
              statusText:
                progress.statusMessage ||
                progress.currentStep ||
                progress.phase ||
                current.statusText,
              currentItem: progress.currentItem || current.currentItem,
              percent: Math.max(0, Math.min(100, progress.overallPercent))
            }
          : current
      );
    });
  }, [operationOverlay?.operationId]);

  useEffect(() => {
    setBuildPathDraft(emptyBuildPathDraft(selectedProject));
    setBuildPathExecutables([]);
    setBuildPathsError(null);
    setFluxPackSummary(null);
    setFluxPackInstallResult(null);
    setIsBuildPathsOpen(false);
  }, [selectedProject?.configPath]);

  useEffect(() => {
    setExecutableDraft(selectedExecutableItem ? { ...selectedExecutableItem } : null);
    setExecutableDeleteArmedId(null);
  }, [selectedExecutableItem?.id]);

  useEffect(() => {
    setFileTreeCache({});
    setExpandedFileTree({});

    if ((activeRoute !== 'build' && activeRoute !== 'mods') || !selectedModItem?.isMod) {
      setFileTreeState('idle');
      return;
    }

    void loadModFileTree('', selectedModItem);
  }, [activeRoute, selectedModItem?.orderId, selectedModItem?.id]);

  const changeRoute = (route: RouteId) => {
    if (isTransferRunning && route !== 'home') {
      setIsTransferPageOpen(true);
      setActiveRoute('home');
      setMessage('Перенос MO2 уже идет. Дождитесь завершения или отмените его на странице переноса.');
      return;
    }

    setActiveRoute(route);
  };

  const openSettingsWindow = async () => {
    try {
      await window.fluxora.windowControls.openSettings();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const minimizeWindow = async () => {
    try {
      await window.fluxora.windowControls.minimize();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const toggleMaximizeWindow = async () => {
    try {
      await window.fluxora.windowControls.toggleMaximize();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const closeWindow = async () => {
    try {
      await window.fluxora.windowControls.close();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const startCreate = () => {
    const installRoot = catalog.defaultInstallRootDirectory;
    setDraft({
      ...emptyProjectDraft(installRoot),
      templateId: templates[0]?.id ?? ''
    });
    setCreateStep(0);
    setTemplateSearchText('');
    setPreviewDirectory('');
    setIsCreateOpen(true);
    changeRoute('home');
    setMessage(null);
  };

  const beginOperationOverlay = (
    state: Omit<
      OperationOverlayState,
      'isRunning' | 'canClose' | 'cancelRequested' | 'createdProject' | 'resultText' | 'errorText'
    >
  ) => {
    setOperationOverlay({
      ...state,
      isRunning: true,
      canClose: false,
      cancelRequested: false,
      createdProject: null,
      resultText: null,
      errorText: null
    });
  };

  const finishOperationOverlay = (
    operationId: string,
    resultText: string,
    percent = 100,
    createdProject: FluxoraProject | null = null
  ) => {
    setOperationOverlay((current) =>
      current && current.operationId === operationId
        ? {
            ...current,
            statusText: resultText,
            currentItem: '',
            percent,
            isRunning: false,
            canClose: true,
            cancelRequested: false,
            createdProject,
            resultText,
            errorText: null
          }
        : current
    );
  };

  const failOperationOverlay = (operationId: string, errorText: string) => {
    setOperationOverlay((current) =>
      current && current.operationId === operationId
        ? {
            ...current,
            statusText: 'Operation failed',
            isRunning: false,
            canClose: true,
            cancelRequested: false,
            createdProject: null,
            errorText,
            resultText: null
          }
        : current
    );
  };

  const openProjectByConfig = async (configPath: string) => {
    setBusyLabel('Opening build');
    setMessage(null);

    try {
      const { project: opened } = await openProjectConfig(configPath);
      setProjects((current) => upsertProject(current, opened));
      setSelectedProjectId(opened.id);
      changeRoute('build');
      setMessage(`Opened ${opened.name}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyLabel(null);
    }
  };

  const openProjectFromDialog = async () => {
    const result = await window.fluxora.dialogs.pickBuildConfig(catalog.buildConfigsDirectory);
    if (result.canceled || !result.path) {
      return;
    }

    await openProjectByConfig(result.path);
  };

  const openSelectedProject = async () => {
    if (!selectedProject) {
      await openProjectFromDialog();
      return;
    }

    await openProjectByConfig(selectedProject.configPath);
  };

  const renameProject = async (project: FluxoraProject) => {
    const newName = window.prompt('Build name', project.name)?.trim();
    if (!newName || newName === project.name) {
      return;
    }

    setBusyLabel('Renaming build');
    setMessage(null);

    try {
      const { project: renamed } = await renameProjectConfig(project, newName);
      setProjects((current) => upsertProject(current, renamed));
      setSelectedProjectId(renamed.id);
      setMessage(`Renamed to ${renamed.name}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyLabel(null);
    }
  };

  const deleteProject = async (project: FluxoraProject) => {
    if (!window.confirm(`Delete build "${project.name}"?`)) {
      return;
    }

    const operationId = createRendererOperationId('projects_delete');
    beginOperationOverlay({
      operationId,
      kind: 'build-delete',
      title: 'Deleting build',
      statusText: 'Preparing deletion',
      currentItem: project.name,
      percent: 0
    });
    setMessage(null);

    try {
      await deleteProjectConfig(project, operationId);
      setProjects((current) =>
        current.filter((candidate) => candidate.configPath !== project.configPath)
      );
      if (selectedProjectId === project.id || selectedProjectId === project.configPath) {
        setSelectedProjectId(null);
        changeRoute('home');
      }
      setMessage(`Deleted ${project.name}`);
      finishOperationOverlay(operationId, `Deleted ${project.name}`);
    } catch (error) {
      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    } finally {
      setBusyLabel(null);
    }
  };

  const openProjectDirectory = async (project: FluxoraProject) => {
    const result = await window.fluxora.shell.openPath(project.projectDirectory);
    if (!result.ok) {
      setMessage(result.message ?? 'Project directory could not be opened.');
    }
  };

  const loadBuildPathSettings = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready) {
      return;
    }

    const operationId = createRendererOperationId('build_paths_get');
    setBuildPathsBusyLabel('Loading build paths');
    setBuildPathsError(null);
    setMessage(null);

    try {
      const [settings, executables] = await Promise.all([
        window.fluxora.buildPaths.get(project.configPath, { operationId }),
        window.fluxora.executables.list(project.configPath, { operationId })
      ]);
      setBuildPathDraft(draftFromBuildPathSettings(project, settings, executables));
      setBuildPathExecutables(executables);
      setIsBuildPathsOpen(true);
    } catch (error) {
      const nextMessage = errorMessage(error);
      setBuildPathDraft(emptyBuildPathDraft(project));
      setBuildPathsError(nextMessage);
      setMessage(nextMessage);
      setIsBuildPathsOpen(true);
    } finally {
      setBuildPathsBusyLabel(null);
    }
  };

  const openBuildPathSettings = async () => {
    if (!selectedProject) {
      return;
    }

    await loadBuildPathSettings(selectedProject);
  };

  const updateBuildPathDraft = (patch: Partial<BuildPathDraft>) => {
    setBuildPathDraft((current) => ({
      ...current,
      ...patch
    }));
    setBuildPathsError(null);
  };

  const browseBuildGameExecutable = async () => {
    const result = await window.fluxora.dialogs.pickExecutable(
      'Select game executable',
      buildPathDraft.gameExecutablePath || buildPathDraft.gameDirectory
    );
    if (!result.canceled && result.path) {
      updateBuildPathDraft({
        gameExecutablePath: result.path,
        gameDirectory: directoryFromExecutablePath(result.path) || buildPathDraft.gameDirectory
      });
    }
  };

  const browseBuildPathDirectory = async (
    title: string,
    field: keyof Pick<
      BuildPathDraft,
      'modsDirectory' | 'profilesDirectory' | 'downloadsDirectory' | 'overwriteDirectory'
    >
  ) => {
    const result = await window.fluxora.dialogs.pickFolder(
      title,
      buildPathDraft[field] || buildPathDraft.projectDirectory
    );
    if (!result.canceled && result.path) {
      updateBuildPathDraft({ [field]: result.path } as Partial<BuildPathDraft>);
    }
  };

  const saveBuildPathSettings = async () => {
    if (!selectedProject) {
      return;
    }

    const validationMessage = validateBuildPathDraft(
      buildPathDraft,
      bridgeStatus?.capabilities?.platform ?? appInfo?.platform ?? 'unknown'
    );
    if (validationMessage) {
      setBuildPathsError(validationMessage);
      setMessage(validationMessage);
      return;
    }

    const operationId = createRendererOperationId('build_paths_save');
    setBuildPathsBusyLabel('Saving build paths');
    setBuildPathsError(null);
    setMessage(null);

    try {
      const saved = await window.fluxora.buildPaths.save(
        selectedProject.configPath,
        buildPathSaveRequest(buildPathDraft),
        { operationId }
      );
      const savedExecutables = await window.fluxora.executables.save(
        selectedProject.configPath,
        buildPrimaryExecutableList(buildPathExecutables, buildPathDraft),
        { operationId }
      );
      const nextProject: FluxoraProject = {
        ...selectedProject,
        gamePath: buildPathDraft.gameExecutablePath.trim(),
        paths: {
          ...selectedProject.paths,
          gameDirectory: saved.gameDirectory,
          modsDirectory: saved.modsDirectory,
          profilesDirectory: saved.profilesDirectory,
          downloadsDirectory: saved.downloadsDirectory,
          overwriteDirectory: saved.overwriteDirectory
        },
        executables: savedExecutables
      };
      setProjects((current) => upsertProject(current, nextProject));
      setBuildPathDraft(draftFromBuildPathSettings(nextProject, saved, savedExecutables));
      setBuildPathExecutables(savedExecutables);
      setMessage('Build paths saved.');
      setIsBuildPathsOpen(false);
    } catch (error) {
      const nextMessage = errorMessage(error);
      setBuildPathsError(nextMessage);
      setMessage(nextMessage);
    } finally {
      setBuildPathsBusyLabel(null);
    }
  };

  const defaultFluxPackPath = (project: FluxoraProject): string =>
    `${project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'FluxoraBuild'}.fluxpack`;

  const packageFluxPack = async () => {
    if (!selectedProject) {
      return;
    }

    const saveResult = await window.fluxora.dialogs.saveFluxPack(
      defaultFluxPackPath(selectedProject),
      'Export FluxPack'
    );
    if (saveResult.canceled || !saveResult.path) {
      return;
    }

    const includeGeneratedAssets = window.confirm('Include generated assets in the FluxPack manifest?');
    const operationId = createRendererOperationId('fluxpack_export');
    beginOperationOverlay({
      operationId,
      kind: 'fluxpack-export',
      title: 'Packaging FluxPack',
      statusText: 'Writing FluxPack manifest',
      currentItem: selectedProject.name,
      percent: null
    });
    setMessage(null);

    try {
      const summary = await window.fluxora.fluxPack.export(
        {
          configPath: selectedProject.configPath,
          outputPath: saveResult.path,
          includeGeneratedAssets
        },
        { operationId }
      );
      setFluxPackSummary(summary);
      setFluxPackInstallResult(null);
      setActiveRightPane('build');
      setMessage(`FluxPack exported: ${summary.outputPath}`);
      finishOperationOverlay(operationId, `Exported ${summary.buildName || selectedProject.name}`);
    } catch (error) {
      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    }
  };

  const inspectFluxPack = async () => {
    const result = await window.fluxora.dialogs.pickFluxPack(catalog.defaultInstallRootDirectory);
    if (result.canceled || !result.path) {
      return;
    }

    const operationId = createRendererOperationId('fluxpack_inspect');
    setBusyLabel('Inspecting FluxPack');
    setMessage(null);

    try {
      const summary = await window.fluxora.fluxPack.inspect(result.path, { operationId });
      setFluxPackSummary(summary);
      setFluxPackInstallResult(null);
      setActiveRightPane('build');
      setMessage(`FluxPack ready: ${summary.buildName}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyLabel(null);
    }
  };

  const installFluxPack = async () => {
    const pickResult = await window.fluxora.dialogs.pickFluxPack(catalog.defaultInstallRootDirectory);
    if (pickResult.canceled || !pickResult.path) {
      return;
    }

    const rootResult = await window.fluxora.dialogs.pickFolder(
      'Select FluxPack install root',
      catalog.defaultInstallRootDirectory || selectedProject?.installRootDirectory
    );
    if (rootResult.canceled || !rootResult.path) {
      return;
    }

    const operationId = createRendererOperationId('fluxpack_install');
    beginOperationOverlay({
      operationId,
      kind: 'fluxpack-install',
      title: 'Installing FluxPack',
      statusText: 'Preparing FluxPack install',
      currentItem: pickResult.path,
      percent: 0
    });
    setMessage(null);

    try {
      const result = await window.fluxora.fluxPack.install(
        {
          fluxPackPath: pickResult.path,
          installRootDirectory: rootResult.path
        },
        { operationId }
      );
      setFluxPackSummary(result.summary);
      setFluxPackInstallResult(result);
      setActiveRightPane('build');
      const { project: opened } = await openProjectConfig(result.configPath, operationId);
      setProjects((current) => upsertProject(current, opened));
      setSelectedProjectId(opened.id);
      changeRoute('build');
      setMessage(`Installed FluxPack: ${result.buildName || opened.name}`);
      finishOperationOverlay(operationId, `Installed ${result.buildName || opened.name}`);
      await loadCatalog();
    } catch (error) {
      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    }
  };

  const cleanupCreatedBuild = async (project: FluxoraProject, sourceOperationId: string) => {
    const cleanupOperationId = createRendererOperationId('projects_create_cancel_cleanup');
    setOperationOverlay((current) =>
      current && current.operationId === sourceOperationId
        ? {
            ...current,
            statusText: 'Cancelling build creation',
            currentItem: 'Cleaning up created files',
            percent: null,
            isRunning: true,
            canClose: false,
            cancelRequested: true,
            createdProject: project,
            resultText: null,
            errorText: null
          }
        : current
    );

    try {
      await cleanupCreatedProject(project, cleanupOperationId);
      setProjects((current) =>
        current.filter(
          (candidate) =>
            candidate.id !== project.id &&
            candidate.configPath !== project.configPath &&
            candidate.projectDirectory !== project.projectDirectory
        )
      );
      if (
        selectedProjectId === project.id ||
        selectedProjectId === project.configPath ||
        selectedProjectId === project.projectDirectory
      ) {
        setSelectedProjectId(null);
        changeRoute('home');
      }
      createCancelRequestsRef.current.delete(sourceOperationId);
      setMessage(`Creation cancelled. Removed ${project.name}.`);
      setOperationOverlay((current) =>
        current && current.operationId === sourceOperationId
          ? {
              ...current,
              statusText: 'Build creation cancelled',
              currentItem: 'Created files were cleaned up',
              percent: 0,
              isRunning: false,
              canClose: true,
              cancelRequested: false,
              createdProject: null,
              resultText: 'Creation cancelled and files cleaned up',
              errorText: null
            }
          : current
      );
    } catch (error) {
      const nextMessage = `Cleanup failed: ${errorMessage(error)}`;
      setMessage(nextMessage);
      setOperationOverlay((current) =>
        current && current.operationId === sourceOperationId
          ? {
              ...current,
              statusText: 'Cleanup failed',
              currentItem: project.projectDirectory,
              percent: null,
              isRunning: false,
              canClose: true,
              cancelRequested: false,
              createdProject: project,
              resultText: null,
              errorText: nextMessage
            }
          : current
      );
    }
  };

  const cancelOperationOverlay = async () => {
    if (!operationOverlay) {
      return;
    }

    if (operationOverlay.kind === 'build-create') {
      if (operationOverlay.createdProject) {
        await cleanupCreatedBuild(operationOverlay.createdProject, operationOverlay.operationId);
        return;
      }

      createCancelRequestsRef.current.add(operationOverlay.operationId);
      setOperationOverlay((current) =>
        current && current.operationId === operationOverlay.operationId
          ? {
              ...current,
              statusText: 'Cancelling build creation',
              currentItem: 'Waiting for the core to stop safely',
              cancelRequested: true
            }
          : current
      );
      setMessage('Build creation will be cleaned up as soon as the current core step returns.');

      if (!operationOverlay.isRunning || !operationCancellationSupported) {
        return;
      }
    } else if (!operationOverlay.isRunning || !operationCancellationSupported) {
      return;
    }

    const operationId = createRendererOperationId('operation_cancel');
    try {
      const result = await window.fluxora.operations.cancel(operationOverlay.operationId, {
        operationId
      });
      setMessage(
        result.accepted
          ? 'Operation cancellation requested.'
          : 'The current native core cannot cancel this operation.'
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const browseGameExecutable = async () => {
    const result = await window.fluxora.dialogs.pickExecutable(
      'Select game executable',
      draft.gamePath
    );
    if (!result.canceled && result.path) {
      setDraft((current) => ({ ...current, gamePath: result.path ?? current.gamePath }));
    }
  };

  const browseInstallRoot = async () => {
    const result = await window.fluxora.dialogs.pickFolder(
      'Select install location',
      draft.installRootDirectory
    );
    if (!result.canceled && result.path) {
      setDraft((current) => ({
        ...current,
        installRootDirectory: result.path ?? current.installRootDirectory
      }));
    }
  };

  const advanceCreateStep = () => {
    if (!isProjectDraftStepComplete(draft, createStep)) {
      setMessage(`${wizardSteps[createStep].label} is required.`);
      return;
    }

    setMessage(null);
    setCreateStep((current) => Math.min(current + 1, wizardSteps.length - 1));
  };

  const createProject = async () => {
    if (!wizardSteps.every((_, step) => isProjectDraftStepComplete(draft, step))) {
      setMessage('Complete the build details first.');
      return;
    }

    const operationId = createRendererOperationId('projects_create');
    beginOperationOverlay({
      operationId,
      kind: 'build-create',
      title: 'Creating build',
      statusText: 'Creating project structure',
      currentItem: draft.projectName.trim(),
      percent: null
    });
    setMessage(null);

    try {
      const { project: created } = await createProjectFromDraft(draft, operationId);
      if (createCancelRequestsRef.current.has(operationId)) {
        await cleanupCreatedBuild(created, operationId);
        return;
      }

      setProjects((current) => upsertProject(current, created));
      setSelectedProjectId(created.id);
      setIsCreateOpen(false);
      changeRoute('build');
      setMessage(`Created ${created.name}`);
      finishOperationOverlay(operationId, `Created ${created.name}`);
    } catch (error) {
      if (createCancelRequestsRef.current.has(operationId)) {
        createCancelRequestsRef.current.delete(operationId);
        setMessage('Build creation cancelled.');
        finishOperationOverlay(operationId, 'Creation cancelled and files cleaned up', 0);
        return;
      }

      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    } finally {
      setBusyLabel(null);
    }
  };

  const setLanguage = async (language: string) => {
    const operationId = createRendererOperationId('language_set');
    setLanguageBusy(language);
    setMessage(null);
    void window.fluxora.ui.log({
      level: 'info',
      category: 'Settings',
      message: `renderer requested language ${language}`,
      operationId
    });

    try {
      const result = await window.fluxora.settings.setLanguage(language, { operationId });
      const nextStatus = await window.fluxora.bridge.getStatus({ operationId });
      setBridgeStatus({
        ...nextStatus,
        language: result.language,
        operationId
      });
      setMessage(`Language saved: ${result.language}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLanguageBusy(null);
    }
  };

  const loadSettingsWorkspace = async () => {
    if (!bridgeStatus?.ready) {
      return;
    }

    const operationId = createRendererOperationId('settings_load');
    setSettingsBusyLabel('Loading settings');
    setMessage(null);

    try {
      const [nextStatus, nextNexusStatus] = await Promise.all([
        window.fluxora.bridge.getStatus({ operationId }),
        window.fluxora.nexus.getAuthStatus({ operationId })
      ]);
      const nextThemeMode = normalizeThemeMode(nextStatus.theme);
      setBridgeStatus({
        ...nextStatus,
        theme: nextThemeMode,
        operationId
      });
      setThemeMode(nextThemeMode);
      setNexusStatus(nextNexusStatus);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSettingsBusyLabel(null);
    }
  };

  const toggleNexusConnection = async () => {
    const operationId = createRendererOperationId(nexusStatus?.isLinked ? 'nexus_disconnect' : 'nexus_connect');
    setNexusBusy(true);
    setMessage(null);

    try {
      const status = nexusStatus?.isLinked
        ? await window.fluxora.nexus.disconnect({ operationId })
        : await window.fluxora.nexus.connect({ operationId });
      setNexusStatus(status);
      setMessage(status.message || (status.isLinked ? 'Nexus Mods connected.' : 'Nexus Mods disconnected.'));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setNexusBusy(false);
    }
  };

  const pickTransferFolder = async (title: string, defaultPath: string): Promise<string | null> => {
    const result = await window.fluxora.dialogs.pickFolder(title, defaultPath);
    return !result.canceled && result.path ? result.path : null;
  };

  const resetTransferPlanningState = () => {
    setTransferAnalysis(null);
    setTransferError(null);
    setTransferResult(null);
    setTransferProgress(null);
    setTransferCancelRequested(false);
  };

  const loadTransferDestinationDrives = async () => {
    const operationId = createRendererOperationId('transfer_list_drives');
    setTransferDriveState('loading');

    try {
      const drives = await window.fluxora.transfer.listDestinationDrives({ operationId });
      setTransferDestinationDrives(drives);
      setTransferDriveState('ready');

      if (!transferDestinationRootDirectory.trim()) {
        const preferred = selectPreferredTransferDrive(
          drives,
          selectedProject?.installRootDirectory || catalog.defaultInstallRootDirectory,
          transferAnalysis?.totalBytes ?? 0
        );
        if (preferred) {
          setTransferDestinationRootDirectory(preferred.rootPath);
        }
      }
    } catch (error) {
      setTransferDriveState('error');
      setTransferError(errorMessage(error));
    }
  };

  const openMo2TransferSetup = () => {
    if (transferRunningOperationId) {
      setIsTransferPageOpen(true);
      return;
    }

    setIsCreateOpen(false);
    setIsTransferPageOpen(true);
    setActiveRoute('home');
    resetTransferPlanningState();
    setTransferStep(transferSourceDirectory.trim() ? 'game' : 'name');
    void loadTransferDestinationDrives();
  };

  const openMo2TransferFromSettings = async () => {
    if (isSettingsWindow) {
      try {
        await window.fluxora.transfer.openMo2InMain();
        await window.fluxora.windowControls.close();
      } catch (error) {
        setTransferError(errorMessage(error));
      }
      return;
    }

    openMo2TransferSetup();
  };

  useEffect(() => {
    if (isSettingsWindow) {
      return;
    }

    return window.fluxora.transfer.onMo2Open(() => {
      openMo2TransferSetup();
    });
  }, [
    isSettingsWindow,
    transferRunningOperationId,
    transferSourceDirectory,
    transferDestinationRootDirectory,
    selectedProject?.installRootDirectory,
    catalog.defaultInstallRootDirectory
  ]);

  const browseTransferSource = async () => {
    const path = await pickTransferFolder('Выберите папку сборки Mod Organizer 2', transferSourceDirectory);
    if (path) {
      const preferred = selectPreferredTransferDrive(
        transferDestinationDrives,
        transferDestinationRootDirectory ||
          selectedProject?.installRootDirectory ||
          catalog.defaultInstallRootDirectory,
        transferAnalysis?.totalBytes ?? 0
      );
      const destinationRootDirectory = transferDestinationRootDirectory.trim() || preferred?.rootPath || '';
      setTransferSourceDirectory(path);
      if (destinationRootDirectory) {
        setTransferDestinationRootDirectory(destinationRootDirectory);
      }
      resetTransferPlanningState();
      setTransferStep(destinationRootDirectory ? 'game' : 'install');
      if (destinationRootDirectory) {
        await analyzeMo2Transfer(path, destinationRootDirectory, 'game');
      }
    }
  };

  const selectTransferDestinationDrive = async (drive: FluxoraTransferDriveOption) => {
    const sourceDirectory = transferSourceDirectory.trim();
    setTransferDestinationRootDirectory(drive.rootPath);
    resetTransferPlanningState();
    setTransferStep(sourceDirectory ? 'game' : 'name');
    if (sourceDirectory) {
      await analyzeMo2Transfer(sourceDirectory, drive.rootPath, 'install');
    }
  };

  const analyzeMo2Transfer = async (
    rawSourceDirectory = transferSourceDirectory,
    rawDestinationRootDirectory = transferDestinationRootDirectory,
    nextStep: TransferStepId = 'install'
  ) => {
    const sourceDirectory = rawSourceDirectory.trim();
    const destinationRootDirectory = rawDestinationRootDirectory.trim();
    if (!sourceDirectory || !destinationRootDirectory) {
      setTransferError('Выберите папку сборки и отдельный диск или папку назначения.');
      return null;
    }

    const operationId = createRendererOperationId('transfer_analyze_mo2');
    setSettingsBusyLabel('Проверяем перенос');
    setTransferError(null);
    setTransferResult(null);
    setTransferStep(nextStep);

    try {
      const analysis = await window.fluxora.transfer.analyzeMo2(
        sourceDirectory,
        destinationRootDirectory,
        undefined,
        { operationId }
      );
      setTransferAnalysis(analysis);
      setMessage(analysis.statusMessage || 'Проверка переноса завершена.');
      return analysis;
    } catch (error) {
      const nextMessage = errorMessage(error);
      setTransferAnalysis(null);
      setTransferError(nextMessage);
      setMessage(nextMessage);
      return null;
    } finally {
      setSettingsBusyLabel(null);
    }
  };

  const startMo2TransferFromHandoff = async (handoff: FluxoraMo2TransferHandoff) => {
    if (transferRunningOperationId) {
      setMessage('MO2 import is already running in Fluxora.');
      return;
    }

    const handoffAnalysis = handoff.request.replaceExisting ? null : handoff.analysis ?? null;
    setTransferSourceDirectory(handoff.request.sourceDirectory);
    setTransferDestinationRootDirectory(handoff.request.destinationRootDirectory);
    setTransferAnalysis(handoffAnalysis);
    setTransferError(null);
    setTransferResult(null);
    setTransferProgress(null);
    setTransferCancelRequested(false);
    setTransferStep('install');
    setIsCreateOpen(false);
    setIsTransferPageOpen(true);
    setActiveRoute('home');

    await startMo2Transfer(handoff.request.sourceDirectory, handoff.request.destinationRootDirectory, {
      analysis: handoffAnalysis,
      skipMainHandoff: true
    });
  };

  const startMo2Transfer = async (
    rawSourceDirectory = transferSourceDirectory,
    rawDestinationRootDirectory = transferDestinationRootDirectory,
    options: StartMo2TransferOptions = {}
  ) => {
    const sourceDirectory = rawSourceDirectory.trim();
    const destinationRootDirectory = rawDestinationRootDirectory.trim();
    const canReuseAnalysis =
      sourceDirectory === transferSourceDirectory.trim() &&
      destinationRootDirectory === transferDestinationRootDirectory.trim();
    const analysis =
      options.analysis ??
      (canReuseAnalysis && transferAnalysis
        ? transferAnalysis
        : await analyzeMo2Transfer(sourceDirectory, destinationRootDirectory));
    if (!analysis) {
      return;
    }

    if (!analysis.canImport || !analysis.hasEnoughSpace) {
      setTransferError(analysis.warningMessage || analysis.statusMessage || 'Перенос пока недоступен.');
      return;
    }

    const importRequest = createMo2TransferImportRequest(
      sourceDirectory,
      destinationRootDirectory
    );

    if (isSettingsWindow && !options.skipMainHandoff) {
      try {
        await window.fluxora.transfer.startMo2InMain({
          request: importRequest,
          analysis
        });
        await window.fluxora.windowControls.close();
      } catch (error) {
        const nextMessage = errorMessage(error);
        setTransferError(nextMessage);
        setMessage(nextMessage);
      }
      return;
    }

    const operationId = createRendererOperationId('transfer_import_mo2');
    transferRunningOperationIdRef.current = operationId;
    setIsTransferPageOpen(true);
    setIsCreateOpen(false);
    setTransferSourceDirectory(sourceDirectory);
    setTransferDestinationRootDirectory(destinationRootDirectory);
    setTransferAnalysis(analysis);
    setTransferRunningOperationId(operationId);
    setTransferCancelRequested(false);
    setTransferProgress({
      operationId,
      phase: 'preparing',
      currentStep: 'Подготовка переноса',
      currentItem: analysis.projectName,
      overallPercent: 0,
      copyPercent: 0,
      databasePercent: 0,
      copiedBytes: 0,
      totalBytes: analysis.totalBytes
    });
    setTransferError(null);
    setTransferResult(null);
    setSettingsBusyLabel('Переносим сборку');
    setTransferStep('install');

    try {
      const imported = await window.fluxora.transfer.importMo2(
        importRequest,
        { operationId }
      );
      setTransferProgress((current) =>
        current
          ? {
              ...current,
              currentStep: 'Готово',
              currentItem: imported.name,
              overallPercent: 100,
              copyPercent: 100,
              databasePercent: 100
            }
          : current
      );
      setTransferResult(imported);
      setProjects((current) => upsertProject(current, imported));
      setSelectedProjectId(imported.id);
      setMessage(`Перенос завершен: ${imported.name}`);
      await loadCatalog();
    } catch (error) {
      const nextMessage = errorMessage(error);
      const cancellationMessage = nextMessage.toLowerCase();
      if (
        cancellationMessage.includes('canceled') ||
        cancellationMessage.includes('cancelled') ||
        cancellationMessage.includes('отмен')
      ) {
        const message = 'Перенос отменен. Временные файлы очищены.';
        setTransferError(message);
        setTransferProgress((current) =>
          current
            ? {
                ...current,
                phase: 'cancelled',
                currentStep: 'Перенос отменен',
                currentItem: 'Временные файлы очищены',
                overallPercent: 0
              }
            : current
        );
        setMessage(message);
      } else {
        setTransferError(nextMessage);
        setMessage(nextMessage);
      }
    } finally {
      transferRunningOperationIdRef.current = null;
      setTransferRunningOperationId(null);
      setTransferCancelRequested(false);
      setSettingsBusyLabel(null);
    }
  };

  const cancelMo2Transfer = async () => {
    const runningOperationId = transferRunningOperationIdRef.current ?? transferRunningOperationId;
    if (!runningOperationId || transferCancelRequested) {
      return;
    }

    const operationId = createRendererOperationId('transfer_cancel');
    setTransferCancelRequested(true);
    try {
      const result = await window.fluxora.operations.cancel(runningOperationId, { operationId });
      setMessage(
        result.accepted
          ? 'Запрос отмены переноса отправлен.'
          : 'Текущая native-сборка не поддерживает отмену этого переноса.'
      );
      if (result.accepted) {
        setTransferError(null);
        setTransferProgress((current) =>
          current
            ? {
                ...current,
                phase: 'canceling',
                currentStep: 'Отменяем и очищаем',
                currentItem: current.currentItem || 'Временная папка переноса'
              }
            : current
        );
      }
      if (!result.accepted) {
        setTransferCancelRequested(false);
        setTransferError('Отмена недоступна в текущем bridge, перенос будет заблокирован до безопасного завершения.');
      }
    } catch (error) {
      const nextMessage = errorMessage(error);
      setTransferCancelRequested(false);
      setTransferError(nextMessage);
      setMessage(nextMessage);
    }
  };

  const renderProjectRowMenu = (project: FluxoraProject) => {
    if (projectMenuId !== project.id || !projectMenuPosition) {
      return null;
    }

    return createPortal(
      <div
        className="mod-row-menu project-row-menu project-row-menu--overlay"
        role="menu"
        aria-label={`${project.name} build actions`}
        data-project-menu-surface="true"
        style={{
          left: projectMenuPosition.left,
          top: projectMenuPosition.top,
          maxHeight: projectMenuPosition.maxHeight
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setProjectMenuId(null);
            void renameProject(project);
          }}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>Rename</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setProjectMenuId(null);
            void openProjectDirectory(project);
          }}
        >
          <FolderOpen size={15} aria-hidden="true" />
          <span>Open folder</span>
        </button>
        <button
          className="project-row-menu__danger"
          type="button"
          role="menuitem"
          onClick={() => {
            setProjectMenuId(null);
            void deleteProject(project);
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
          <span>Delete</span>
        </button>
      </div>,
      document.body
    );
  };

  const renderCreateWizard = () => {
    const currentStep = wizardSteps[createStep];

    return (
      <section className="create-wizard" aria-label="Create build">
        <header className="create-wizard__header">
          <div>
            <p className="eyebrow">New build</p>
            <h2>{currentStep.label}</h2>
          </div>
          <span className="create-wizard__count">
            Step {createStep + 1} of {wizardSteps.length}
          </span>
        </header>

        <nav className="stepper" aria-label="Build creation steps">
          {wizardSteps.map((step, index) => {
            const isActive = index === createStep;
            const isComplete = isProjectDraftStepComplete(draft, index);
            const state = isActive ? 'active' : isComplete ? 'complete' : 'pending';
            const statusLabel = isActive ? 'Current' : isComplete ? 'Done' : 'To do';

            return (
              <button
                key={step.id}
                className="stepper__item"
                type="button"
                data-state={state}
                data-complete={isComplete}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => {
                  setMessage(null);
                  setCreateStep(index);
                }}
              >
                <span className="stepper__rail" aria-hidden="true" />
                <span className="stepper__marker" aria-hidden="true">
                  {isComplete && !isActive ? <CheckCircle2 size={16} /> : index + 1}
                </span>
                <span className="stepper__copy">
                  <strong>{step.label}</strong>
                  <small>{statusLabel}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="wizard-body">
          {createStep === 0 ? (
            <label className="field create-wizard-field create-wizard-field--name">
              <span>Как мы назовём вашу сборку?</span>
              <input
                value={draft.projectName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, projectName: event.target.value }))
                }
                placeholder="My Skyrim build"
              />
            </label>
          ) : null}

          {createStep === 1 ? (
            <>
              <label className="field create-wizard-field create-wizard-field--search">
                <span>Game search</span>
                <input
                  value={templateSearchText}
                  onChange={(event) => setTemplateSearchText(event.target.value)}
                  placeholder="Skyrim, Fallout..."
                />
              </label>
              <div className="template-list template-list--create-wizard">
                {filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    data-active={draft.templateId === template.id}
                    onClick={() =>
                      setDraft((current) => ({ ...current, templateId: template.id }))
                    }
                  >
                    <strong>{template.displayName || template.gameName}</strong>
                    <span>{template.summary || template.id}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {createStep === 2 ? (
            <label className="field create-wizard-field create-wizard-field--path">
              <span>Game executable</span>
              <div className="path-picker path-picker--create-wizard">
                <input
                  value={draft.gamePath}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, gamePath: event.target.value }))
                  }
                  placeholder="Path to game executable"
                />
                <button className="tool-button" type="button" onClick={() => void browseGameExecutable()}>
                  <FolderOpen size={16} aria-hidden="true" />
                  Browse
                </button>
              </div>
            </label>
          ) : null}

          {createStep === 3 ? (
            <>
              <label className="field create-wizard-field create-wizard-field--path">
                <span>Install root</span>
                <div className="path-picker path-picker--create-wizard">
                  <input
                    value={draft.installRootDirectory}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        installRootDirectory: event.target.value
                      }))
                    }
                    placeholder="Folder for Fluxora builds"
                  />
                  <button className="tool-button" type="button" onClick={() => void browseInstallRoot()}>
                    <FolderOpen size={16} aria-hidden="true" />
                    Browse
                  </button>
                </div>
              </label>
              <div className="directory-preview directory-preview--create-wizard" data-loading={previewBusy}>
                <span>Preview</span>
                <strong>{previewBusy ? 'Calculating...' : previewDirectory || 'Waiting for input'}</strong>
              </div>
            </>
          ) : null}
        </div>

        <div className="wizard-actions">
          <button
            className="tool-button"
            type="button"
            onClick={() => {
              setMessage(null);
              setIsCreateOpen(false);
            }}
          >
            Cancel
          </button>
          <div className="wizard-actions__nav">
            <button
              className="tool-button"
              type="button"
              disabled={createStep === 0}
              onClick={() => setCreateStep((current) => Math.max(current - 1, 0))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Back
            </button>
            {createStep < wizardSteps.length - 1 ? (
              <button className="primary-button" type="button" onClick={advanceCreateStep}>
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={Boolean(busyLabel) || !selectedTemplate}
                onClick={() => void createProject()}
              >
                Create
                <CheckCircle2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderInspector = () => {
    if (isCreateOpen) {
      return renderCreateWizard();
    }

    return (
      <aside className="inspector" aria-label="Build inspector">
        <div className="surface-header surface-header--compact">
          <div>
            <p className="eyebrow">Selected build</p>
            <h2>{selectedProject?.name ?? 'None'}</h2>
          </div>
        </div>
        <dl className="fact-list">
          <div>
            <dt>Core</dt>
            <dd data-status={bridgeStatusLabel(bridgeStatus)}>
              {bridgeStatus?.ready ? 'available' : bridgeStatus?.error ? 'unavailable' : 'pending'}
            </dd>
          </div>
          <div>
            <dt>Catalog</dt>
            <dd>{projects.length} builds</dd>
          </div>
          <div>
            <dt>Game</dt>
            <dd>{selectedProject?.gameName ?? 'not opened'}</dd>
          </div>
          <div>
            <dt>Capabilities</dt>
            <dd>{selectedProject ? projectCapabilitiesLabel(selectedProject) : 'none'}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{appInfo ? `${appInfo.platform}/${appInfo.arch}` : 'pending'}</dd>
          </div>
          <div>
            <dt>IPC channels</dt>
            <dd>{securityState?.allowedIpcChannels.length ?? 0}</dd>
          </div>
        </dl>
        <div className="language-strip" aria-label="Language">
          {['en-us', 'ru-ru', 'de-de'].map((language) => (
            <button
              key={language}
              type="button"
              data-active={bridgeStatus?.language === language}
              disabled={!bridgeStatus?.ready || languageBusy !== null}
              onClick={() => void setLanguage(language)}
            >
              {languageBusy === language ? 'Saving' : language}
            </button>
          ))}
        </div>
      </aside>
    );
  };

  const renderHome = () => {
    return (
      <LibraryHome
        bridgeErrorMessage={bridgeStatus?.error?.message ?? message ?? undefined}
        catalogPath={catalog.buildConfigsDirectory}
        catalogState={catalogState}
        filteredProjects={filteredProjects}
        isNewBuildDisabled={!bridgeStatus?.ready || isTransferRunning}
        message={message}
        onNewBuild={startCreate}
        onOpenProject={(project) => void openProjectByConfig(project.configPath)}
        onOpenProjectDirectory={(project) => void openProjectDirectory(project)}
        onOpenSelectedProject={() => void openSelectedProject()}
        onProjectMenuToggle={(project, anchor) => {
          if (projectMenuId === project.id) {
            setProjectMenuId(null);
            setProjectMenuPosition(null);
            return;
          }

          setProjectMenuPosition(projectMenuPositionFromAnchor(anchor));
          setProjectMenuId(project.id);
        }}
        onSearchChange={setSearchText}
        onSelectProject={(project) => {
          setSelectedProjectId(project.id);
          setProjectMenuId(null);
        }}
        projectMenuId={projectMenuId}
        projects={projects}
        projectStats={(project, isSelected) =>
          buildProjectLibraryStats(project, isSelected ? selectedProjectRuntimeSummary : undefined)
        }
        renderProjectRowMenu={renderProjectRowMenu}
        searchText={searchText}
        selectedProject={selectedProject}
        selectedProjectStats={selectedProjectLibraryStats}
      />
    );
  };

  const renderModRowMenu = (item: FluxoraModOrderItem) => (
    <div className="mod-row-menu" role="menu" aria-label={`${modItemTitle(item)} actions`}>
      {item.isMod ? (
        <button type="button" role="menuitem" onClick={() => void setModEnabled(item, !item.isEnabled)}>
          {item.isEnabled ? 'Disable' : 'Enable'}
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => void moveModOrderItem(item, -1)}>
        Move up
      </button>
      <button type="button" role="menuitem" onClick={() => void moveModOrderItem(item, 1)}>
        Move down
      </button>
      {item.isMod ? (
        <button type="button" role="menuitem" onClick={() => void openInstalledMod(item)}>
          Open folder
        </button>
      ) : null}
      {item.isSeparator ? (
        <button type="button" role="menuitem" onClick={() => void deleteModSeparator(item)}>
          Delete separator
        </button>
      ) : (
        <button type="button" role="menuitem" onClick={() => void deleteInstalledMod(item)}>
          Delete mod
        </button>
      )}
    </div>
  );

  const renderModRows = () => {
    if (modsWorkspace.loadState === 'loading') {
      return (
        <EmptyState
          icon={<RefreshCw size={18} aria-hidden="true" />}
          title="Loading mods"
          description={selectedProject?.projectDirectory ?? 'Selected build'}
          tone="loading"
        />
      );
    }

    if (modsWorkspace.loadState === 'error') {
      return (
        <EmptyState
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          title="Mods unavailable"
          description={modsWorkspace.errorMessage ?? 'The native core could not load mods.'}
          tone="error"
        />
      );
    }

    if (filteredModItems.length === 0) {
      return (
        <EmptyState
          icon={<Box size={18} aria-hidden="true" />}
          title={modsWorkspace.items.length === 0 ? 'No installed mods' : 'No matching mods'}
          description={
            modsWorkspace.items.length === 0
              ? 'Create an empty mod or install an archive.'
              : 'Clear the search query to return to the full order.'
          }
        />
      );
    }

    return (
      <div className="mod-list mod-list--table" role="table" aria-label="Mod order">
        <div className="mod-list__head" role="row">
          <span className="mod-list__head-name" role="columnheader">
            Название
          </span>
          <span role="columnheader">Версия</span>
          <span role="columnheader">Latest</span>
          <span role="columnheader">Статус</span>
        </div>
        <div
          className="mod-list__body"
          role="rowgroup"
          onScroll={(event) => setModListScrollTop(event.currentTarget.scrollTop)}
        >
          {visibleModWindow.topSpacer > 0 ? (
            <div style={{ height: visibleModWindow.topSpacer }} aria-hidden="true" />
          ) : null}
          {visibleModWindow.items.map((item) => {
            const isSelected = item.orderId === modsWorkspace.selectedOrderId;
            const isMenuOpen = item.orderId === modMenuOrderId;
            const isNested = isModNestedUnderSeparator(modsWorkspace.items, item.orderId);
            const overwrite = modOverwriteView(item);
            const status = modTableStatusView(item);
            const separatorModCount = item.isSeparator
              ? modSeparatorChildCount(modsWorkspace.items, item.orderId)
              : 0;
            const isDragging = draggedModOrderId === item.orderId;
            const isDropTarget =
              modDropTargetOrderId === item.orderId && draggedModOrderId !== item.orderId;

            return (
              <div
                className={`mod-list-row${item.isSeparator ? ' mod-list-row--separator' : ''}`}
                role="row"
                tabIndex={0}
                draggable={!modsBusyLabel}
                data-selected={isSelected}
                data-separator={item.isSeparator}
                data-in-separator={isNested}
                data-dragging={isDragging}
                data-drop-target={isDropTarget}
                data-menu-open={isMenuOpen}
                key={item.orderId}
                aria-label={`${modItemTitle(item)} ${item.isSeparator ? 'separator' : 'mod'}`}
                onClick={() => {
                  dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  setModMenuOrderId(null);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  setModMenuOrderId(item.orderId);
                }}
                onDragStart={(event) => {
                  if (modsBusyLabel) {
                    event.preventDefault();
                    return;
                  }

                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', item.orderId);
                  dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  setDraggedModOrderId(item.orderId);
                  setModDropTargetOrderId(null);
                  setModMenuOrderId(null);
                }}
                onDragEnter={(event) => {
                  if (!draggedModOrderId || draggedModOrderId === item.orderId) {
                    return;
                  }

                  event.preventDefault();
                  setModDropTargetOrderId(item.orderId);
                }}
                onDragOver={(event) => {
                  if (!draggedModOrderId || draggedModOrderId === item.orderId) {
                    return;
                  }

                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setModDropTargetOrderId(item.orderId);
                }}
                onDragLeave={() => {
                  setModDropTargetOrderId((current) =>
                    current === item.orderId ? null : current
                  );
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void dropModOrderItem(item);
                }}
                onDragEnd={() => {
                  setDraggedModOrderId(null);
                  setModDropTargetOrderId(null);
                }}
                onKeyDown={(event) => {
                  if (event.currentTarget !== event.target) {
                    return;
                  }

                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                    setModMenuOrderId(null);
                  }

                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                    setModMenuOrderId(item.orderId);
                  }
                }}
              >
                {item.isSeparator ? (
                  <>
                    <div className="mod-separator-cell" role="cell">
                      <span className="mod-separator-line" aria-hidden="true" />
                      <strong className="mod-separator-title">{modItemTitle(item)}</strong>
                      <span className="mod-separator-count">
                        {separatorModCount} {separatorModCount === 1 ? 'mod' : 'mods'}
                      </span>
                      <span className="mod-separator-line" aria-hidden="true" />
                    </div>
                    {isMenuOpen ? renderModRowMenu(item) : null}
                  </>
                ) : (
                  <>
                    <div className="mod-list-row__identity" role="cell">
                      <label
                        className="mod-enable-checkbox"
                        title={item.isEnabled ? 'Disable mod' : 'Enable mod'}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={item.isEnabled}
                          disabled={Boolean(modsBusyLabel)}
                          aria-label={item.isEnabled ? `Disable ${modItemTitle(item)}` : `Enable ${modItemTitle(item)}`}
                          title={item.isEnabled ? 'Disable mod' : 'Enable mod'}
                          onChange={(event) => void setModEnabled(item, event.currentTarget.checked)}
                        />
                        <span aria-hidden="true" />
                      </label>
                      <StatusDot
                        className="mod-conflict-dot"
                        label={overwrite.title}
                        size={18}
                        state={overwrite.state}
                        title={overwrite.title}
                      />
                      <div className="mod-list-row__title">
                        <strong>{modItemTitle(item)}</strong>
                        <span>{item.sourceIsNexus ? 'Nexus Mods' : item.isLocal ? 'Local' : 'Managed'}</span>
                      </div>
                    </div>
                    <span className="mod-list-row__version" role="cell">
                      {modVersionText(item)}
                    </span>
                    <span className="mod-list-row__latest" data-update={item.hasUpdate} role="cell">
                      {modLatestVersionText(item)}
                    </span>
                    <span className="mod-list-row__status" role="cell">
                      <span className="mod-status-chip" data-status={status.tone}>
                        {status.label}
                      </span>
                    </span>
                    {isMenuOpen ? renderModRowMenu(item) : null}
                  </>
                )}
              </div>
            );
          })}
          {visibleModWindow.bottomSpacer > 0 ? (
            <div style={{ height: visibleModWindow.bottomSpacer }} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    );
  };

  const renderFileTreeEntries = (relativeDirectory = '', depth = 0): ReactElement[] => {
    const entries = fileTreeCache[relativeDirectory] ?? [];
    return entries.flatMap((entry) => {
      const isExpanded = Boolean(expandedFileTree[entry.relativePath]);
      const isLoading = fileTreeLoadingPath === entry.relativePath;
      const row = (
        <div
          className="file-tree-row"
          data-conflict={hasConflict(entry)}
          key={entry.relativePath || entry.name}
          role="treeitem"
          aria-expanded={entry.isDirectory && entry.hasChildren ? isExpanded : undefined}
          aria-level={depth + 1}
          style={{ paddingLeft: 10 + depth * 16 }}
        >
          <button
            className="icon-button"
            type="button"
            title={entry.isDirectory ? 'Toggle folder' : 'File'}
            disabled={!entry.isDirectory || !entry.hasChildren}
            onClick={() => void toggleFileTreeDirectory(entry)}
          >
            {entry.isDirectory ? (
              isExpanded ? (
                <ChevronDown size={15} aria-hidden="true" />
              ) : (
                <ChevronRight size={15} aria-hidden="true" />
              )
            ) : (
              <File size={15} aria-hidden="true" />
            )}
          </button>
          <span>{entry.name}</span>
          <strong>{isLoading ? 'Loading' : formatFileSize(entry.size)}</strong>
        </div>
      );

      if (!entry.isDirectory || !isExpanded) {
        return [row];
      }

      return [row, ...renderFileTreeEntries(entry.relativePath, depth + 1)];
    });
  };

  const renderModsInspector = () => (
    <aside className="inspector mods-inspector" aria-label="Selected mod details">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">Selected mod</p>
          <h2>{selectedModItem ? modItemTitle(selectedModItem) : 'None'}</h2>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>Installed</dt>
          <dd>{installedMods.length}</dd>
        </div>
        <div>
          <dt>Visible</dt>
          <dd>{filteredModItems.length}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{modStatusText(selectedModItem)}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{selectedModItem?.isMod ? selectedModItem.version || 'local' : 'separator'}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{selectedModItem?.isMod ? selectedModItem.fileCount : 0}</dd>
        </div>
        <div>
          <dt>Conflicts</dt>
          <dd>
            {selectedModItem?.isMod
              ? selectedModItem.conflictingFileCount || selectedModItem.conflictStatus || 'none'
              : 'none'}
          </dd>
        </div>
      </dl>
      <div className="file-tree-panel">
        <div className="file-tree-panel__header">
          <FolderTree size={16} aria-hidden="true" />
          <strong>File tree</strong>
          {selectedModItem?.isMod ? (
            <button
              className="icon-button"
              type="button"
              title="Reload file tree"
              onClick={() => void loadModFileTree('', selectedModItem)}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="file-tree" role="tree" aria-label="Selected mod file tree">
          {!selectedModItem?.isMod ? (
            <span className="file-tree-empty">Select an installed mod.</span>
          ) : fileTreeState === 'loading' ? (
            <span className="file-tree-empty">Loading tree</span>
          ) : fileTreeState === 'error' ? (
            <span className="file-tree-empty">File tree unavailable.</span>
          ) : (fileTreeCache[''] ?? []).length === 0 ? (
            <span className="file-tree-empty">No files indexed yet.</span>
          ) : (
            renderFileTreeEntries()
          )}
        </div>
      </div>
    </aside>
  );

  const renderModsWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>No build selected</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            Go home
          </button>
        </section>
      );
    }

    return (
      <section className="mods-layout" aria-label="Build mods workspace">
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Mods</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label="Mod commands">
              <button
                className="icon-button"
                type="button"
                title="Refresh mods"
                disabled={Boolean(modsBusyLabel)}
                onClick={() => void loadModsWorkspace(selectedProject)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                title="Check updates"
                disabled={Boolean(modsBusyLabel)}
                onClick={() => void checkModUpdates()}
              >
                <CircleDot size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                title="Enable all mods"
                disabled={Boolean(modsBusyLabel)}
                onClick={() => void setAllModsEnabled(true)}
              >
                <CheckCircle2 size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                title="Disable all mods"
                disabled={Boolean(modsBusyLabel)}
                onClick={() => void setAllModsEnabled(false)}
              >
                <XCircle size={16} aria-hidden="true" />
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(modsBusyLabel)}
                onClick={() => void createModSeparator()}
              >
                <Layers size={16} aria-hidden="true" />
                Separator
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(modsBusyLabel)}
                onClick={() => void createEmptyMod()}
              >
                <Plus size={16} aria-hidden="true" />
                Empty mod
              </button>
            </div>
          </div>
          {message ? (
            <div className="activity-banner" role="status">
              <CircleDot size={16} aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {modsBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{modsBusyLabel}</span>
            </div>
          ) : null}
          {renderModRows()}
        </section>
        {renderModsInspector()}
      </section>
    );
  };

  const renderPluginRowMenu = (item: FluxoraPluginOrderItem) => (
    <div className="mod-row-menu" role="menu" aria-label={`${pluginItemTitle(item)} actions`}>
      {item.isPlugin ? (
        <button
          type="button"
          role="menuitem"
          disabled={item.isLocked}
          onClick={() => void setPluginEnabled(item, !item.isEnabled)}
        >
          {item.isEnabled ? 'Disable' : 'Enable'}
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        disabled={!pluginCapabilities.loadOrderSupported}
        onClick={() => void movePluginOrderItem(item, -1)}
      >
        Move up
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!pluginCapabilities.loadOrderSupported}
        onClick={() => void movePluginOrderItem(item, 1)}
      >
        Move down
      </button>
      {item.isSeparator ? (
        <button type="button" role="menuitem" onClick={() => void deletePluginSeparator(item)}>
          Delete separator
        </button>
      ) : null}
    </div>
  );

  const renderPluginRows = () => {
    if (pluginsWorkspace.loadState === 'loading') {
      return (
        <EmptyState
          icon={<RefreshCw size={18} aria-hidden="true" />}
          title="Loading plugins"
          description={selectedProject?.projectDirectory ?? 'Selected build'}
          tone="loading"
        />
      );
    }

    if (pluginsWorkspace.loadState === 'error') {
      return (
        <EmptyState
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          title="Plugins unavailable"
          description={pluginsWorkspace.errorMessage ?? 'The native core could not load plugins.'}
          tone="error"
        />
      );
    }

    if (filteredPluginItems.length === 0) {
      return (
        <EmptyState
          icon={<MoreHorizontal size={18} aria-hidden="true" />}
          title={pluginsWorkspace.items.length === 0 ? 'No detected plugins' : 'No matching plugins'}
          description={
            pluginsWorkspace.items.length === 0
              ? 'Install or enable a mod with plugin files to populate the load order.'
              : 'Clear the search query to return to the full load order.'
          }
        />
      );
    }

    return (
      <div className="mod-table plugin-table" role="table" aria-label="Plugin load order">
        <div className="mod-row plugin-row mod-row--head" role="row">
          <span role="columnheader">Order</span>
          <span role="columnheader">Plugin</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Actions</span>
        </div>
        <div
          className="mod-table__body"
          onScroll={(event) => setPluginListScrollTop(event.currentTarget.scrollTop)}
        >
          {visiblePluginWindow.topSpacer > 0 ? (
            <div style={{ height: visiblePluginWindow.topSpacer }} aria-hidden="true" />
          ) : null}
          {visiblePluginWindow.items.map((item) => {
            const isSelected = item.orderId === pluginsWorkspace.selectedOrderId;
            const isMenuOpen = item.orderId === pluginMenuOrderId;
            const state = pluginStatusText(item);

            return (
              <div
                className="mod-row plugin-row"
                role="row"
                tabIndex={0}
                data-selected={isSelected}
                data-separator={item.isSeparator}
                data-locked={item.isLocked}
                data-menu-open={isMenuOpen}
                key={item.orderId}
                onClick={() => {
                  dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                  setPluginMenuOrderId(null);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                  setPluginMenuOrderId(item.orderId);
                }}
                onKeyDown={(event) => {
                  if (event.currentTarget !== event.target) {
                    return;
                  }

                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                    setPluginMenuOrderId(null);
                  }

                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                    setPluginMenuOrderId(item.orderId);
                  }
                }}
              >
                <span className="plugin-hex-index" role="cell">
                  {pluginHexIndex(item)}
                </span>
                <div className="mod-row__main" role="cell">
                  <strong>{pluginItemTitle(item)}</strong>
                  <span>
                    {item.isSeparator
                      ? 'separator'
                      : item.lockReason || item.missingMasters.join(', ') || item.orderId}
                  </span>
                </div>
                <span role="cell">
                  {item.isSeparator ? null : (
                    <span
                      className="plugin-type-badge"
                      data-master={item.isMaster}
                      data-light={item.isLight}
                    >
                      {pluginTypeLabel(item)}
                    </span>
                  )}
                </span>
                <span
                  role="cell"
                  data-status={item.isLocked || item.missingMasters.length > 0 ? 'checking' : item.isEnabled ? 'ready' : 'error'}
                >
                  {item.isSeparator ? '' : state}
                </span>
                <span role="cell">{item.isSeparator ? '' : item.sourceMod || 'game data'}</span>
                <div className="row-actions mod-actions" role="cell" data-menu-open={isMenuOpen}>
                  {item.isPlugin ? (
                    <button
                      className="icon-button"
                      type="button"
                      title={item.isEnabled ? 'Disable plugin' : 'Enable plugin'}
                      disabled={item.isLocked || Boolean(pluginsBusyLabel)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void setPluginEnabled(item, !item.isEnabled);
                      }}
                    >
                      <Power size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    className="icon-button"
                    type="button"
                    title="Move up"
                    disabled={!pluginCapabilities.loadOrderSupported || Boolean(pluginsBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void movePluginOrderItem(item, -1);
                    }}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Move down"
                    disabled={!pluginCapabilities.loadOrderSupported || Boolean(pluginsBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void movePluginOrderItem(item, 1);
                    }}
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Actions"
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                      setPluginMenuOrderId((current) =>
                        current === item.orderId ? null : item.orderId
                      );
                    }}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {isMenuOpen ? renderPluginRowMenu(item) : null}
                </div>
              </div>
            );
          })}
          {visiblePluginWindow.bottomSpacer > 0 ? (
            <div style={{ height: visiblePluginWindow.bottomSpacer }} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    );
  };

  const renderPluginsInspector = () => (
    <aside className="inspector plugins-inspector" aria-label="Selected plugin details">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">Selected plugin</p>
          <h2>{selectedPluginItem ? pluginItemTitle(selectedPluginItem) : 'None'}</h2>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>Entries</dt>
          <dd>{pluginsWorkspace.items.length}</dd>
        </div>
        <div>
          <dt>Visible</dt>
          <dd>{filteredPluginItems.length}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{pluginStatusText(selectedPluginItem)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{pluginTypeLabel(selectedPluginItem)}</dd>
        </div>
        <div>
          <dt>Source mod</dt>
          <dd>{selectedPluginItem?.isPlugin ? selectedPluginItem.sourceMod || 'game data' : 'none'}</dd>
        </div>
        <div>
          <dt>Missing masters</dt>
          <dd>
            {selectedPluginItem?.isPlugin && selectedPluginItem.missingMasters.length > 0
              ? selectedPluginItem.missingMasters.join(', ')
              : 'none'}
          </dd>
        </div>
        <div>
          <dt>Lock</dt>
          <dd>{selectedPluginItem?.isLocked ? selectedPluginItem.lockReason || 'locked' : 'none'}</dd>
        </div>
      </dl>
      <div className="plugin-capability-panel">
        <strong>Capability</strong>
        <span>
          {pluginCapabilities.loadOrderSupported
            ? 'Plugin load-order editing is available for this build.'
            : pluginCapabilities.reason || 'Load order editing is not available.'}
        </span>
      </div>
    </aside>
  );

  const renderPluginsWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>No build selected</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            Go home
          </button>
        </section>
      );
    }

    if (!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported) {
      return (
        <section className="center-empty" aria-label="Plugins capability state">
          <MoreHorizontal size={22} aria-hidden="true" />
          <h2>Plugins unavailable</h2>
          <span>{pluginCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout plugins-layout" aria-label="Build plugins workspace">
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Plugins</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label="Plugin commands">
              <button
                className="icon-button"
                type="button"
                title="Refresh plugins"
                disabled={Boolean(pluginsBusyLabel)}
                onClick={() => void loadPluginsWorkspace(selectedProject)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(pluginsBusyLabel) || !pluginCapabilities.loadOrderSupported}
                onClick={() => void createPluginSeparator()}
              >
                <Layers size={16} aria-hidden="true" />
                Separator
              </button>
            </div>
          </div>
          {message ? (
            <div className="activity-banner" role="status">
              <CircleDot size={16} aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {pluginsBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{pluginsBusyLabel}</span>
            </div>
          ) : null}
          {!pluginCapabilities.loadOrderSupported ? (
            <div className="mod-busy-strip" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{pluginCapabilities.reason}</span>
            </div>
          ) : null}
          {renderPluginRows()}
        </section>
        {renderPluginsInspector()}
      </section>
    );
  };

  const renderDownloadRowMenu = (entry: FluxoraDownloadEntry) => (
    <div className="mod-row-menu" role="menu" aria-label={`${downloadTitle(entry)} actions`}>
      <button
        type="button"
        role="menuitem"
        disabled={!entry.canInstall || Boolean(downloadsBusyLabel)}
        onClick={() => void installDownload(entry)}
      >
        Install
      </button>
      {entry.isDownloading ? (
        <button
          type="button"
          role="menuitem"
          disabled={Boolean(downloadsBusyLabel)}
          onClick={() => void cancelDownload(entry)}
        >
          Cancel
        </button>
      ) : null}
      {entry.canResume ? (
        <button
          type="button"
          role="menuitem"
          disabled={Boolean(downloadsBusyLabel)}
          onClick={() => void resumeDownload(entry)}
        >
          Resume
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => void openDownloadInShell(entry)}>
        Show in folder
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!entry.canDelete || Boolean(downloadsBusyLabel)}
        onClick={() => void deleteDownload(entry)}
      >
        Delete
      </button>
    </div>
  );

  const renderDownloadRows = () => {
    if (downloadsWorkspace.loadState === 'loading') {
      return (
        <EmptyState
          icon={<RefreshCw size={18} aria-hidden="true" />}
          title="Loading downloads"
          description={selectedProject?.projectDirectory ?? 'Selected build'}
          tone="loading"
        />
      );
    }

    if (downloadsWorkspace.loadState === 'error') {
      return (
        <EmptyState
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          title="Downloads unavailable"
          description={downloadsWorkspace.errorMessage ?? 'The native core could not load downloads.'}
          tone="error"
        />
      );
    }

    if (filteredDownloadItems.length === 0) {
      return (
        <EmptyState
          icon={<Download size={18} aria-hidden="true" />}
          title={downloadsWorkspace.items.length === 0 ? 'No downloads yet' : 'No matching downloads'}
          description={
            downloadsWorkspace.items.length === 0
              ? 'Import an archive or capture NXM links to populate this queue.'
              : 'Clear the search query to return to the full download queue.'
          }
        />
      );
    }

    return (
      <div className="mod-table download-table" role="table" aria-label="Downloads">
        <div className="mod-row download-row mod-row--head" role="row">
          <span role="columnheader">File</span>
          <span role="columnheader">Progress</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Source</span>
          <span role="columnheader">Actions</span>
        </div>
        <div
          className="mod-table__body"
          onScroll={(event) => setDownloadListScrollTop(event.currentTarget.scrollTop)}
        >
          {visibleDownloadWindow.topSpacer > 0 ? (
            <div style={{ height: visibleDownloadWindow.topSpacer }} aria-hidden="true" />
          ) : null}
          {visibleDownloadWindow.items.map((entry) => {
            const isSelected = entry.id === downloadsWorkspace.selectedId;
            const isMenuOpen = entry.id === downloadMenuId;
            const progressValue = downloadProgressValue(entry);

            return (
              <div
                className="mod-row download-row"
                role="row"
                tabIndex={0}
                data-selected={isSelected}
                data-ready={entry.canInstall}
                data-menu-open={isMenuOpen}
                key={entry.id}
                onClick={() => {
                  dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  setDownloadMenuId(null);
                }}
                onDoubleClick={() => {
                  dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  if (entry.canInstall) {
                    void installDownload(entry);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  setDownloadMenuId(entry.id);
                }}
                onKeyDown={(event) => {
                  if (event.currentTarget !== event.target) {
                    return;
                  }

                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                    setDownloadMenuId(null);
                  }

                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                    setDownloadMenuId(entry.id);
                  }
                }}
              >
                <div className="mod-row__main" role="cell">
                  <strong>{downloadTitle(entry)}</strong>
                  <span>{entry.fileName || shortPath(downloadPath(entry))}</span>
                </div>
                <div className="download-progress" role="cell">
                  <div className="download-progress__bar" aria-hidden="true">
                    <span style={{ width: `${entry.hasKnownProgress ? progressValue : 0}%` }} />
                  </div>
                  <small>{entry.progressText || (entry.hasKnownProgress ? `${progressValue}%` : 'unknown')}</small>
                </div>
                <span role="cell" data-status={entry.canInstall ? 'ready' : entry.canResume ? 'checking' : entry.isDownloading ? 'planned' : 'error'}>
                  {downloadStatusText(entry)}
                </span>
                <span role="cell">{entry.sizeText || '-'}</span>
                <span role="cell">{entry.source || 'local'}</span>
                <div className="row-actions mod-actions" role="cell" data-menu-open={isMenuOpen}>
                  <button
                    className="icon-button"
                    type="button"
                    title="Install"
                    disabled={!entry.canInstall || Boolean(downloadsBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void installDownload(entry);
                    }}
                  >
                    <Play size={16} aria-hidden="true" />
                  </button>
                  {entry.isDownloading ? (
                    <button
                      className="icon-button"
                      type="button"
                      title="Cancel download"
                      disabled={Boolean(downloadsBusyLabel)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void cancelDownload(entry);
                      }}
                    >
                      <XCircle size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      className="icon-button"
                      type="button"
                      title="Resume download"
                      disabled={!entry.canResume || Boolean(downloadsBusyLabel)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void resumeDownload(entry);
                      }}
                    >
                      <RefreshCw size={16} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    title="Delete download"
                    disabled={!entry.canDelete || Boolean(downloadsBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteDownload(entry);
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Actions"
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                      setDownloadMenuId((current) => (current === entry.id ? null : entry.id));
                    }}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                  {isMenuOpen ? renderDownloadRowMenu(entry) : null}
                </div>
              </div>
            );
          })}
          {visibleDownloadWindow.bottomSpacer > 0 ? (
            <div style={{ height: visibleDownloadWindow.bottomSpacer }} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    );
  };

  const renderDownloadsInspector = () => (
    <aside className="inspector plugins-inspector" aria-label="Selected download details">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">Selected download</p>
          <h2>{selectedDownloadItem ? downloadTitle(selectedDownloadItem) : 'None'}</h2>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>Queued</dt>
          <dd>{downloadsWorkspace.items.length}</dd>
        </div>
        <div>
          <dt>Visible</dt>
          <dd>{filteredDownloadItems.length}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{downloadStatusText(selectedDownloadItem)}</dd>
        </div>
        <div>
          <dt>Progress</dt>
          <dd>
            {selectedDownloadItem
              ? selectedDownloadItem.progressText || `${downloadProgressValue(selectedDownloadItem)}%`
              : 'none'}
          </dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{selectedDownloadItem?.downloadSpeedText || selectedDownloadItem?.etaText || 'none'}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{selectedDownloadItem ? shortPath(downloadPath(selectedDownloadItem)) : 'none'}</dd>
        </div>
      </dl>
      <div className="plugin-capability-panel">
        <strong>NXM protocol</strong>
        <span>
          {downloadCapabilities.nxmRegistrationState === 'available'
            ? 'Protocol registration is available on this platform.'
            : downloadCapabilities.nxmRegistrationState === 'limited'
              ? 'Protocol capture is wired; installer packaging must finish OS registration.'
              : 'Protocol state is not reported by the bridge.'}
        </span>
      </div>
    </aside>
  );

  const renderRightPanePluginDetails = () => (
    <section className="right-pane-detail-card" aria-label="Selected plugin detail">
      <div>
        <span>Selected plugin</span>
        <strong>{selectedPluginItem ? pluginItemTitle(selectedPluginItem) : 'None'}</strong>
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{pluginStatusText(selectedPluginItem)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{pluginTypeLabel(selectedPluginItem)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{selectedPluginItem?.isPlugin ? selectedPluginItem.sourceMod || 'game data' : 'none'}</dd>
        </div>
        <div>
          <dt>Missing masters</dt>
          <dd>
            {selectedPluginItem?.isPlugin && selectedPluginItem.missingMasters.length > 0
              ? selectedPluginItem.missingMasters.join(', ')
              : 'none'}
          </dd>
        </div>
      </dl>
    </section>
  );

  const renderRightPaneDownloadDetails = () => (
    <section className="right-pane-detail-card" aria-label="Selected download detail">
      <div>
        <span>Selected download</span>
        <strong>{selectedDownloadItem ? downloadTitle(selectedDownloadItem) : 'None'}</strong>
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{downloadStatusText(selectedDownloadItem)}</dd>
        </div>
        <div>
          <dt>Progress</dt>
          <dd>
            {selectedDownloadItem
              ? selectedDownloadItem.progressText || `${downloadProgressValue(selectedDownloadItem)}%`
              : 'none'}
          </dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{selectedDownloadItem ? shortPath(downloadPath(selectedDownloadItem)) : 'none'}</dd>
        </div>
        <div>
          <dt>NXM</dt>
          <dd>{downloadCapabilities.nxmRegistrationState}</dd>
        </div>
      </dl>
    </section>
  );

  const renderRightPanePathTree = (
    rows: Array<{ id: string; label: string; value: string; level?: number }>
  ) => (
    <div className="right-pane-path-tree" role="tree" aria-label="Build data folders">
      {rows.map((row) => (
        <div
          className="right-pane-path-row"
          key={row.id}
          role="treeitem"
          aria-level={row.level ?? 1}
          style={{ paddingLeft: `${10 + ((row.level ?? 1) - 1) * 16}px` }}
        >
          <FolderOpen size={15} aria-hidden="true" />
          <span>{row.label}</span>
          <code title={row.value}>{row.value || 'not configured'}</code>
        </div>
      ))}
    </div>
  );

  const renderDataRightPane = () => {
    const pathRows = [
      {
        id: 'project',
        label: 'Project',
        value: selectedProject?.projectDirectory ?? '',
        level: 1
      },
      {
        id: 'game',
        label: 'Game',
        value: selectedProject?.paths?.gameDirectory ?? selectedProject?.gamePath ?? '',
        level: 2
      },
      {
        id: 'mods',
        label: 'Mods',
        value: selectedProject?.paths?.modsDirectory ?? '',
        level: 2
      },
      {
        id: 'profiles',
        label: 'Profiles',
        value: selectedProject?.paths?.profilesDirectory ?? '',
        level: 2
      },
      {
        id: 'downloads',
        label: 'Downloads',
        value: selectedProject?.paths?.downloadsDirectory ?? '',
        level: 2
      },
      {
        id: 'overwrite',
        label: 'Overwrite',
        value: selectedProject?.paths?.overwriteDirectory ?? '',
        level: 2
      },
      {
        id: 'config',
        label: 'Config',
        value: selectedProject?.configPath ?? '',
        level: 1
      }
    ];

    return (
      <div
        className="right-pane-content right-pane-content--data"
        role="tabpanel"
        aria-label="Данные"
      >
        <section className="right-pane-section">
          <header>
            <FolderTree size={16} aria-hidden="true" />
            <div>
              <strong>Build folders</strong>
              <span>Read-only paths from the project DTO.</span>
            </div>
          </header>
          {renderRightPanePathTree(pathRows)}
        </section>

        <section className="right-pane-section right-pane-section--tree">
          <header>
            <FolderTree size={16} aria-hidden="true" />
            <div>
              <strong>Selected mod data</strong>
              <span>{selectedModItem?.isMod ? modItemTitle(selectedModItem) : 'Select a mod row.'}</span>
            </div>
            {selectedModItem?.isMod ? (
              <button
                className="icon-button"
                type="button"
                title="Reload selected mod file tree"
                onClick={() => void loadModFileTree('', selectedModItem)}
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            ) : null}
          </header>
          <div className="file-tree right-pane-file-tree" role="tree" aria-label="Selected mod data tree">
            {!selectedModItem?.isMod ? (
              <span className="file-tree-empty">Select an installed mod to inspect indexed files.</span>
            ) : fileTreeState === 'loading' ? (
              <span className="file-tree-empty">Loading tree</span>
            ) : fileTreeState === 'error' ? (
              <span className="file-tree-empty">File tree unavailable.</span>
            ) : (fileTreeCache[''] ?? []).length === 0 ? (
              <span className="file-tree-empty">No files indexed yet.</span>
            ) : (
              renderFileTreeEntries()
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderBuildRightPane = () => {
    const selectedExecutablePath =
      selectedExecutableItem?.executablePath || selectedProject?.gamePath || 'not configured';
    const buildRows = [
      ['Project', selectedProject?.projectDirectory ?? 'not configured'],
      ['Game directory', selectedProject?.paths?.gameDirectory ?? 'not configured'],
      ['Mods', selectedProject?.paths?.modsDirectory ?? 'not configured'],
      ['Profiles', selectedProject?.paths?.profilesDirectory ?? 'not configured'],
      ['Downloads', selectedProject?.paths?.downloadsDirectory ?? 'not configured'],
      ['Overwrite', selectedProject?.paths?.overwriteDirectory ?? 'not configured']
    ] as const;

    return (
      <div
        className="right-pane-content right-pane-content--build"
        role="tabpanel"
        aria-label="Сборка"
      >
        <section className="right-pane-section">
          <header>
            <FolderTree size={16} aria-hidden="true" />
            <div>
              <strong>Build paths</strong>
              <span>Core-owned locations, shown read-only here.</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title={buildHeaderCapabilities.settingsReason || 'Open build settings'}
              disabled={!buildHeaderCapabilities.settingsAvailable || Boolean(buildPathsBusyLabel)}
              onClick={() => void openBuildPathSettings()}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          </header>
          <dl className="right-pane-path-list">
            {buildRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd title={value}>{value}</dd>
              </div>
            ))}
          </dl>
          {buildPathsError ? (
            <div className="settings-note" data-status="error" role="alert">
              <strong>Build paths need attention</strong>
              <span>{buildPathsError}</span>
            </div>
          ) : null}
          {buildPathsBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{buildPathsBusyLabel}</span>
            </div>
          ) : null}
        </section>

        <section className="right-pane-section">
          <header>
            <Play size={16} aria-hidden="true" />
            <div>
              <strong>Executable config</strong>
              <span>{selectedProjectProfileName}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title={executableCapabilities.launchReason || 'Launch executable'}
              disabled={
                !selectedExecutableItem ||
                !executableCapabilities.launchAvailable ||
                Boolean(executablesBusyLabel)
              }
              onClick={() => void launchExecutable()}
            >
              <Play size={15} aria-hidden="true" />
            </button>
          </header>
          <dl className="right-pane-path-list">
            <div>
              <dt>Name</dt>
              <dd>{selectedExecutableItem?.displayName || 'not configured'}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd title={selectedExecutablePath}>{selectedExecutablePath}</dd>
            </div>
            <div>
              <dt>Arguments</dt>
              <dd>{selectedExecutableItem?.arguments || 'none'}</dd>
            </div>
            <div>
              <dt>Launch</dt>
              <dd>{executableCapabilities.launchAvailable ? 'available' : executableCapabilities.launchReason}</dd>
            </div>
          </dl>
        </section>

        <section className="right-pane-section right-pane-section--fluxpack">
          <header>
            <File size={16} aria-hidden="true" />
            <div>
              <strong>FluxPack</strong>
              <span>{fluxPackSummary ? fluxPackSummary.outputPath : 'No package summary yet.'}</span>
            </div>
          </header>
          <div className="right-pane-actionbar" aria-label="FluxPack actions">
            <button
              className="tool-button"
              type="button"
              title={buildHeaderCapabilities.packageReason || 'Export FluxPack'}
              disabled={!buildHeaderCapabilities.packageAvailable || Boolean(operationOverlay?.isRunning)}
              onClick={() => void packageFluxPack()}
            >
              <UploadCloud size={16} aria-hidden="true" />
              Package
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={!bridgeStatus?.ready || Boolean(operationOverlay?.isRunning)}
              onClick={() => void inspectFluxPack()}
            >
              <File size={16} aria-hidden="true" />
              Inspect
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={!bridgeStatus?.ready || Boolean(operationOverlay?.isRunning)}
              onClick={() => void installFluxPack()}
            >
              <Download size={16} aria-hidden="true" />
              Install
            </button>
          </div>
          {fluxPackSummary ? (
            renderFluxPackSummary()
          ) : (
            <div className="empty-state empty-state--compact">
              <File size={18} aria-hidden="true" />
              <strong>No FluxPack summary</strong>
              <span>Export, inspect or install a package to show the latest summary.</span>
            </div>
          )}
        </section>
      </div>
    );
  };

  const rightPaneTabCount = (id: RightPaneId): string | null => {
    if (id === 'plugins') {
      return String(pluginCount);
    }

    if (id === 'downloads') {
      return String(downloadsWorkspace.items.length);
    }

    if (id === 'data') {
      return selectedModItem?.isMod ? String(selectedModItem.fileCount) : null;
    }

    return fluxPackSummary ? '1' : null;
  };

  const rightPaneSummary = (): string => {
    if (activeRightPane === 'plugins') {
      return `${enabledPluginCount} enabled · ${filteredPluginItems.length} visible`;
    }

    if (activeRightPane === 'downloads') {
      return `${downloadsWorkspace.items.length} files · ${filteredDownloadItems.length} visible`;
    }

    if (activeRightPane === 'data') {
      return selectedModItem?.isMod
        ? `${selectedModItem.fileCount} indexed files`
        : 'Project paths and selected mod files';
    }

    return fluxPackSummary ? 'FluxPack summary ready' : 'Paths, executable and FluxPack actions';
  };

  const renderPluginsRightPane = () => (
    <div
      className="right-pane-content right-pane-content--plugins"
      role="tabpanel"
      aria-label="Плагины"
    >
      <div className="right-pane-actionbar" aria-label="Plugin commands">
        <button
          className="icon-button"
          type="button"
          title="Refresh plugins"
          disabled={Boolean(pluginsBusyLabel)}
          onClick={() => void loadPluginsWorkspace(selectedProject)}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button
          className="tool-button"
          type="button"
          disabled={Boolean(pluginsBusyLabel) || !pluginCapabilities.loadOrderSupported}
          onClick={() => void createPluginSeparator()}
        >
          <Layers size={16} aria-hidden="true" />
          Separator
        </button>
      </div>
      <label className="pane-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={pluginsWorkspace.searchText}
          onChange={(event) => {
            dispatchPluginsWorkspace({
              type: 'search-changed',
              searchText: event.target.value
            });
            setPluginListScrollTop(0);
          }}
          placeholder="Search plugins"
          aria-label="Search plugins"
          disabled={!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported}
        />
      </label>
      {pluginsBusyLabel ? (
        <div className="mod-busy-strip" role="status">
          <RefreshCw size={15} aria-hidden="true" />
          <span>{pluginsBusyLabel}</span>
        </div>
      ) : null}
      {!pluginCapabilities.loadOrderSupported && pluginCapabilities.reason ? (
        <div className="mod-busy-strip" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{pluginCapabilities.reason}</span>
        </div>
      ) : null}
      {!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported ? (
        <div className="empty-state">
          <MoreHorizontal size={18} aria-hidden="true" />
          <strong>Plugins unavailable</strong>
          <span>{pluginCapabilities.reason}</span>
        </div>
      ) : (
        renderPluginRows()
      )}
      {renderRightPanePluginDetails()}
    </div>
  );

  const renderDownloadsRightPane = () => (
    <div
      className="right-pane-content right-pane-content--downloads"
      role="tabpanel"
      aria-label="Загрузки"
    >
      <div className="right-pane-actionbar" aria-label="Download commands">
        <button
          className="icon-button"
          type="button"
          title="Refresh downloads"
          disabled={Boolean(downloadsBusyLabel)}
          onClick={() => void loadDownloadsWorkspace(selectedProject)}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button
          className="tool-button"
          type="button"
          disabled={Boolean(downloadsBusyLabel)}
          onClick={() => void importDownloadArchive()}
        >
          <File size={16} aria-hidden="true" />
          Import
        </button>
        <button
          className="tool-button"
          type="button"
          disabled={Boolean(downloadsBusyLabel)}
          onClick={() => void installArchiveFromDialog()}
        >
          <Download size={16} aria-hidden="true" />
          Archive
        </button>
        <button
          className="tool-button"
          type="button"
          disabled={Boolean(downloadsBusyLabel)}
          onClick={() => void importInboundDownloads()}
        >
          <ExternalLink size={16} aria-hidden="true" />
          NXM
        </button>
      </div>
      <label className="pane-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={downloadsWorkspace.searchText}
          onChange={(event) => {
            dispatchDownloadsWorkspace({
              type: 'search-changed',
              searchText: event.target.value
            });
            setDownloadListScrollTop(0);
          }}
          placeholder="Search downloads"
          aria-label="Search downloads"
          disabled={!downloadCapabilities.bridgeAvailable}
        />
      </label>
      {downloadsBusyLabel ? (
        <div className="mod-busy-strip" role="status">
          <RefreshCw size={15} aria-hidden="true" />
          <span>{downloadsBusyLabel}</span>
        </div>
      ) : null}
      {!downloadCapabilities.bridgeAvailable ? (
        <div className="empty-state">
          <Download size={18} aria-hidden="true" />
          <strong>Downloads unavailable</strong>
          <span>{downloadCapabilities.reason}</span>
        </div>
      ) : (
        renderDownloadRows()
      )}
      {renderRightPaneDownloadDetails()}
    </div>
  );

  const renderRightPaneContent = () => {
    if (activeRightPane === 'plugins') {
      return renderPluginsRightPane();
    }

    if (activeRightPane === 'data') {
      return renderDataRightPane();
    }

    if (activeRightPane === 'downloads') {
      return renderDownloadsRightPane();
    }

    return renderBuildRightPane();
  };

  const renderInstallDialog = () => (
    <InstallDialog
      archiveTreeScrollTop={archiveTreeScrollTop}
      evaluation={installFomodEvaluation}
      existingModName={installExistingModName}
      installDialog={installDialog}
      modsDirectory={selectedProject?.paths?.modsDirectory}
      overrideCount={installPlacementOverrides.length}
      onArchiveTreeScrollTopChange={setArchiveTreeScrollTop}
      onClose={() => setInstallDialog(null)}
      onContinueFromFomod={() => void continueFromFomod()}
      onMoveFomodStep={(direction) => void moveInstallFomodStep(direction)}
      onPatch={setInstallDialogPatch}
      onSubmitInstallOptions={() => void submitInstallOptions()}
    />
  );
  const renderDownloadsWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>No build selected</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            Go home
          </button>
        </section>
      );
    }

    if (!downloadCapabilities.bridgeAvailable) {
      return (
        <section className="center-empty" aria-label="Downloads capability state">
          <Download size={22} aria-hidden="true" />
          <h2>Downloads unavailable</h2>
          <span>{downloadCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout downloads-layout" aria-label="Build downloads workspace">
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Downloads</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label="Download commands">
              <button
                className="icon-button"
                type="button"
                title="Refresh downloads"
                disabled={Boolean(downloadsBusyLabel)}
                onClick={() => void loadDownloadsWorkspace(selectedProject)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(downloadsBusyLabel)}
                onClick={() => void importDownloadArchive()}
              >
                <File size={16} aria-hidden="true" />
                Import
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(downloadsBusyLabel)}
                onClick={() => void installArchiveFromDialog()}
              >
                <Download size={16} aria-hidden="true" />
                Install archive
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(downloadsBusyLabel)}
                onClick={() => void importInboundDownloads()}
              >
                <ExternalLink size={16} aria-hidden="true" />
                NXM queue
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(downloadsBusyLabel)}
                onClick={() => void registerNxmProtocol()}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                Register NXM
              </button>
            </div>
          </div>
          {message ? (
            <div className="activity-banner" role="status">
              <CircleDot size={16} aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {downloadsBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{downloadsBusyLabel}</span>
            </div>
          ) : null}
          {renderDownloadRows()}
        </section>
        {renderDownloadsInspector()}
      </section>
    );
  };

  const renderProfileRows = () => {
    if (profilesWorkspace.loadState === 'loading') {
      return (
        <EmptyState
          icon={<RefreshCw size={18} aria-hidden="true" />}
          title="Loading profiles"
          description={selectedProject?.projectDirectory ?? 'Selected build'}
          tone="loading"
        />
      );
    }

    if (profilesWorkspace.loadState === 'error') {
      return (
        <EmptyState
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          title="Profiles unavailable"
          description={profilesWorkspace.errorMessage ?? 'The native core could not load profiles.'}
          tone="error"
        />
      );
    }

    if (filteredProfileItems.length === 0) {
      return (
        <EmptyState
          icon={<FolderOpen size={18} aria-hidden="true" />}
          title={profilesWorkspace.items.length === 0 ? 'No profiles yet' : 'No matching profiles'}
          description={
            profilesWorkspace.items.length === 0
              ? 'Create a profile to isolate mod and plugin order.'
              : 'Clear the search query to return to the profile list.'
          }
        />
      );
    }

    return (
      <div className="mod-table profile-table" role="table" aria-label="Profiles">
        <div className="mod-row profile-row mod-row--head" role="row">
          <span role="columnheader">Profile</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Actions</span>
        </div>
        <div className="mod-table__body">
          {filteredProfileItems.map((profileName) => {
            const isSelected = profileName === selectedProjectProfileName;
            const isDefault = isDefaultProfileName(profileName, selectedProjectDefaultProfileName);
            return (
              <div
                className="mod-row profile-row"
                role="row"
                data-selected={isSelected}
                key={profileName}
                onClick={() => {
                  dispatchProfilesWorkspace({ type: 'selected', name: profileName });
                  setProfileDraftName(profileName);
                  setProfileDeleteArmedName(null);
                }}
              >
                <div className="mod-row__main" role="cell">
                  <strong>{profileName}</strong>
                  <span>{isSelected ? 'Current workspace profile' : 'Available profile'}</span>
                </div>
                <span role="cell">{isDefault ? 'Default' : 'Custom'}</span>
                <span role="cell" data-status={isSelected ? 'ready' : 'checking'}>
                  {isSelected ? 'Selected' : 'Ready'}
                </span>
                <div className="row-actions mod-actions" role="cell">
                  <button
                    className="icon-button"
                    type="button"
                    title="Select profile"
                    disabled={isSelected || Boolean(profilesBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatchProfilesWorkspace({ type: 'selected', name: profileName });
                      setProfileDraftName(profileName);
                      setProfileDeleteArmedName(null);
                    }}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Clone selected profile"
                    disabled={!isSelected || Boolean(profilesBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void cloneProfile();
                    }}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title="Rename selected profile"
                    disabled={!isSelected || isDefault || Boolean(profilesBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void renameProfile();
                    }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title={
                      profileDeleteArmedName === profileName
                        ? 'Confirm profile deletion'
                        : 'Delete selected profile'
                    }
                    disabled={!isSelected || isDefault || Boolean(profilesBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteProfile();
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderProfilesInspector = () => (
    <aside className="inspector profiles-inspector" aria-label="Selected profile details">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">Selected profile</p>
          <h2>{selectedProjectProfileName}</h2>
        </div>
      </div>
      <div className="profile-editor">
        <label className="field">
          <span>Profile name</span>
          <input
            value={profileDraftName}
            disabled={Boolean(profilesBusyLabel)}
            onChange={(event) => {
              setProfileDraftName(event.target.value);
              setProfileDeleteArmedName(null);
            }}
          />
        </label>
        <div className="profile-editor__actions" aria-label="Profile edit commands">
          <button
            className="tool-button"
            type="button"
            disabled={Boolean(profilesBusyLabel)}
            onClick={() => void createProfile()}
          >
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
          <button
            className="tool-button"
            type="button"
            disabled={Boolean(profilesBusyLabel)}
            onClick={() => void cloneProfile()}
          >
            <Copy size={16} aria-hidden="true" />
            Clone
          </button>
          <button
            className="tool-button"
            type="button"
            disabled={
              isDefaultProfileName(selectedProjectProfileName, selectedProjectDefaultProfileName) ||
              Boolean(profilesBusyLabel)
            }
            onClick={() => void renameProfile()}
          >
            <Pencil size={16} aria-hidden="true" />
            Rename
          </button>
          <button
            className="tool-button"
            type="button"
            disabled={
              isDefaultProfileName(selectedProjectProfileName, selectedProjectDefaultProfileName) ||
              Boolean(profilesBusyLabel)
            }
            onClick={() => void deleteProfile()}
          >
            <Trash2 size={16} aria-hidden="true" />
            {profileDeleteArmedName === selectedProjectProfileName ? 'Confirm' : 'Delete'}
          </button>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>Profiles</dt>
          <dd>{profilesWorkspace.items.length}</dd>
        </div>
        <div>
          <dt>Visible</dt>
          <dd>{filteredProfileItems.length}</dd>
        </div>
        <div>
          <dt>Default</dt>
          <dd>{selectedProjectDefaultProfileName}</dd>
        </div>
        <div>
          <dt>Protection</dt>
          <dd>
            {isDefaultProfileName(selectedProjectProfileName, selectedProjectDefaultProfileName)
              ? 'rename/delete locked'
              : 'editable'}
          </dd>
        </div>
        <div>
          <dt>Mods/plugins</dt>
          <dd>profile-scoped</dd>
        </div>
      </dl>
      <div className="plugin-capability-panel">
        <strong>Profiles directory</strong>
        <span>{selectedProject?.paths?.profilesDirectory ?? 'Not reported by this build.'}</span>
      </div>
    </aside>
  );

  const renderProfilesWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>No build selected</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            Go home
          </button>
        </section>
      );
    }

    if (!profilesCapabilities.bridgeAvailable) {
      return (
        <section className="center-empty" aria-label="Profiles capability state">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>Profiles unavailable</h2>
          <span>{profilesCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout profiles-layout" aria-label="Build profiles workspace">
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Profiles</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label="Profile commands">
              <button
                className="icon-button"
                type="button"
                title="Refresh profiles"
                disabled={Boolean(profilesBusyLabel)}
                onClick={() => void loadProfilesWorkspace(selectedProject)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(profilesBusyLabel)}
                onClick={() => void createProfile()}
              >
                <Plus size={16} aria-hidden="true" />
                Profile
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(profilesBusyLabel)}
                onClick={() => void openProfilesDirectory()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                Folder
              </button>
            </div>
          </div>
          {message ? (
            <div className="activity-banner" role="status">
              <CircleDot size={16} aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {profilesBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{profilesBusyLabel}</span>
            </div>
          ) : null}
          {renderProfileRows()}
        </section>
        {renderProfilesInspector()}
      </section>
    );
  };

  const renderExecutableRows = () => {
    if (executablesWorkspace.loadState === 'loading') {
      return (
        <EmptyState
          icon={<RefreshCw size={18} aria-hidden="true" />}
          title="Loading executables"
          description={selectedProject?.configPath ?? 'Selected build'}
          tone="loading"
        />
      );
    }

    if (executablesWorkspace.loadState === 'error') {
      return (
        <EmptyState
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          title="Executables unavailable"
          description={
            executablesWorkspace.errorMessage ?? 'The native core could not load executables.'
          }
          tone="error"
        />
      );
    }

    if (filteredExecutableItems.length === 0) {
      return (
        <EmptyState
          icon={<Play size={18} aria-hidden="true" />}
          title={
            executablesWorkspace.items.length === 0 ? 'No executables yet' : 'No matching executables'
          }
          description={
            executablesWorkspace.items.length === 0
              ? 'Add the game executable or a tool to launch it from Fluxora.'
              : 'Clear the search query to return to the executable list.'
          }
        />
      );
    }

    return (
      <div className="mod-table executable-table" role="table" aria-label="Executables">
        <div className="mod-row executable-row mod-row--head" role="row">
          <span role="columnheader">Executable</span>
          <span role="columnheader">Path</span>
          <span role="columnheader">Arguments</span>
          <span role="columnheader">Working directory</span>
          <span role="columnheader">Actions</span>
        </div>
        <div className="mod-table__body">
          {filteredExecutableItems.map((entry) => {
            const isSelected = entry.id === executablesWorkspace.selectedId;
            return (
              <div
                className="mod-row executable-row"
                role="row"
                data-selected={isSelected}
                key={entry.id}
                onClick={() => {
                  dispatchExecutablesWorkspace({ type: 'selected', id: entry.id });
                  setExecutableDeleteArmedId(null);
                }}
              >
                <div className="mod-row__main" role="cell">
                  <strong>{executableTitle(entry)}</strong>
                  <span>{entry.id}</span>
                </div>
                <span role="cell">{shortPath(entry.executablePath)}</span>
                <span role="cell">{entry.arguments || '-'}</span>
                <span role="cell">{entry.workingDirectory ? shortPath(entry.workingDirectory) : 'executable folder'}</span>
                <div className="row-actions mod-actions" role="cell">
                  <button
                    className="icon-button"
                    type="button"
                    title="Launch executable"
                    disabled={
                      !isSelected ||
                      Boolean(executablesBusyLabel) ||
                      !executableCapabilities.launchAvailable
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      void launchExecutable();
                    }}
                  >
                    <Play size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title={
                      executableDeleteArmedId === entry.id
                        ? 'Confirm executable deletion'
                        : 'Delete executable'
                    }
                    disabled={!isSelected || Boolean(executablesBusyLabel)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteExecutable();
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderExecutablesInspector = () => (
    <aside className="inspector executables-inspector" aria-label="Selected executable details">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">Executable editor</p>
          <h2>{executableTitle(selectedExecutableItem)}</h2>
        </div>
      </div>
      {!executableDraft ? (
        <EmptyState
          className="empty-state--compact"
          compact
          icon={<Play size={18} aria-hidden="true" />}
          title="Select an executable"
          description="Add or select a row to edit launch details."
        />
      ) : (
        <div className="executable-editor">
          <label className="field">
            <span>Display name</span>
            <input
              value={executableDraft.displayName}
              onChange={(event) =>
                setExecutableDraft((current) =>
                  current ? { ...current, displayName: event.target.value } : current
                )
              }
            />
          </label>
          <label className="field">
            <span>Executable path</span>
            <div className="path-picker">
              <input
                value={executableDraft.executablePath}
                onChange={(event) =>
                  setExecutableDraft((current) =>
                    current ? { ...current, executablePath: event.target.value } : current
                  )
                }
              />
              <button
                className="tool-button"
                type="button"
                onClick={() => void browseExecutableForDraft()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                Browse
              </button>
            </div>
          </label>
          <label className="field">
            <span>Arguments</span>
            <input
              value={executableDraft.arguments}
              onChange={(event) =>
                setExecutableDraft((current) =>
                  current ? { ...current, arguments: event.target.value } : current
                )
              }
            />
          </label>
          <label className="field">
            <span>Working directory</span>
            <div className="path-picker">
              <input
                value={executableDraft.workingDirectory}
                onChange={(event) =>
                  setExecutableDraft((current) =>
                    current ? { ...current, workingDirectory: event.target.value } : current
                  )
                }
                placeholder="Executable folder"
              />
              <button
                className="tool-button"
                type="button"
                onClick={() => void browseExecutableWorkingDirectory()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                Browse
              </button>
            </div>
          </label>
          <div className="executable-editor__actions">
            <button
              className="tool-button"
              type="button"
              disabled={Boolean(executablesBusyLabel)}
              onClick={() => void resolveExecutableIcon()}
            >
              <CircleDot size={16} aria-hidden="true" />
              Icon
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(executablesBusyLabel)}
              onClick={() => void saveExecutableDraft()}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              Save
            </button>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Icon</dt>
              <dd>{executableDraft.iconPath ? shortPath(executableDraft.iconPath) : 'not resolved'}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{selectedProjectProfileName}</dd>
            </div>
            <div>
              <dt>Launch</dt>
              <dd>{executableCapabilities.launchAvailable ? 'available' : 'limited'}</dd>
            </div>
          </dl>
        </div>
      )}
      {!executableCapabilities.launchAvailable ? (
        <div className="plugin-capability-panel">
          <strong>Launch capability</strong>
          <span>{executableCapabilities.launchReason}</span>
        </div>
      ) : null}
      {executableLaunchResult ? (
        <div className="plugin-capability-panel">
          <strong>Last launch</strong>
          <span>
            {executableLaunchResult.processId
              ? `Process ${executableLaunchResult.processId}`
              : executableLaunchResult.launchTrackingKind}
          </span>
        </div>
      ) : null}
    </aside>
  );

  const renderExecutablesWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>No build selected</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            Go home
          </button>
        </section>
      );
    }

    if (!executableCapabilities.bridgeAvailable) {
      return (
        <section className="center-empty" aria-label="Executables capability state">
          <Play size={22} aria-hidden="true" />
          <h2>Executables unavailable</h2>
          <span>{executableCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout executables-layout" aria-label="Build executables workspace">
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Executables</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label="Executable commands">
              <button
                className="icon-button"
                type="button"
                title="Refresh executables"
                disabled={Boolean(executablesBusyLabel)}
                onClick={() => void loadExecutablesWorkspace(selectedProject)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(executablesBusyLabel)}
                onClick={() => void addExecutable()}
              >
                <Plus size={16} aria-hidden="true" />
                Executable
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={
                  !selectedExecutableItem ||
                  Boolean(executablesBusyLabel) ||
                  !executableCapabilities.launchAvailable
                }
                onClick={() => void launchExecutable()}
              >
                <Play size={16} aria-hidden="true" />
                Launch
              </button>
            </div>
          </div>
          {message ? (
            <div className="activity-banner" role="status">
              <CircleDot size={16} aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {executablesBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{executablesBusyLabel}</span>
            </div>
          ) : null}
          {renderExecutableRows()}
        </section>
        {renderExecutablesInspector()}
      </section>
    );
  };

  const renderBuildPathsInspector = () => (
    <BuildPathsInspector
      busyLabel={buildPathsBusyLabel}
      draft={buildPathDraft}
      error={buildPathsError}
      projectName={selectedProject?.name ?? 'Paths'}
      onBrowseDirectory={(title, field) => void browseBuildPathDirectory(title, field)}
      onBrowseGameExecutable={() => void browseBuildGameExecutable()}
      onChange={updateBuildPathDraft}
      onClose={() => setIsBuildPathsOpen(false)}
      onSave={() => void saveBuildPathSettings()}
    />
  );
  const renderFluxPackSummary = () => {
    if (!fluxPackSummary) {
      return null;
    }

    return (
      <div className="fluxpack-panel" aria-label="FluxPack summary">
        <div className="fluxpack-panel__header">
          <File size={17} aria-hidden="true" />
          <div>
            <strong>{fluxPackSummary.buildName || 'FluxPack'}</strong>
            <span>{fluxPackSummary.outputPath}</span>
          </div>
        </div>
        <dl className="settings-facts">
          {fluxPackSummaryFacts(fluxPackSummary).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {fluxPackInstallResult ? (
          <div
            className="settings-note"
            data-status={fluxPackInstallResult.hasWarnings ? 'checking' : 'ready'}
          >
            <strong>
              {fluxPackInstallResult.hasWarnings ? 'Installed with warnings' : 'Install complete'}
            </strong>
            <span>
              {fluxPackInstallResult.installedSourceCount} source(s) installed,{' '}
              {fluxPackInstallResult.appliedConfigCount} config(s) applied.
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderOperationOverlay = () => {
    return (
      <OperationOverlay
        cancellationSupported={operationCancellationSupported}
        onCancel={() => void cancelOperationOverlay()}
        onClose={() => setOperationOverlay(null)}
        overlay={operationOverlay}
      />
    );
  };

  const renderLaunchSplash = () => (
    <LoadingSplash
      appName={launchSplash?.appName}
      buildName={launchSplash?.buildName}
      detail={launchSplash?.detail}
      indeterminate
      open={Boolean(launchSplash)}
      state="starting"
      title={launchSplash ? `Launching ${launchSplash.appName}` : undefined}
    />
  );

  const renderTransferOperationPage = () => (
    <TransferMo2Page
      bridgeReady={Boolean(bridgeStatus?.ready)}
        transferAvailable={settingsCapabilities.transferAvailable}
        busyLabel={settingsBusyLabel}
        isRunning={isTransferRunning}
        cancellationSupported={transferCancellationSupported}
        cancelRequested={transferCancelRequested}
        sourceDirectory={transferSourceDirectory}
        destinationRootDirectory={transferDestinationRootDirectory}
        defaultDestinationRoot={selectedProject?.installRootDirectory || catalog.defaultInstallRootDirectory}
        selectedStep={transferStep}
      analysis={transferAnalysis}
      progress={transferProgress}
      error={transferError}
      result={transferResult}
        drives={transferDestinationDrives}
        driveState={transferDriveState}
        onSelectStep={setTransferStep}
        onBrowseSource={() => void browseTransferSource()}
      onSelectDestinationDrive={(drive) => void selectTransferDestinationDrive(drive)}
      onRefreshDrives={() => void loadTransferDestinationDrives()}
      onAnalyze={() => void analyzeMo2Transfer()}
      onStart={() => void startMo2Transfer()}
      onCancel={() => void cancelMo2Transfer()}
      onClose={() => {
        setIsTransferPageOpen(false);
        changeRoute('home');
      }}
      onOpenBuild={() => {
        setIsTransferPageOpen(false);
        changeRoute('build');
      }}
    />
  );

  const renderSettingsWorkspace = () => (
    <SettingsWorkspace
      bridgeStatus={bridgeStatus}
      cancelRequested={transferCancelRequested}
      cancellationSupported={transferCancellationSupported}
      isTransferRunning={isTransferRunning}
      languageBusy={languageBusy}
      message={message}
      nexusBusy={nexusBusy}
      nexusStatus={nexusStatus}
      section={settingsSection}
      settingsBusyLabel={settingsBusyLabel}
      settingsCapabilities={settingsCapabilities}
      transferAnalysis={transferAnalysis}
      transferError={transferError}
      transferProgress={transferProgress}
      transferResult={transferResult}
      onCancelTransfer={() => void cancelMo2Transfer()}
      onOpenTransfer={() => void openMo2TransferFromSettings()}
      onSectionChange={setSettingsSection}
      onSetLanguage={(language) => void setLanguage(language)}
      onToggleNexusConnection={() => void toggleNexusConnection()}
    />
  );
  const renderBuildWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>No build selected</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            Go home
          </button>
        </section>
      );
    }

    return (
      <section className="build-page" aria-label="Selected build">
        <BuildDetailHeader
          buildCapabilities={buildHeaderCapabilities}
          executables={executablesWorkspace.items}
          executablesBusyLabel={executablesBusyLabel}
          isOperationRunning={Boolean(operationOverlay?.isRunning)}
          launchAvailable={executableCapabilities.launchAvailable}
          launchReason={executableCapabilities.launchReason}
          onBack={() => changeRoute('home')}
          onExecutableChange={(id) =>
            dispatchExecutablesWorkspace({ type: 'selected', id })
          }
          onLaunch={() => void launchExecutable()}
          onPackage={() => void packageFluxPack()}
          onProfileChange={(profileName) => {
            dispatchProfilesWorkspace({ type: 'selected', name: profileName });
            setProfileDraftName(profileName);
            setProfileDeleteArmedName(null);
          }}
          onRefresh={() => void checkModUpdates()}
          onSettings={() => void openBuildPathSettings()}
          profileOptions={buildProfileOptions}
          profilesBusyLabel={profilesBusyLabel}
          project={selectedProject}
          refreshBusyLabel={modsBusyLabel}
          selectedExecutable={selectedExecutableItem}
          selectedProfileName={selectedProjectProfileName}
          settingsBusyLabel={buildPathsBusyLabel}
          stats={selectedProjectLibraryStats}
        />

        {message ? (
          <div className="activity-banner build-message" role="status">
            <CircleDot size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="build-workbench" aria-label="Mod Organizer style workspace">
          <section className="build-pane build-pane--mods" aria-label="Mods">
            <header className="build-pane__header build-pane__header--mods">
              <div>
                <h3>Моды</h3>
                <span>
                  {enabledModCount} of {totalModCount} enabled · {filteredModItems.length} visible
                </span>
              </div>
              <div className="build-pane__tools mods-pane-toolbar" aria-label="Mod commands">
                <button
                  className="icon-button"
                  type="button"
                  title="Refresh mods"
                  disabled={Boolean(modsBusyLabel)}
                  onClick={() => void loadModsWorkspace(selectedProject)}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Check updates"
                  disabled={Boolean(modsBusyLabel)}
                  onClick={() => void checkModUpdates()}
                >
                  <CircleDot size={16} aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Enable all mods"
                  disabled={Boolean(modsBusyLabel)}
                  onClick={() => void setAllModsEnabled(true)}
                >
                  <CheckCircle2 size={16} aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="Disable all mods"
                  disabled={Boolean(modsBusyLabel)}
                  onClick={() => void setAllModsEnabled(false)}
                >
                  <XCircle size={16} aria-hidden="true" />
                </button>
                <button
                  className="tool-button"
                  type="button"
                  disabled={Boolean(modsBusyLabel)}
                  onClick={() => void createModSeparator()}
                >
                  <Layers size={16} aria-hidden="true" />
                  Separator
                </button>
                <button
                  className="tool-button"
                  type="button"
                  disabled={Boolean(modsBusyLabel)}
                  onClick={() => void createEmptyMod()}
                >
                  <Plus size={16} aria-hidden="true" />
                  Empty mod
                </button>
              </div>
            </header>
            <label className="pane-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={modsWorkspace.searchText}
                onChange={(event) => {
                  dispatchModsWorkspace({
                    type: 'search-changed',
                    searchText: event.target.value
                  });
                  setModListScrollTop(0);
                }}
                placeholder="Search mods"
                aria-label="Search mods"
              />
            </label>
            {modsBusyLabel ? (
              <div className="mod-busy-strip" role="status">
                <RefreshCw size={15} aria-hidden="true" />
                <span>{modsBusyLabel}</span>
              </div>
            ) : null}
            {renderModRows()}
          </section>

          <section
            className={`build-pane build-pane--right build-pane--${activeRightPane}`}
            aria-label="Right pane"
          >
            <header className="build-pane__header build-pane__header--tabs">
              <div>
                <h3>{rightPaneTabs.find((tab) => tab.id === activeRightPane)?.label}</h3>
                <span>{rightPaneSummary()}</span>
              </div>

              <div className="right-pane-tabs" role="tablist" aria-label="Right pane tabs">
                {rightPaneTabs.map(({ id, label, icon: Icon }) => {
                  const count = rightPaneTabCount(id);

                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeRightPane === id}
                      data-active={activeRightPane === id}
                      key={id}
                      onClick={() => setActiveRightPane(id)}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span>{label}</span>
                      {count ? <strong>{count}</strong> : null}
                    </button>
                  );
                })}
              </div>
            </header>

            {renderRightPaneContent()}
          </section>
        </section>

        {isBuildPathsOpen ? <div className="build-drawer">{renderBuildPathsInspector()}</div> : null}
      </section>
    );
  };

  const renderPlaceholder = () => (
    <section className="center-empty">
      <Layers size={22} aria-hidden="true" />
      <h2>{activeLabel}</h2>
      <span>{selectedProject?.name ?? 'Open a build first'}</span>
    </section>
  );

  const renderTitlebar = (showSettingsButton: boolean) => (
    <AppTitlebar
      homeActive={activeRoute === 'home' && !isTransferPageOpen}
      mode={isSettingsWindow ? 'settings' : 'main'}
      settingsActive={isSettingsWindow}
      showShortcuts={showSettingsButton}
      onClose={() => void closeWindow()}
      onHome={() => changeRoute('home')}
      onMinimize={() => void minimizeWindow()}
      onOpenSettings={() => void openSettingsWindow()}
      onToggleMaximize={() => void toggleMaximizeWindow()}
    />
  );

  if (import.meta.env.DEV && window.location.hash === '#design-system') {
    return (
      <main className="desktop-shell">
        {renderTitlebar(false)}
        <PrimitivePreview />
      </main>
    );
  }

  if (isSettingsWindow) {
    return (
      <main className="desktop-shell desktop-shell--settings-window">
        {renderTitlebar(false)}
        <section className="settings-window">
          {renderSettingsWorkspace()}
        </section>
      </main>
    );
  }

  return (
    <main className="desktop-shell">
      {renderTitlebar(true)}

        <section className="workspace workspace--full">
          <div className="content-area">
            {isTransferPageOpen ? (
              renderTransferOperationPage()
            ) : (
              <>
                {busyLabel ? (
                  <div className="busy-overlay" role="status">
                    <Maximize2 size={18} aria-hidden="true" />
                    <strong>{busyLabel}</strong>
                  </div>
                ) : null}
                {isCreateOpen ? <section className="create-flow">{renderCreateWizard()}</section> : null}
                {!isCreateOpen && activeRoute === 'home' ? renderHome() : null}
                {!isCreateOpen && (activeRoute === 'build' || activeRoute === 'workspace')
                  ? renderBuildWorkspace()
                  : null}
                {!isCreateOpen && activeRoute === 'mods' ? renderModsWorkspace() : null}
                {!isCreateOpen && activeRoute === 'plugins' ? renderPluginsWorkspace() : null}
                {!isCreateOpen && activeRoute === 'downloads' ? renderDownloadsWorkspace() : null}
                {!isCreateOpen && activeRoute === 'profiles' ? renderProfilesWorkspace() : null}
                {!isCreateOpen && activeRoute === 'executables' ? renderExecutablesWorkspace() : null}
                {!isCreateOpen && activeRoute === 'settings' ? renderSettingsWorkspace() : null}
                {activeRoute !== 'home' &&
                activeRoute !== 'build' &&
                activeRoute !== 'workspace' &&
                activeRoute !== 'mods' &&
                activeRoute !== 'plugins' &&
                activeRoute !== 'downloads' &&
                activeRoute !== 'profiles' &&
                activeRoute !== 'executables' &&
                activeRoute !== 'settings' &&
                !isCreateOpen
                  ? renderPlaceholder()
                  : null}
                {renderInstallDialog()}
                {renderOperationOverlay()}
                {renderLaunchSplash()}
              </>
            )}
          </div>
        </section>
    </main>
  );
};
