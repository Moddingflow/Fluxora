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
  Globe2,
  Home,
  Layers,
  Languages,
  Link2,
  Maximize2,
  Minus,
  MoreHorizontal,
  Moon,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  UploadCloud,
  X,
  XCircle
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import fluxoraLogo from './assets/brand/Fluxora.png';
import nexusModsIcon from './assets/images/nexus-mods.svg';
import skyrimIcon from './assets/images/SkyrimSpecialEditionIcon.png';
import {
  emptyProjectDraft,
  filterProjects,
  filterTemplates,
  isProjectDraftStepComplete,
  projectCapabilitiesLabel,
  projectDisplayPath,
  type ProjectDraft
} from './project-catalog-state';
import {
  bridgeStatusLabel,
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
  modOverwriteView,
  modStatusText,
  modWorkspaceReducer,
  selectedModOrderItem,
  targetIndexForDrop,
  targetIndexForMove
} from './mod-workspace-state';
import {
  emptyPluginWorkspaceState,
  filterPluginOrderItems,
  pluginCapabilityView,
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
  languageOptions,
  normalizeThemeMode,
  selectPreferredTransferDrive,
  settingsCapabilityView,
  settingsSections,
  themeOptions,
  type SettingsSectionId
} from './settings-workspace-state';
import {
  TransferSettingsPanel,
  type TransferMode,
  type TransferStepId
} from './TransferSettingsPanel';
import {
  TransferMo2Page,
  type TransferDriveListState
} from './TransferMo2Page';
import {
  buildPathSaveRequest,
  buildPrimaryExecutableList,
  directoryFromExecutablePath,
  draftFromBuildPathSettings,
  emptyBuildPathDraft,
  fluxPackSummaryFacts,
  validateBuildPathDraft,
  type BuildPathDraft
} from './build-workspace-state';
import {
  buildArchivePlacementRows,
  buildPlacementPreviewLines,
  buildPlacementSummaryText,
  createPlacementOverrideForDrop,
  createPlacementOverrides,
  currentFomodStepValidation,
  defaultInstallModName,
  evaluateFomodWizard,
  fileNameFromPath,
  findExistingInstalledModName,
  initialFomodSelection,
  normalizeInstallModName,
  previousFomodSelection,
  toggleFomodOption,
  validateInstallModName,
  type InstallSource,
  type PlacementOverrideMap
} from './install-workspace-state';
import { defaultModNameFromPath, shortPath } from './services/path-display-service';
import { createRendererOperationId, errorMessage } from './services/renderer-operation-service';
import { createVirtualWindow } from './ui-performance';
import type {
  FluxoraAppInfo,
  FluxoraContentLayoutPreview,
  FluxoraDownloadEntry,
  FluxoraExecutable,
  FluxoraExecutableLaunchResult,
  FluxoraExistingModInstallMode,
  FluxoraFomodInstaller,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackSummary,
  FluxoraGameTemplate,
  FluxoraInstalledMod,
  FluxoraInstalledModSummary,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraModOrganizerImportRequest,
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

type CatalogState = 'idle' | 'loading' | 'ready' | 'blocked' | 'error';

type InstallDialogPhase = 'analyzing' | 'fomod' | 'options' | 'details' | 'installing' | 'error';

interface InstallDialogState {
  phase: InstallDialogPhase;
  source: InstallSource;
  operationId: string;
  isFomod: boolean;
  fomodInstaller: FluxoraFomodInstaller | null;
  selectedFomodOptionIds: string[];
  fomodStepIndex: number;
  layoutPreview: FluxoraContentLayoutPreview | null;
  modName: string;
  existingModMode: FluxoraExistingModInstallMode;
  placementOverrides: PlacementOverrideMap;
  draggedSourcePath: string | null;
  validationMessage: string | null;
  errorMessage: string | null;
}

interface OperationOverlayState {
  operationId: string;
  kind: 'build-create' | 'build-delete' | 'fluxpack-export' | 'fluxpack-install';
  title: string;
  statusText: string;
  currentItem: string;
  percent: number | null;
  isRunning: boolean;
  canClose: boolean;
  resultText: string | null;
  errorText: string | null;
}

interface StartMo2TransferOptions {
  mode?: TransferMode;
  existingConfigPath?: string;
  analysis?: FluxoraModOrganizerImportAnalysis | null;
  skipMainHandoff?: boolean;
  skipReplaceConfirm?: boolean;
}

type RightPaneId = 'plugins' | 'downloads';

interface ProjectRuntimeSummary {
  modCount?: number;
  disabledModCount?: number;
  enabledPluginCount?: number;
  pluginCount?: number;
  downloadsCount?: number;
}

interface ProjectLibraryStats {
  lastLaunch: string;
  size: string;
  mods: string;
  disabledMods: string;
  plugins: string;
  downloads: string;
}

interface ProjectStatItem {
  label: string;
  value: string;
}

const unknownProjectStatValues = new Set(['-', 'Not tracked']);

const hasProjectStatValue = (value: string): boolean =>
  value.trim().length > 0 && !unknownProjectStatValues.has(value);

const projectSummaryFacts = (stats: ProjectLibraryStats): ProjectStatItem[] =>
  [
    { label: 'Last launch', value: stats.lastLaunch },
    { label: 'Build size', value: stats.size },
    { label: 'Mods', value: stats.mods },
    { label: 'Disabled mods', value: stats.disabledMods },
    { label: 'Plugins', value: stats.plugins },
    { label: 'Downloads', value: stats.downloads }
  ].filter((item) => hasProjectStatValue(item.value));

const projectRowStats = (stats: ProjectLibraryStats): ProjectStatItem[] =>
  [
    { label: 'mods', value: stats.mods },
    { label: 'plugins', value: stats.plugins },
    { label: 'downloads', value: stats.downloads },
    { label: 'last launch', value: stats.lastLaunch }
  ].filter((item) => hasProjectStatValue(item.value));

const projectMetricKeys = {
  lastLaunch: ['lastLaunchedAt', 'lastLaunchAt', 'lastRunAt', 'lastOpenedAt', 'lastOpened'],
  size: ['sizeBytes', 'totalBytes', 'projectSizeBytes', 'installSizeBytes', 'diskSizeBytes'],
  mods: ['modCount', 'modsCount', 'installedModCount', 'totalMods'],
  disabledMods: ['disabledModCount', 'disabledMods', 'inactiveModCount'],
  plugins: ['pluginCount', 'pluginsCount', 'totalPlugins'],
  enabledPlugins: ['enabledPluginCount', 'enabledPlugins', 'activePluginCount'],
  downloads: ['downloadCount', 'downloadsCount', 'queuedDownloadCount']
} as const;

const isMetricRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const projectMetricSources = (project: FluxoraProject): Array<Record<string, unknown>> =>
  [project.projectFingerprint, project.gameHealthSummary, project.contentLayoutSummary].filter(
    isMetricRecord
  );

const readNumberMetric = (
  project: FluxoraProject,
  keys: readonly string[]
): number | null => {
  for (const source of projectMetricSources(project)) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value);
      }

      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return Math.max(0, parsed);
        }
      }
    }
  }

  return null;
};

const readTextMetric = (
  project: FluxoraProject,
  keys: readonly string[]
): string | null => {
  for (const source of projectMetricSources(project)) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
};

const formatOptionalCount = (value: number | null | undefined): string =>
  Number.isFinite(value) ? String(value) : '-';

const formatProjectBytes = (value: number | null): string => {
  if (!value || value <= 0) {
    return '-';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const kilobytes = value / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 10 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) {
    return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  }

  const gigabytes = megabytes / 1024;
  return `${gigabytes.toFixed(gigabytes >= 10 ? 1 : 2)} GB`;
};

const formatProjectDate = (value: string | null): string => {
  if (!value) {
    return 'Not tracked';
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10000000000 ? numeric * 1000 : numeric)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

const buildProjectLibraryStats = (
  project: FluxoraProject,
  runtime?: ProjectRuntimeSummary
): ProjectLibraryStats => {
  const enabledPlugins =
    runtime?.enabledPluginCount ?? readNumberMetric(project, projectMetricKeys.enabledPlugins);
  const pluginCount = runtime?.pluginCount ?? readNumberMetric(project, projectMetricKeys.plugins);

  return {
    lastLaunch: formatProjectDate(readTextMetric(project, projectMetricKeys.lastLaunch)),
    size: formatProjectBytes(readNumberMetric(project, projectMetricKeys.size)),
    mods: formatOptionalCount(runtime?.modCount ?? readNumberMetric(project, projectMetricKeys.mods)),
    disabledMods: formatOptionalCount(
      runtime?.disabledModCount ?? readNumberMetric(project, projectMetricKeys.disabledMods)
    ),
    plugins:
      enabledPlugins !== null && enabledPlugins !== undefined && pluginCount !== null && pluginCount !== undefined
        ? `${enabledPlugins}/${pluginCount}`
        : formatOptionalCount(pluginCount),
    downloads: formatOptionalCount(
      runtime?.downloadsCount ?? readNumberMetric(project, projectMetricKeys.downloads)
    )
  };
};

const navItems: Array<{ id: RouteId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'build', label: 'Build', icon: Layers }
];

const wizardSteps = ['Name', 'Game', 'Executable', 'Location'];
const modRowHeight = 48;
const modVisibleRows = 28;
const modOverscanRows = 8;
const pluginRowHeight = 48;
const pluginVisibleRows = 28;
const pluginOverscanRows = 8;
const downloadRowHeight = 48;
const downloadVisibleRows = 28;
const downloadOverscanRows = 8;
const archiveTreeRowHeight = 32;
const archiveTreeVisibleRows = 32;
const archiveTreeOverscanRows = 10;

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
  const [catalogState, setCatalogState] = useState<CatalogState>('idle');
  const [searchText, setSearchText] = useState('');
  const [templateSearchText, setTemplateSearchText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [languageBusy, setLanguageBusy] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<FluxoraThemeMode>('dark');
  const [themeBusy, setThemeBusy] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('connections');
  const [settingsBusyLabel, setSettingsBusyLabel] = useState<string | null>(null);
  const [nexusStatus, setNexusStatus] = useState<FluxoraNexusModsAuthStatus | null>(null);
  const [nexusBusy, setNexusBusy] = useState(false);
  const [transferSourceDirectory, setTransferSourceDirectory] = useState('');
  const [transferDestinationRootDirectory, setTransferDestinationRootDirectory] = useState('');
  const [transferMode, setTransferMode] = useState<TransferMode>('create');
  const [transferStep, setTransferStep] = useState<TransferStepId>('source');
  const [transferDestinationDrives, setTransferDestinationDrives] = useState<FluxoraTransferDriveOption[]>([]);
  const [transferDriveState, setTransferDriveState] = useState<TransferDriveListState>('idle');
  const [transferAnalysis, setTransferAnalysis] =
    useState<FluxoraModOrganizerImportAnalysis | null>(null);
  const [transferProgress, setTransferProgress] =
    useState<FluxoraModOrganizerImportProgress | null>(null);
  const [transferRunningOperationId, setTransferRunningOperationId] = useState<string | null>(null);
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
  const [isTransferPageOpen, setIsTransferPageOpen] = useState(false);

  const selectedProject = useMemo(
    () =>
      projects.find(
        (project) =>
          project.id === selectedProjectId ||
          project.configPath === selectedProjectId ||
          project.projectDirectory === selectedProjectId
      ) ?? projects[0] ?? null,
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

  const settingsCapabilities = useMemo(
    () => settingsCapabilityView(bridgeStatus),
    [bridgeStatus]
  );

  const isTransferRunning = transferRunningOperationId !== null;
  const operationCancellationSupported =
    bridgeStatus?.capabilities?.features.operationCancellation?.state === 'available';

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

        return nextCatalog.projects[0]?.id ?? null;
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
    if (!transferRunningOperationId) {
      return;
    }

    return window.fluxora.operations.onProgress((progress) => {
      if (progress.operationId === transferRunningOperationId) {
        setTransferProgress(progress);
      }
    });
  }, [transferRunningOperationId]);

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
    if (isTransferRunning && route !== 'settings') {
      setMessage('MO2 import is running. Wait for the transfer to finish before leaving Settings.');
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
    state: Omit<OperationOverlayState, 'isRunning' | 'canClose' | 'resultText' | 'errorText'>
  ) => {
    setOperationOverlay({
      ...state,
      isRunning: true,
      canClose: false,
      resultText: null,
      errorText: null
    });
  };

  const finishOperationOverlay = (
    operationId: string,
    resultText: string,
    percent = 100
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

  const cancelOperationOverlay = async () => {
    if (!operationOverlay?.isRunning || !operationCancellationSupported) {
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
      setMessage(`${wizardSteps[createStep]} is required.`);
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
      setProjects((current) => upsertProject(current, created));
      setSelectedProjectId(created.id);
      setIsCreateOpen(false);
      changeRoute('build');
      setMessage(`Created ${created.name}`);
      finishOperationOverlay(operationId, `Created ${created.name}`);
    } catch (error) {
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

  const setTheme = async (theme: FluxoraThemeMode) => {
    const operationId = createRendererOperationId('theme_set');
    setThemeBusy(true);
    setMessage(null);

    try {
      const result = await window.fluxora.settings.setTheme(theme, { operationId });
      setThemeMode(result.theme);
      setBridgeStatus((current) =>
        current
          ? {
              ...current,
              theme: result.theme,
              operationId
            }
          : current
      );
      setMessage(`Theme saved: ${result.theme}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setThemeBusy(false);
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
      const [nextStatus, nextTheme, nextNexusStatus] = await Promise.all([
        window.fluxora.bridge.getStatus({ operationId }),
        window.fluxora.settings.getTheme({ operationId }),
        window.fluxora.nexus.getAuthStatus({ operationId })
      ]);
      const nextThemeMode = normalizeThemeMode(nextTheme.theme ?? nextStatus.theme);
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

  const refreshNexusStatus = async () => {
    const operationId = createRendererOperationId('nexus_status');
    setNexusBusy(true);
    setMessage(null);

    try {
      const status = await window.fluxora.nexus.getAuthStatus({ operationId });
      setNexusStatus(status);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setNexusBusy(false);
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
    setTransferStep(transferSourceDirectory.trim() ? 'destination' : 'source');
    void loadTransferDestinationDrives();
  };

  const openMo2TransferFromSettings = async () => {
    if (isSettingsWindow) {
      try {
        await window.fluxora.transfer.openMo2InMain();
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
      setTransferStep(destinationRootDirectory ? 'review' : 'destination');
      if (destinationRootDirectory) {
        await analyzeMo2Transfer(path, destinationRootDirectory);
      }
    }
  };

  const selectTransferDestinationDrive = async (drive: FluxoraTransferDriveOption) => {
    const sourceDirectory = transferSourceDirectory.trim();
    setTransferDestinationRootDirectory(drive.rootPath);
    resetTransferPlanningState();
    setTransferStep(sourceDirectory ? 'review' : 'source');
    if (sourceDirectory) {
      await analyzeMo2Transfer(sourceDirectory, drive.rootPath);
    }
  };

  const existingTransferConfigPath = (): string =>
    transferMode === 'replace' ? selectedProject?.configPath ?? '' : '';

  const analyzeMo2Transfer = async (
    rawSourceDirectory = transferSourceDirectory,
    rawDestinationRootDirectory = transferDestinationRootDirectory,
    rawExistingConfigPath = existingTransferConfigPath()
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
    setTransferStep('review');

    try {
      const analysis = await window.fluxora.transfer.analyzeMo2(
        sourceDirectory,
        destinationRootDirectory,
        rawExistingConfigPath,
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

    const mode: TransferMode = handoff.request.replaceExisting ? 'replace' : 'create';
    setTransferSourceDirectory(handoff.request.sourceDirectory);
    setTransferDestinationRootDirectory(handoff.request.destinationRootDirectory);
    setTransferMode(mode);
    setTransferAnalysis(handoff.analysis ?? null);
    setTransferError(null);
    setTransferResult(null);
    setTransferProgress(null);
    setTransferStep('review');
    setIsCreateOpen(false);
    setIsTransferPageOpen(true);
    setActiveRoute('home');

    await startMo2Transfer(handoff.request.sourceDirectory, handoff.request.destinationRootDirectory, {
      mode,
      existingConfigPath: handoff.request.existingConfigPath ?? '',
      analysis: handoff.analysis ?? null,
      skipMainHandoff: true,
      skipReplaceConfirm: true
    });
  };

  const startMo2Transfer = async (
    rawSourceDirectory = transferSourceDirectory,
    rawDestinationRootDirectory = transferDestinationRootDirectory,
    options: StartMo2TransferOptions = {}
  ) => {
    const sourceDirectory = rawSourceDirectory.trim();
    const destinationRootDirectory = rawDestinationRootDirectory.trim();
    const effectiveMode = options.mode ?? transferMode;
    const effectiveExistingConfigPath =
      options.existingConfigPath ?? (effectiveMode === 'replace' ? selectedProject?.configPath ?? '' : '');
    const canReuseAnalysis =
      sourceDirectory === transferSourceDirectory.trim() &&
      destinationRootDirectory === transferDestinationRootDirectory.trim();
    const analysis =
      options.analysis ??
      (canReuseAnalysis && transferAnalysis
        ? transferAnalysis
        : await analyzeMo2Transfer(sourceDirectory, destinationRootDirectory, effectiveExistingConfigPath));
    if (!analysis) {
      return;
    }

    if (!analysis.canImport || !analysis.hasEnoughSpace) {
      setTransferError(analysis.warningMessage || analysis.statusMessage || 'Перенос пока недоступен.');
      return;
    }

    if (effectiveMode === 'replace' && !effectiveExistingConfigPath) {
      setTransferError('Выберите сборку, прежде чем заменять ее переносом MO2.');
      return;
    }

    if (
      effectiveMode === 'replace' &&
      !options.skipReplaceConfirm &&
      !window.confirm('Заменить выбранную сборку Fluxora копией, импортированной из Mod Organizer 2?')
    ) {
      return;
    }

    const importRequest: FluxoraModOrganizerImportRequest = {
      sourceDirectory,
      destinationRootDirectory,
      existingConfigPath: effectiveExistingConfigPath || undefined,
      replaceExisting: effectiveMode === 'replace'
    };

    if (isSettingsWindow && !options.skipMainHandoff) {
      try {
        await window.fluxora.transfer.startMo2InMain({
          request: importRequest,
          analysis
        });
      } catch (error) {
        const nextMessage = errorMessage(error);
        setTransferError(nextMessage);
        setMessage(nextMessage);
      }
      return;
    }

    const operationId = createRendererOperationId('transfer_import_mo2');
    setIsTransferPageOpen(true);
    setIsCreateOpen(false);
    setTransferMode(effectiveMode);
    setTransferSourceDirectory(sourceDirectory);
    setTransferDestinationRootDirectory(destinationRootDirectory);
    setTransferAnalysis(analysis);
    setTransferRunningOperationId(operationId);
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
    setTransferStep('review');

    try {
      const imported = await window.fluxora.transfer.importMo2(
        {
          sourceDirectory,
          destinationRootDirectory,
          existingConfigPath: effectiveExistingConfigPath,
          replaceExisting: effectiveMode === 'replace'
        },
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
      setTransferError(nextMessage);
      setMessage(nextMessage);
    } finally {
      setTransferRunningOperationId(null);
      setSettingsBusyLabel(null);
    }
  };

  const cancelMo2Transfer = async () => {
    if (!transferRunningOperationId) {
      return;
    }

    const operationId = createRendererOperationId('transfer_cancel');
    try {
      const result = await window.fluxora.operations.cancel(transferRunningOperationId, { operationId });
      setMessage(
        result.accepted
          ? 'Запрос отмены переноса отправлен.'
          : 'Текущая native-сборка не поддерживает отмену этого переноса.'
      );
      if (!result.accepted) {
        setTransferError('Отмена недоступна в текущем bridge, перенос будет заблокирован до безопасного завершения.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const renderProjectRows = () => {
    if (catalogState === 'loading') {
      return (
        <div className="library-empty-state" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <strong>Loading builds</strong>
          <span>{catalog.buildConfigsDirectory || 'Fluxora catalog'}</span>
        </div>
      );
    }

    if (catalogState === 'blocked') {
      return (
        <div className="library-empty-state" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>Core unavailable</strong>
          <span>{bridgeStatus?.error?.message ?? 'Build the native bridge host first.'}</span>
        </div>
      );
    }

    if (filteredProjects.length === 0) {
      return (
        <div className="library-empty-state">
          <FolderOpen size={18} aria-hidden="true" />
          <strong>{projects.length === 0 ? 'No builds yet' : 'No matching builds'}</strong>
          <span>{catalog.buildConfigsDirectory || 'Create or open a Fluxora build.'}</span>
        </div>
      );
    }

    return (
      <div className="library-build-list" role="listbox" aria-label="Fluxora builds">
        {filteredProjects.map((project) => {
          const isSelected = selectedProject?.id === project.id;
          const gameLabel = project.gameName || project.templateId || 'Fluxora build';
          const icon = /skyrim/i.test(gameLabel) ? skyrimIcon : fluxoraLogo;
          const stats = buildProjectLibraryStats(
            project,
            isSelected ? selectedProjectRuntimeSummary : undefined
          );
          const rowStats = projectRowStats(stats);
          return (
            <div
              className="project-row project-row--library"
              data-selected={isSelected}
              key={project.id}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => {
                setSelectedProjectId(project.id);
                setProjectMenuId(null);
              }}
              onDoubleClick={() => void openProjectByConfig(project.configPath)}
              onKeyDown={(event) => {
                if (event.currentTarget !== event.target) {
                  return;
                }

                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedProjectId(project.id);
                  setProjectMenuId(null);
                }

                if (event.key === 'Escape') {
                  setProjectMenuId(null);
                }
              }}
            >
              <button
                className="library-build-open"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedProjectId(project.id);
                  setProjectMenuId(null);
                  void openProjectByConfig(project.configPath);
                }}
              >
                <Play size={15} aria-hidden="true" />
                Open
              </button>
              <div className="library-build-row">
                <img className="project-row__icon" src={icon} alt="" />
                <span className="project-row__main">
                  <strong>{project.name}</strong>
                  <span>{gameLabel}</span>
                  <small title={projectDisplayPath(project)}>
                    {shortPath(projectDisplayPath(project))}
                  </small>
                  {rowStats.length > 0 ? (
                    <span className="project-row__meta-chips" aria-label={`${project.name} available stats`}>
                      {rowStats.map((item) => (
                        <span key={item.label}>
                          <strong>{item.value}</strong>
                          {item.label}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </div>
              <div
                className="row-actions library-build-actions"
                aria-label={`${project.name} actions`}
                data-menu-open={projectMenuId === project.id}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setProjectMenuId(null);
                  }
                }}
              >
                <button
                  className="library-build-more"
                  type="button"
                  title="More build actions"
                  aria-label={`${project.name} actions`}
                  aria-haspopup="menu"
                  aria-expanded={projectMenuId === project.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedProjectId(project.id);
                    setProjectMenuId((current) => (current === project.id ? null : project.id));
                  }}
                >
                  <MoreHorizontal size={17} aria-hidden="true" />
                </button>
                {projectMenuId === project.id ? (
                  <div
                    className="mod-row-menu project-row-menu"
                    role="menu"
                    aria-label={`${project.name} build actions`}
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
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCreateWizard = () => (
    <aside className="inspector" aria-label="Create build">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">New build</p>
          <h2>{wizardSteps[createStep]}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Close"
          onClick={() => setIsCreateOpen(false)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="stepper" aria-label="Build creation steps">
        {wizardSteps.map((step, index) => (
          <span key={step} data-active={index === createStep} data-complete={index < createStep}>
            {index + 1}
          </span>
        ))}
      </div>

      <div className="wizard-body">
        {createStep === 0 ? (
          <label className="field">
            <span>Build name</span>
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
            <label className="field">
              <span>Game search</span>
              <input
                value={templateSearchText}
                onChange={(event) => setTemplateSearchText(event.target.value)}
                placeholder="Skyrim, Fallout..."
              />
            </label>
            <div className="template-list">
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
          <label className="field">
            <span>Game executable</span>
            <div className="path-picker">
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
            <label className="field">
              <span>Install root</span>
              <div className="path-picker">
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
            <div className="directory-preview" data-loading={previewBusy}>
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
          disabled={createStep === 0}
          onClick={() => setCreateStep((current) => Math.max(current - 1, 0))}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Back
        </button>
        {createStep < wizardSteps.length - 1 ? (
          <button className="primary-button" type="button" onClick={advanceCreateStep}>
            Next
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busyLabel) || !selectedTemplate}
            onClick={() => void createProject()}
          >
            Create
          </button>
        )}
      </div>
    </aside>
  );

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
    const selectedGameLabel = selectedProject
      ? selectedProject.gameName || selectedProject.templateId || 'Fluxora build'
      : 'No game selected';
    const selectedIcon = selectedProject && /skyrim/i.test(selectedGameLabel) ? skyrimIcon : fluxoraLogo;

    return (
      <section className="library-page" aria-label="Build library">
        <header className="library-page__header">
          <div>
            <h1>Build library</h1>
          </div>
          <div className="library-page__actions">
            <label className="library-search">
              <Search size={14} aria-hidden="true" />
              <input
                aria-label="Search builds"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search builds"
              />
            </label>
            <button
              type="button"
              className="icon-button"
              title="Refresh builds"
              disabled={!bridgeStatus?.ready || isTransferRunning}
              onClick={() => void loadCatalog()}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="tool-button"
              disabled={!bridgeStatus?.ready || isTransferRunning}
              onClick={() => void openProjectFromDialog()}
            >
              <FolderOpen size={16} aria-hidden="true" />
              Open
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!bridgeStatus?.ready || isTransferRunning}
              onClick={startCreate}
            >
              <Plus size={16} aria-hidden="true" />
              New build
            </button>
          </div>
        </header>

        {message ? (
          <div className="activity-banner library-message" role="status">
            <CircleDot size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}

        <section className="library-page__body">
          <section className="library-home-panel" aria-label="Builds">
            <div className="library-panel-title">
              <div>
                <p className="eyebrow">Library</p>
                <h2>{projects.length} builds</h2>
              </div>
            </div>
            <div className="library-list" aria-label="Builds">
              {renderProjectRows()}
            </div>
          </section>

          <aside className="library-detail-panel" aria-label="Selected build summary">
            {selectedProject && selectedProjectLibraryStats ? (
              <>
                <div className="library-detail-hero">
                  <img src={selectedIcon} alt="" />
                  <div>
                    <p className="eyebrow">Selected build</p>
                    <h2>{selectedProject.name}</h2>
                    <span>{selectedGameLabel}</span>
                    <small title={projectDisplayPath(selectedProject)}>
                      {shortPath(projectDisplayPath(selectedProject))}
                    </small>
                  </div>
                </div>
                <dl className="library-detail-metrics">
                  <div>
                    <dt>Game</dt>
                    <dd>{selectedGameLabel}</dd>
                  </div>
                  {projectSummaryFacts(selectedProjectLibraryStats).map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="library-detail-paths">
                  <div>
                    <span>Project folder</span>
                    <strong title={selectedProject.projectDirectory}>
                      {shortPath(selectedProject.projectDirectory)}
                    </strong>
                  </div>
                  <div>
                    <span>Config</span>
                    <strong title={selectedProject.configPath}>{shortPath(selectedProject.configPath)}</strong>
                  </div>
                </div>
                <div className="library-detail-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!bridgeStatus?.ready || isTransferRunning}
                    onClick={() => void openSelectedProject()}
                  >
                    <Play size={16} aria-hidden="true" />
                    Open
                  </button>
                  <button
                    type="button"
                    className="tool-button"
                    onClick={() => void openProjectDirectory(selectedProject)}
                  >
                    <FolderOpen size={16} aria-hidden="true" />
                    Folder
                  </button>
                </div>
              </>
            ) : (
              <div className="library-empty-state">
                <FolderOpen size={18} aria-hidden="true" />
                <strong>No build selected</strong>
                <span>Create or open a Fluxora build to fill the library.</span>
              </div>
            )}
          </aside>
        </section>
      </section>
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
        <div className="empty-state" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <strong>Loading mods</strong>
          <span>{selectedProject?.projectDirectory ?? 'Selected build'}</span>
        </div>
      );
    }

    if (modsWorkspace.loadState === 'error') {
      return (
        <div className="empty-state" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>Mods unavailable</strong>
          <span>{modsWorkspace.errorMessage ?? 'The native core could not load mods.'}</span>
        </div>
      );
    }

    if (filteredModItems.length === 0) {
      return (
        <div className="empty-state">
          <Box size={18} aria-hidden="true" />
          <strong>
            {modsWorkspace.items.length === 0 ? 'No installed mods' : 'No matching mods'}
          </strong>
          <span>
            {modsWorkspace.items.length === 0
              ? 'Create an empty mod or install an archive in a later phase.'
              : 'Clear the search query to return to the full order.'}
          </span>
        </div>
      );
    }

    return (
      <div className="mod-list" role="list" aria-label="Mod order">
        <div
          className="mod-list__body"
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
            const isDragging = draggedModOrderId === item.orderId;
            const isDropTarget =
              modDropTargetOrderId === item.orderId && draggedModOrderId !== item.orderId;

            return (
              <div
                className={`mod-list-row${item.isSeparator ? ' mod-list-row--separator' : ''}`}
                role="listitem"
                tabIndex={0}
                draggable={!modsBusyLabel}
                data-selected={isSelected}
                data-separator={item.isSeparator}
                data-in-separator={isNested}
                data-dragging={isDragging}
                data-drop-target={isDropTarget}
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
                    <span className="mod-separator-line" aria-hidden="true" />
                    <strong className="mod-separator-title">{modItemTitle(item)}</strong>
                    <span className="mod-separator-line" aria-hidden="true" />
                    {isMenuOpen ? renderModRowMenu(item) : null}
                  </>
                ) : (
                  <>
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
                    <div className="mod-list-row__title">
                      <strong>{modItemTitle(item)}</strong>
                    </div>
                    <span
                      className="mod-overwrite-check"
                      data-state={overwrite.state}
                      title={overwrite.title}
                      aria-label={overwrite.title}
                    >
                      <CheckCircle2 size={16} aria-hidden="true" />
                      <span>{overwrite.label}</span>
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
        <div className="empty-state" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <strong>Loading plugins</strong>
          <span>{selectedProject?.projectDirectory ?? 'Selected build'}</span>
        </div>
      );
    }

    if (pluginsWorkspace.loadState === 'error') {
      return (
        <div className="empty-state" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>Plugins unavailable</strong>
          <span>{pluginsWorkspace.errorMessage ?? 'The native core could not load plugins.'}</span>
        </div>
      );
    }

    if (filteredPluginItems.length === 0) {
      return (
        <div className="empty-state">
          <MoreHorizontal size={18} aria-hidden="true" />
          <strong>
            {pluginsWorkspace.items.length === 0 ? 'No detected plugins' : 'No matching plugins'}
          </strong>
          <span>
            {pluginsWorkspace.items.length === 0
              ? 'Install or enable a mod with plugin files to populate the load order.'
              : 'Clear the search query to return to the full load order.'}
          </span>
        </div>
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
                <span role="cell">{item.isSeparator ? '-' : item.order + 1}</span>
                <div className="mod-row__main" role="cell">
                  <strong>{pluginItemTitle(item)}</strong>
                  <span>
                    {item.isSeparator
                      ? 'separator'
                      : item.lockReason || item.missingMasters.join(', ') || item.orderId}
                  </span>
                </div>
                <span role="cell">{pluginTypeLabel(item)}</span>
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
        <div className="empty-state" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <strong>Loading downloads</strong>
          <span>{selectedProject?.projectDirectory ?? 'Selected build'}</span>
        </div>
      );
    }

    if (downloadsWorkspace.loadState === 'error') {
      return (
        <div className="empty-state" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>Downloads unavailable</strong>
          <span>{downloadsWorkspace.errorMessage ?? 'The native core could not load downloads.'}</span>
        </div>
      );
    }

    if (filteredDownloadItems.length === 0) {
      return (
        <div className="empty-state">
          <Download size={18} aria-hidden="true" />
          <strong>
            {downloadsWorkspace.items.length === 0 ? 'No downloads yet' : 'No matching downloads'}
          </strong>
          <span>
            {downloadsWorkspace.items.length === 0
              ? 'Import an archive or capture NXM links to populate this queue.'
              : 'Clear the search query to return to the full download queue.'}
          </span>
        </div>
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

  const renderInstallFomodStep = () => {
    if (!installDialog?.fomodInstaller || !installFomodEvaluation) {
      return null;
    }

    const currentStep =
      installFomodEvaluation.visibleSteps[installDialog.fomodStepIndex] ??
      installFomodEvaluation.visibleSteps[0];
    const canMoveNext = installDialog.fomodStepIndex < installFomodEvaluation.visibleSteps.length - 1;
    const detailsOption =
      currentStep?.groups.flatMap((group) => group.options).find((option) => option.isSelected) ??
      currentStep?.groups.flatMap((group) => group.options)[0] ??
      null;

    return (
      <div className="install-grid install-grid--fomod">
        <aside className="install-steps" aria-label="FOMOD steps">
          {installFomodEvaluation.visibleSteps.map((step, index) => (
            <button
              key={`${step.stepIndex}:${step.stepName}`}
              type="button"
              data-active={index === installDialog.fomodStepIndex}
              data-complete={index < installDialog.fomodStepIndex && step.isSelectionValid}
              onClick={() => {
                if (index <= installDialog.fomodStepIndex) {
                  setInstallDialogPatch({ fomodStepIndex: index, validationMessage: null });
                }
              }}
            >
              <span>{step.visibleNumber}</span>
              <strong>{step.stepName}</strong>
            </button>
          ))}
        </aside>

        <section className="install-fomod-options">
          <div className="install-section-heading">
            <div>
              <p className="eyebrow">FOMOD</p>
              <h3>{currentStep?.stepName ?? 'Options'}</h3>
            </div>
            {installDialog.fomodInstaller.hasPreviousSelection ? (
              <button
                className="tool-button"
                type="button"
                onClick={() =>
                  setInstallDialogPatch({
                    selectedFomodOptionIds: previousFomodSelection(installDialog.fomodInstaller!),
                    fomodStepIndex: 0,
                    validationMessage: null
                  })
                }
              >
                <RefreshCw size={15} aria-hidden="true" />
                Previous
              </button>
            ) : null}
          </div>

          {installDialog.validationMessage ? (
            <div className="install-validation" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{installDialog.validationMessage}</span>
            </div>
          ) : null}

          <div className="fomod-group-list">
            {currentStep?.groups.map((group) => (
              <section
                key={group.group.id || group.group.name}
                className="fomod-group"
                data-invalid={!group.isSelectionValid}
              >
                <header>
                  <strong>{group.group.name || 'Options'}</strong>
                  <span>{group.group.type || 'SelectAny'}</span>
                </header>
                <div className="fomod-options">
                  {group.options.map((option) => {
                    const isRadio =
                      group.group.type === 'SelectExactlyOne' ||
                      group.group.type === 'SelectAtMostOne';
                    return (
                      <label
                        key={option.option.id}
                        className="fomod-option"
                        data-selected={option.isSelected}
                        data-disabled={!option.canToggle}
                      >
                        <input
                          type={isRadio ? 'radio' : 'checkbox'}
                          name={group.group.id || group.group.name}
                          checked={option.isSelected}
                          disabled={!option.canToggle}
                          onChange={(event) =>
                            setInstallDialogPatch({
                              selectedFomodOptionIds: toggleFomodOption(
                                installDialog.fomodInstaller!,
                                installDialog.selectedFomodOptionIds,
                                option.option.id,
                                event.target.checked
                              ),
                              validationMessage: null
                            })
                          }
                        />
                        <span>
                          <strong>{option.option.name || 'Option'}</strong>
                          <small>{option.effectiveType}</small>
                        </span>
                        {option.wasPreviouslySelected ? <em>Previous</em> : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>

        <aside className="install-details-pane" aria-label="FOMOD option details">
          <strong>{detailsOption?.option.name ?? installDialog.fomodInstaller.moduleName}</strong>
          <span>
            {detailsOption?.option.description ||
              installDialog.fomodInstaller.moduleVersion ||
              'No description provided.'}
          </span>
          {detailsOption?.option.imagePath || installDialog.fomodInstaller.moduleImagePath ? (
            <img
              src={detailsOption?.option.imagePath || installDialog.fomodInstaller.moduleImagePath}
              alt=""
            />
          ) : null}
        </aside>

        <footer className="install-dialog-actions install-grid-actions">
          <button
            className="tool-button"
            type="button"
            disabled={installDialog.fomodStepIndex === 0}
            onClick={() => void moveInstallFomodStep(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Back
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => (canMoveNext ? void moveInstallFomodStep(1) : void continueFromFomod())}
          >
            {canMoveNext ? (
              <>
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </>
            ) : (
              <>
                <CheckCircle2 size={16} aria-hidden="true" />
                Continue
              </>
            )}
          </button>
        </footer>
      </div>
    );
  };

  const renderInstallOptions = () => {
    if (!installDialog?.layoutPreview) {
      return null;
    }

    const preview = installDialog.layoutPreview;
    const previewLines = buildPlacementPreviewLines(preview, installPlacementOverrides.length);
    const validation = installDialog.validationMessage ?? validateInstallModName(installDialog.modName);

    return (
      <div className="install-grid">
        <section className="install-options-main">
          <label className="field">
            <span>Mod name</span>
            <input
              value={installDialog.modName}
              onChange={(event) =>
                setInstallDialogPatch({
                  modName: event.target.value,
                  validationMessage: null
                })
              }
            />
          </label>

          {installExistingModName ? (
            <section className="install-conflict" aria-label="Existing mod conflict">
              <div>
                <strong>Existing mod detected</strong>
                <span>{installExistingModName}</span>
              </div>
              <div className="segmented-control">
                <button
                  type="button"
                  data-active={installDialog.existingModMode === 1}
                  onClick={() => setInstallDialogPatch({ existingModMode: 1 })}
                >
                  Replace
                </button>
                <button
                  type="button"
                  data-active={installDialog.existingModMode === 2}
                  onClick={() => setInstallDialogPatch({ existingModMode: 2 })}
                >
                  Merge
                </button>
              </div>
            </section>
          ) : null}

          <section className="install-layout-summary">
            <header>
              <strong>Placement plan</strong>
            <button
              className="tool-button"
              type="button"
              onClick={() => {
                setArchiveTreeScrollTop(0);
                setInstallDialogPatch({ phase: 'details' });
              }}
            >
                <FolderTree size={15} aria-hidden="true" />
                Details
              </button>
            </header>
            <p>{buildPlacementSummaryText(preview, installPlacementOverrides.length)}</p>
            <ul>
              {previewLines.slice(0, 7).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {validation ? (
            <div className="install-validation" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{validation}</span>
            </div>
          ) : null}
        </section>

        <aside className="install-details-pane">
          <strong>{preview.gameDisplayName || preview.gameId || 'Content layout'}</strong>
          <dl className="install-mini-facts">
            <div>
              <dt>Files</dt>
              <dd>{preview.summary.totalEntries}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{preview.summary.hasWarnings ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt>Blockers</dt>
              <dd>{preview.summary.hasBlockers ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt>Overrides</dt>
              <dd>{installPlacementOverrides.length}</dd>
            </div>
          </dl>
        </aside>
      </div>
    );
  };

  const renderInstallDetails = () => {
    if (!installDialog?.layoutPreview) {
      return null;
    }

    const rows = buildArchivePlacementRows(
      installDialog.layoutPreview,
      installDialog.placementOverrides
    );
    const draggedEntry = installDialog.draggedSourcePath
      ? installDialog.layoutPreview.entries.find(
          (entry) => entry.sourcePath === installDialog.draggedSourcePath
        )
      : null;
    const visibleArchiveWindow = createVirtualWindow(rows, archiveTreeScrollTop, {
      rowHeight: archiveTreeRowHeight,
      visibleRows: archiveTreeVisibleRows,
      overscanRows: archiveTreeOverscanRows
    });

    return (
      <div className="install-details-tree">
        <header className="install-section-heading">
          <div>
            <p className="eyebrow">Archive details</p>
            <h3>Placement tree</h3>
          </div>
          <div className="mods-toolbar">
            <button
              className="tool-button"
              type="button"
              onClick={() =>
                setInstallDialogPatch({
                  placementOverrides: {},
                  validationMessage: null
                })
              }
            >
              <RefreshCw size={15} aria-hidden="true" />
              Reset
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => setInstallDialogPatch({ phase: 'options', validationMessage: null })}
            >
              Apply
            </button>
          </div>
        </header>
        {installDialog.layoutPreview.validationFindings.length > 0 ? (
          <div className="install-findings">
            {installDialog.layoutPreview.validationFindings.map((finding) => (
              <span key={`${finding.path}:${finding.message}`} data-blocker={finding.blocksInstall}>
                {finding.path || finding.classification}: {finding.message}
              </span>
            ))}
          </div>
        ) : null}
        <div
          className="archive-tree"
          role="tree"
          aria-label="Archive placement tree"
          onScroll={(event) => setArchiveTreeScrollTop(event.currentTarget.scrollTop)}
        >
          {visibleArchiveWindow.topSpacer > 0 ? (
            <div style={{ height: visibleArchiveWindow.topSpacer }} aria-hidden="true" />
          ) : null}
          {visibleArchiveWindow.items.map((row) => {
            const canDrop =
              draggedEntry !== undefined &&
              draggedEntry !== null &&
              createPlacementOverrideForDrop(draggedEntry, row) !== null;
            const hasOverride =
              row.entry !== null && installDialog.placementOverrides[row.entry.sourcePath] !== undefined;
            return (
              <div
                key={row.key}
                className="archive-tree-row"
                role="treeitem"
                tabIndex={0}
                aria-level={row.depth + 1}
                draggable={row.entry?.manualOverrideAllowed === true}
                data-directory={row.isDirectory}
                data-drop={canDrop}
                data-override={hasOverride}
                onDragStart={(event) => {
                  if (!row.entry?.manualOverrideAllowed) {
                    event.preventDefault();
                    return;
                  }

                  event.dataTransfer.setData('text/plain', row.entry.sourcePath);
                  setInstallDialogPatch({ draggedSourcePath: row.entry.sourcePath });
                }}
                onDragEnd={() => setInstallDialogPatch({ draggedSourcePath: null })}
                onDragOver={(event) => {
                  if (canDrop) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourcePath =
                    event.dataTransfer.getData('text/plain') || installDialog.draggedSourcePath || '';
                  const sourceEntry = installDialog.layoutPreview?.entries.find(
                    (entry) => entry.sourcePath === sourcePath
                  );
                  if (!sourceEntry) {
                    setInstallDialogPatch({ draggedSourcePath: null });
                    return;
                  }

                  const override = createPlacementOverrideForDrop(sourceEntry, row);
                  if (!override) {
                    setInstallDialogPatch({ draggedSourcePath: null });
                    return;
                  }

                  setInstallDialogPatch({
                    draggedSourcePath: null,
                    placementOverrides: {
                      ...installDialog.placementOverrides,
                      [override.sourcePath]: {
                        target: override.target,
                        targetRelativePath: override.targetRelativePath
                      }
                    },
                    validationMessage: null
                  });
                }}
                style={{ paddingLeft: `${12 + row.depth * 18}px` }}
              >
                {row.isDirectory ? (
                  <FolderOpen size={15} aria-hidden="true" />
                ) : (
                  <File size={15} aria-hidden="true" />
                )}
                <span>{row.name}</span>
                <small>{row.isDirectory ? row.target || 'folder' : row.entry?.classification}</small>
              </div>
            );
          })}
          {visibleArchiveWindow.bottomSpacer > 0 ? (
            <div style={{ height: visibleArchiveWindow.bottomSpacer }} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    );
  };

  const renderInstallDialog = () => {
    if (!installDialog) {
      return null;
    }

    return (
      <div className="install-modal-backdrop" role="presentation">
        <section className="install-dialog" role="dialog" aria-modal="true" aria-label="Install mod">
          <header className="install-dialog-header">
            <div>
              <p className="eyebrow">
                {installDialog.source.kind === 'download' ? 'Download install' : 'Archive install'}
              </p>
              <h2>{installDialog.source.displayName}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Close install dialog"
              disabled={installDialog.phase === 'installing'}
              onClick={() => setInstallDialog(null)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="install-dialog-body">
            {installDialog.phase === 'analyzing' || installDialog.phase === 'installing' ? (
              <div className="install-progress" role="status">
                <RefreshCw size={18} aria-hidden="true" />
                <strong>
                  {installDialog.phase === 'installing' ? 'Installing mod' : 'Analyzing archive'}
                </strong>
                <span>{shortPath(installDialog.source.sourcePath)}</span>
              </div>
            ) : null}
            {installDialog.phase === 'fomod' ? renderInstallFomodStep() : null}
            {installDialog.phase === 'options' ? renderInstallOptions() : null}
            {installDialog.phase === 'details' ? renderInstallDetails() : null}
            {installDialog.phase === 'error' ? (
              <div className="install-error" role="alert">
                <AlertTriangle size={20} aria-hidden="true" />
                <strong>Install flow failed</strong>
                <span>{installDialog.errorMessage ?? 'Operation failed.'}</span>
              </div>
            ) : null}
          </div>

          {installDialog.phase === 'options' || installDialog.phase === 'error' ? (
            <footer className="install-dialog-actions">
              <button
                className="tool-button"
                type="button"
                onClick={() => setInstallDialog(null)}
              >
                Cancel
              </button>
              {installDialog.phase === 'options' ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={Boolean(validateInstallModName(installDialog.modName))}
                  onClick={() => void submitInstallOptions()}
                >
                  <Play size={16} aria-hidden="true" />
                  Install
                </button>
              ) : null}
            </footer>
          ) : null}
        </section>
      </div>
    );
  };

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
        <div className="empty-state" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <strong>Loading profiles</strong>
          <span>{selectedProject?.projectDirectory ?? 'Selected build'}</span>
        </div>
      );
    }

    if (profilesWorkspace.loadState === 'error') {
      return (
        <div className="empty-state" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>Profiles unavailable</strong>
          <span>{profilesWorkspace.errorMessage ?? 'The native core could not load profiles.'}</span>
        </div>
      );
    }

    if (filteredProfileItems.length === 0) {
      return (
        <div className="empty-state">
          <FolderOpen size={18} aria-hidden="true" />
          <strong>{profilesWorkspace.items.length === 0 ? 'No profiles yet' : 'No matching profiles'}</strong>
          <span>
            {profilesWorkspace.items.length === 0
              ? 'Create a profile to isolate mod and plugin order.'
              : 'Clear the search query to return to the profile list.'}
          </span>
        </div>
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
        <div className="empty-state" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <strong>Loading executables</strong>
          <span>{selectedProject?.configPath ?? 'Selected build'}</span>
        </div>
      );
    }

    if (executablesWorkspace.loadState === 'error') {
      return (
        <div className="empty-state" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <strong>Executables unavailable</strong>
          <span>{executablesWorkspace.errorMessage ?? 'The native core could not load executables.'}</span>
        </div>
      );
    }

    if (filteredExecutableItems.length === 0) {
      return (
        <div className="empty-state">
          <Play size={18} aria-hidden="true" />
          <strong>
            {executablesWorkspace.items.length === 0 ? 'No executables yet' : 'No matching executables'}
          </strong>
          <span>
            {executablesWorkspace.items.length === 0
              ? 'Add the game executable or a tool to launch it from Fluxora.'
              : 'Clear the search query to return to the executable list.'}
          </span>
        </div>
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
        <div className="empty-state empty-state--compact">
          <Play size={18} aria-hidden="true" />
          <strong>Select an executable</strong>
          <span>Add or select a row to edit launch details.</span>
        </div>
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

  const renderBuildPathInput = (
    label: string,
    field: keyof Pick<
      BuildPathDraft,
      'modsDirectory' | 'profilesDirectory' | 'downloadsDirectory' | 'overwriteDirectory'
    >,
    browseTitle: string
  ) => (
    <label className="field">
      <span>{label}</span>
      <div className="path-picker">
        <input
          value={buildPathDraft[field]}
          disabled={Boolean(buildPathsBusyLabel)}
          onChange={(event) => updateBuildPathDraft({ [field]: event.target.value } as Partial<BuildPathDraft>)}
        />
        <button
          className="tool-button"
          type="button"
          disabled={Boolean(buildPathsBusyLabel)}
          onClick={() => void browseBuildPathDirectory(browseTitle, field)}
        >
          <FolderOpen size={16} aria-hidden="true" />
          Browse
        </button>
      </div>
    </label>
  );

  const renderBuildPathsInspector = () => (
    <aside className="inspector build-paths-inspector" aria-label="Build path settings">
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">Build settings</p>
          <h2>{selectedProject?.name ?? 'Paths'}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Close build settings"
          disabled={Boolean(buildPathsBusyLabel)}
          onClick={() => setIsBuildPathsOpen(false)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="build-paths-form">
        <label className="field">
          <span>Project directory</span>
          <input value={buildPathDraft.projectDirectory} readOnly />
        </label>
        <label className="field">
          <span>Game executable</span>
          <div className="path-picker">
            <input
              value={buildPathDraft.gameExecutablePath}
              disabled={Boolean(buildPathsBusyLabel)}
              onChange={(event) =>
                updateBuildPathDraft({
                  gameExecutablePath: event.target.value,
                  gameDirectory:
                    directoryFromExecutablePath(event.target.value) ||
                    buildPathDraft.gameDirectory
                })
              }
            />
            <button
              className="tool-button"
              type="button"
              disabled={Boolean(buildPathsBusyLabel)}
              onClick={() => void browseBuildGameExecutable()}
            >
              <FolderOpen size={16} aria-hidden="true" />
              Browse
            </button>
          </div>
        </label>
        <label className="field">
          <span>Game directory</span>
          <input
            value={buildPathDraft.gameDirectory}
            disabled={Boolean(buildPathsBusyLabel)}
            onChange={(event) => updateBuildPathDraft({ gameDirectory: event.target.value })}
          />
        </label>
        {renderBuildPathInput('Mods directory', 'modsDirectory', 'Select mods directory')}
        {renderBuildPathInput('Profiles directory', 'profilesDirectory', 'Select profiles directory')}
        {renderBuildPathInput('Downloads directory', 'downloadsDirectory', 'Select downloads directory')}
        {renderBuildPathInput('Overwrite directory', 'overwriteDirectory', 'Select overwrite directory')}
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
        <div className="settings-actions settings-actions--footer">
          <button
            className="tool-button"
            type="button"
            disabled={Boolean(buildPathsBusyLabel)}
            onClick={() => setIsBuildPathsOpen(false)}
          >
            <X size={16} aria-hidden="true" />
            Cancel
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={Boolean(buildPathsBusyLabel)}
            onClick={() => void saveBuildPathSettings()}
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            Save
          </button>
        </div>
      </div>
    </aside>
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
    if (!operationOverlay) {
      return null;
    }

    const isIndeterminate = operationOverlay.percent === null;
    const percent = Math.max(0, Math.min(100, operationOverlay.percent ?? 0));
    return (
      <div className="operation-overlay" role="status" aria-label={operationOverlay.title}>
        <div className="operation-overlay__panel">
          <div className="surface-header surface-header--compact">
            <div>
              <p className="eyebrow">Operation</p>
              <h2>{operationOverlay.title}</h2>
            </div>
            {operationOverlay.canClose ? (
              <button
                className="icon-button"
                type="button"
                title="Close operation"
                onClick={() => setOperationOverlay(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="operation-progress">
            <strong>{isIndeterminate ? 'Working' : `${percent}%`}</strong>
            <span>{operationOverlay.statusText}</span>
            {operationOverlay.currentItem ? <small>{operationOverlay.currentItem}</small> : null}
            <div className="progress-track" data-indeterminate={isIndeterminate}>
              <span style={{ width: isIndeterminate ? '42%' : `${percent}%` }} />
            </div>
          </div>
          {operationOverlay.resultText ? (
            <div className="settings-note" data-status="ready">
              <strong>Complete</strong>
              <span>{operationOverlay.resultText}</span>
            </div>
          ) : null}
          {operationOverlay.errorText ? (
            <div className="settings-note" data-status="error" role="alert">
              <strong>Operation failed</strong>
              <span>{operationOverlay.errorText}</span>
            </div>
          ) : null}
          <div className="settings-actions settings-actions--footer">
            <button
              className="tool-button"
              type="button"
              disabled={!operationOverlay.isRunning || !operationCancellationSupported}
              onClick={() => void cancelOperationOverlay()}
            >
              <XCircle size={16} aria-hidden="true" />
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!operationOverlay.canClose}
              onClick={() => setOperationOverlay(null)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTransferOperationPage = () => (
    <TransferMo2Page
      bridgeReady={Boolean(bridgeStatus?.ready)}
      transferAvailable={settingsCapabilities.transferAvailable}
      busyLabel={settingsBusyLabel}
      isRunning={isTransferRunning}
      cancellationSupported={operationCancellationSupported}
      sourceDirectory={transferSourceDirectory}
      destinationRootDirectory={transferDestinationRootDirectory}
      defaultDestinationRoot={selectedProject?.installRootDirectory || catalog.defaultInstallRootDirectory}
      mode={transferMode}
      hasSelectedProject={Boolean(selectedProject)}
      selectedStep={transferStep}
      analysis={transferAnalysis}
      progress={transferProgress}
      error={transferError}
      result={transferResult}
      drives={transferDestinationDrives}
      driveState={transferDriveState}
      onSelectStep={setTransferStep}
      onModeChange={(mode) => {
        setTransferMode(mode);
        setTransferAnalysis(null);
        setTransferError(null);
        setTransferResult(null);
      }}
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

  const renderSettingsNav = () => (
    <aside className="settings-nav" aria-label="Settings sections">
      {settingsSections.map((section) => {
        const isActive = settingsSection === section.id;
        const icon =
          section.id === 'connections'
            ? Link2
            : section.id === 'language'
              ? Languages
              : section.id === 'theme'
                ? themeMode === 'light'
                  ? Sun
                  : Moon
                : UploadCloud;
        const Icon = icon;
        return (
          <button
            key={section.id}
            type="button"
            data-active={isActive}
            disabled={isTransferRunning && section.id !== 'transfer'}
            onClick={() => setSettingsSection(section.id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>
              <strong>{section.label}</strong>
              <small>{section.description}</small>
            </span>
          </button>
        );
      })}
    </aside>
  );

  const renderNexusSettings = () => {
    const accountName = nexusStatus?.displayName || nexusStatus?.userId || '';
    const accountText = nexusStatus?.isLinked
      ? accountName
        ? `Аккаунт привязан - ${accountName}`
        : 'Аккаунт привязан'
      : 'Аккаунт не привязан';
    const canToggleNexus =
      settingsCapabilities.nexusAvailable &&
      Boolean(nexusStatus?.isLinked || nexusStatus?.isConfigured);

    return (
      <div className="settings-panel" aria-label="Nexus Mods settings">
        <div className="settings-service-row">
          <div className="settings-service-main">
            <span className="settings-service-icon settings-service-icon--nexus">
              <img src={nexusModsIcon} alt="" />
            </span>
            <span className="settings-service-copy">
              <strong>Nexus Mods</strong>
              <span>{accountText}</span>
            </span>
          </div>
          <button
            className="settings-switch"
            type="button"
            role="switch"
            aria-checked={Boolean(nexusStatus?.isLinked)}
            aria-label="Nexus Mods account"
            title={nexusStatus?.message || accountText}
            disabled={nexusBusy || !canToggleNexus}
            onClick={() => void toggleNexusConnection()}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  const renderLanguageSettings = () => {
    const selectedLanguage =
      languageOptions.find((language) => language.code === bridgeStatus?.language) ??
      languageOptions[0];

    return (
      <div className="settings-panel" aria-label="Language settings">
        <div className="settings-row settings-row--hero">
          <div>
            <p className="eyebrow">Language</p>
            <h3>{selectedLanguage?.nativeLabel ?? bridgeStatus?.language ?? 'pending'}</h3>
            <span>Language is saved through the native app settings and applied to runtime state immediately where supported.</span>
          </div>
          <Globe2 size={22} aria-hidden="true" />
        </div>
        <label className="settings-select-card">
          <span>Interface language</span>
          <span className="settings-select-control">
            <Globe2 size={17} aria-hidden="true" />
            <select
              aria-label="Language"
              value={selectedLanguage?.code ?? ''}
              disabled={!bridgeStatus?.ready || languageBusy !== null}
              onChange={(event) => void setLanguage(event.target.value)}
            >
              {languageOptions.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.nativeLabel} - {language.label}
                </option>
              ))}
            </select>
            <ChevronDown size={17} aria-hidden="true" />
          </span>
          <small>
            {languageBusy
              ? `Saving ${languageOptions.find((language) => language.code === languageBusy)?.nativeLabel ?? languageBusy}`
              : selectedLanguage
                ? `${selectedLanguage.label} (${selectedLanguage.code})`
                : 'Waiting for language state'}
          </small>
        </label>
      </div>
    );
  };

  const renderThemeSettings = () => {
    const selectedTheme = themeOptions.find((theme) => theme.mode === themeMode) ?? themeOptions[0];
    const ThemeIcon = themeMode === 'light' ? Sun : Moon;

    return (
      <div className="settings-panel" aria-label="Customization settings">
        <div className="settings-row settings-row--hero">
          <div>
            <p className="eyebrow">Кастомизация</p>
            <h3>{selectedTheme?.label ?? (themeMode === 'light' ? 'Light' : 'Dark')}</h3>
            <span>Theme is persisted in core app settings and mirrored into the Electron shell.</span>
          </div>
          <ThemeIcon size={22} aria-hidden="true" />
        </div>
        <label className="settings-select-card">
          <span>Theme</span>
          <span className="settings-select-control">
            <ThemeIcon size={17} aria-hidden="true" />
            <select
              aria-label="Theme"
              value={themeMode}
              disabled={themeBusy}
              onChange={(event) => void setTheme(event.target.value as FluxoraThemeMode)}
            >
              {themeOptions.map((theme) => (
                <option key={theme.mode} value={theme.mode}>
                  {theme.label}
                </option>
              ))}
            </select>
            <ChevronDown size={17} aria-hidden="true" />
          </span>
          <small>{themeBusy ? 'Saving theme' : `${selectedTheme?.label ?? 'Dark'} appearance`}</small>
        </label>
      </div>
    );
  };

  const renderTransferSettings = () => (
    <TransferSettingsPanel
      bridgeReady={Boolean(bridgeStatus?.ready)}
      transferAvailable={settingsCapabilities.transferAvailable}
      busyLabel={settingsBusyLabel}
      isRunning={isTransferRunning}
      onOpenTransfer={() => void openMo2TransferFromSettings()}
    />
  );

  const renderSettingsWorkspace = () => {
    const section =
      settingsSection === 'connections'
        ? renderNexusSettings()
        : settingsSection === 'language'
          ? renderLanguageSettings()
          : settingsSection === 'theme'
            ? renderThemeSettings()
            : renderTransferSettings();

    return (
      <section className="settings-layout" aria-label="Settings">
        {renderSettingsNav()}
        <section className="work-surface settings-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Settings</p>
              <h2>{settingsSections.find((item) => item.id === settingsSection)?.label ?? 'Settings'}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Refresh settings"
              disabled={Boolean(settingsBusyLabel) || isTransferRunning}
              onClick={() => void loadSettingsWorkspace()}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
          {message ? (
            <div className="activity-banner" role="status">
              <CircleDot size={16} aria-hidden="true" />
              <span>{message}</span>
            </div>
          ) : null}
          {settingsBusyLabel ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{settingsBusyLabel}</span>
            </div>
          ) : null}
          {section}
        </section>
      </section>
    );
  };

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
        <section className="build-header">
          <div className="build-title">
            <div>
              <p className="eyebrow">Build</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <dl className="build-metrics" aria-label="Build summary">
              <div>
                <dt>Game</dt>
                <dd>{selectedProject.gameName || selectedProject.templateId}</dd>
              </div>
              <div>
                <dt>Last launch</dt>
                <dd>{selectedProjectLibraryStats?.lastLaunch ?? 'Not tracked'}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{selectedProjectLibraryStats?.size ?? '-'}</dd>
              </div>
              <div>
                <dt>Mods</dt>
                <dd>{selectedProjectLibraryStats?.mods ?? '-'}</dd>
              </div>
              <div>
                <dt>Disabled</dt>
                <dd>{selectedProjectLibraryStats?.disabledMods ?? '-'}</dd>
              </div>
              <div>
                <dt>Plugins</dt>
                <dd>{selectedProjectLibraryStats?.plugins ?? `${enabledPluginCount}/${pluginCount}`}</dd>
              </div>
            </dl>
          </div>

          <div className="build-controls" aria-label="Build launch controls">
            <label className="compact-field">
              <span>Profile</span>
              <select
                value={selectedProjectProfileName}
                disabled={Boolean(profilesBusyLabel) || buildProfileOptions.length === 0}
                onChange={(event) => {
                  dispatchProfilesWorkspace({ type: 'selected', name: event.target.value });
                  setProfileDraftName(event.target.value);
                  setProfileDeleteArmedName(null);
                }}
              >
                {buildProfileOptions.length === 0 ? (
                  <option value="">No profiles</option>
                ) : (
                  buildProfileOptions.map((profileName) => (
                    <option key={profileName} value={profileName}>
                      {profileName}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="compact-field compact-field--wide">
              <span>Executable</span>
              <select
                value={selectedExecutableItem?.id ?? ''}
                disabled={Boolean(executablesBusyLabel) || executablesWorkspace.items.length === 0}
                onChange={(event) =>
                  dispatchExecutablesWorkspace({ type: 'selected', id: event.target.value })
                }
              >
                {executablesWorkspace.items.length === 0 ? (
                  <option value="">No executable</option>
                ) : (
                  executablesWorkspace.items.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {executableTitle(entry)}
                    </option>
                  ))
                )}
              </select>
            </label>

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

          <div className="build-command-row" aria-label="Build commands">
            <button
              className="tool-button"
              type="button"
              onClick={() => changeRoute('home')}
            >
              <Home size={16} aria-hidden="true" />
              Library
            </button>
            <button
              className="icon-button"
              type="button"
              title="Refresh build workspace"
              disabled={
                Boolean(modsBusyLabel) ||
                Boolean(pluginsBusyLabel) ||
                Boolean(downloadsBusyLabel) ||
                Boolean(profilesBusyLabel) ||
                Boolean(executablesBusyLabel)
              }
              onClick={() => {
                void loadProfilesWorkspace(selectedProject);
                void loadModsWorkspace(selectedProject);
                void loadPluginsWorkspace(selectedProject);
                void loadDownloadsWorkspace(selectedProject);
                void loadExecutablesWorkspace(selectedProject);
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
              <button
                className="tool-button"
                type="button"
                onClick={() => void openBuildPathSettings()}
              >
                <Settings size={16} aria-hidden="true" />
                Paths
              </button>
              <button
                className="tool-button"
                type="button"
                onClick={() => void packageFluxPack()}
              >
                <UploadCloud size={16} aria-hidden="true" />
                Package
              </button>
              <button
                className="tool-button"
                type="button"
                onClick={() => void inspectFluxPack()}
              >
                <File size={16} aria-hidden="true" />
                Inspect
              </button>
              <button
                className="tool-button"
                type="button"
                onClick={() => void installFluxPack()}
              >
                <Download size={16} aria-hidden="true" />
                Install
              </button>
              <button
                className="icon-button"
                type="button"
                title="Open folder"
                onClick={() => void openProjectDirectory(selectedProject)}
              >
                <FolderOpen size={16} aria-hidden="true" />
              </button>
          </div>
        </section>

        {message ? (
          <div className="activity-banner build-message" role="status">
            <CircleDot size={16} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}

        {renderFluxPackSummary()}

        <section className="build-workbench" aria-label="Mod Organizer style workspace">
          <section className="build-pane build-pane--mods" aria-label="Mods">
            <header className="build-pane__header">
              <div>
                <p className="eyebrow">Left pane</p>
                <h3>Mods</h3>
              </div>
              <div className="build-pane__tools">
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
                  Empty
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
                <p className="eyebrow">Right pane</p>
                <h3>{activeRightPane === 'plugins' ? 'Plugins' : 'Downloads'}</h3>
                <span>
                  {activeRightPane === 'plugins'
                    ? `${enabledPluginCount} enabled`
                    : `${downloadsWorkspace.items.length} files`}
                </span>
              </div>

              <div className="right-pane-tabs" role="tablist" aria-label="Right pane tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeRightPane === 'plugins'}
                  data-active={activeRightPane === 'plugins'}
                  onClick={() => setActiveRightPane('plugins')}
                >
                  <Layers size={15} aria-hidden="true" />
                  <span>Plugins</span>
                  <strong>{enabledPluginCount}/{pluginCount}</strong>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeRightPane === 'downloads'}
                  data-active={activeRightPane === 'downloads'}
                  onClick={() => setActiveRightPane('downloads')}
                >
                  <Download size={15} aria-hidden="true" />
                  <span>Downloads</span>
                  <strong>{downloadsWorkspace.items.length}</strong>
                </button>
              </div>

              <div className="build-pane__tools">
                {activeRightPane === 'plugins' ? (
                  <>
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
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </header>

            {activeRightPane === 'plugins' ? (
              <>
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
                {!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported ? (
                  <div className="empty-state">
                    <MoreHorizontal size={18} aria-hidden="true" />
                    <strong>Plugins unavailable</strong>
                    <span>{pluginCapabilities.reason}</span>
                  </div>
                ) : (
                  renderPluginRows()
                )}
              </>
            ) : (
              <>
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
              </>
            )}
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
    <header className="titlebar">
      <div className="titlebar__drag" />
      <div className="titlebar__brand">
        {isSettingsWindow ? (
          <>
            <Settings className="titlebar__settings-icon" size={18} aria-hidden="true" />
            <span>Settings</span>
          </>
        ) : (
          <>
            <img className="titlebar__mark" src={fluxoraLogo} alt="" />
            <span>Fluxora</span>
          </>
        )}
      </div>
      <div className="titlebar__controls">
        {showSettingsButton ? (
          <>
            <button
              className="titlebar__shortcut"
              type="button"
              title="Home"
              aria-label="Home"
              data-active={activeRoute === 'home'}
              onClick={() => changeRoute('home')}
            >
              <Home size={17} aria-hidden="true" />
            </button>
            <button
              className="titlebar__shortcut"
              type="button"
              title="Open settings"
              aria-label="Open settings"
              onClick={() => void openSettingsWindow()}
            >
              <Settings size={17} aria-hidden="true" />
            </button>
          </>
        ) : null}
        <button type="button" title="Minimize" onClick={() => void window.fluxora.windowControls.minimize()}>
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Maximize"
          onClick={() => void window.fluxora.windowControls.toggleMaximize()}
        >
          <Square size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => void window.fluxora.windowControls.close()}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );

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
              </>
            )}
          </div>
        </section>
    </main>
  );
};
