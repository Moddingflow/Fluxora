import {
  AlertTriangle,
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
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from 'react';

import menuChevronDownIcon from '../../../Icons/chevron-down.svg';
import menuChevronUpIcon from '../../../Icons/chevron-up.svg';
import menuCircleCheckIcon from '../../../Icons/circle-check.svg';
import menuCircleXIcon from '../../../Icons/circle-x.svg';
import menuFolderOpenIcon from '../../../Icons/folder-open.svg';
import menuHardDriveDownloadIcon from '../../../Icons/hard-drive-download.svg';
import menuLayersIcon from '../../../Icons/layers.svg';
import menuPackagePlusIcon from '../../../Icons/package-plus.svg';
import menuPlayIcon from '../../../Icons/play.svg';
import menuPlusIcon from '../../../Icons/plus.svg';
import modDetailsFilesIcon from '../../../Icons/folder-tree.svg';
import modDetailsConflictsIcon from '../../../Icons/git-compare-arrows.svg';
import infoCircleIcon from '../../../Icons/info-circle.svg';
import menuToggleLeftIcon from '../../../Icons/toggle-left.svg';
import menuToggleRightIcon from '../../../Icons/toggle-right.svg';
import menuTrashIcon from '../../../Icons/trash-2.svg';
import { AppTitlebar } from './components/chrome/AppTitlebar';
import { Button, EmptyState, LoadingSplash, StatusDot } from './design-system';
import { PrimitivePreview } from './design-system/PrimitivePreview';
import {
  LibraryHome,
  type LibraryCatalogState
} from './features/library/LibraryHome';
import {
  buildProjectLibraryStats,
  type ProjectRuntimeSummary
} from './features/library/projectLibraryStats';
import { AiChatPanel } from './features/ai/AiChatPanel';
import {
  AI_CHAT_PANEL_COLLAPSED_WIDTH,
  aiChatReducer,
  createAiMessage,
  createAiStreamEvent,
  initialAiChatState,
  type AiSubagentChatMetadata,
  type AiRun
} from './features/ai/ai-chat-state';
import {
  aiSessionStorageKey,
  createAiHostChatRequest,
  createAiSupportBundleSnapshot,
  createAiSessionForScope,
  createAiRunForPrompt,
  loadAiSession,
  saveAiSession,
  startHostAiRun,
  type AiLocalRunHandle,
  type AiRuntimeLogEntry
} from './features/ai/ai-chat-runtime';
import { aiAutonomousJobQueueStorageKey } from './features/ai/ai-autonomous-jobs';
import { collectAiBuildContext, type AiBuildOperationHint } from './features/ai/ai-build-tools';
import {
  aiProviderDiagnostic,
  loadAiChatSettings,
  normalizeAiChatSettings,
  providerForModel,
  saveAiChatSettings,
  type AiChatSettings
} from './features/ai/ai-chat-settings';
import {
  AI_CONTEXT_SOURCE_URL_PREFIX,
  safeAiSourceUrl
} from './features/ai/ai-chat-security';
import { BuildPathsInspector } from './features/build/BuildPathsInspector';
import { BuildSettingsWorkspace } from './features/build/BuildSettingsWorkspace';
import { BuildDetailHeader } from './features/build/BuildDetailHeader';
import {
  FluxPackExportDialog,
  type FluxPackExportOptions
} from './features/fluxpack/FluxPackExportDialog';
import { FluxPackInstallConflictDialog } from './features/fluxpack/FluxPackInstallConflictDialog';
import { FluxPackManualDownloadsDialog } from './features/fluxpack/FluxPackManualDownloadsDialog';
import {
  findFluxPackNameConflict,
  resolveFluxPackInstallTarget
} from './features/fluxpack/fluxpack-install-target';
import {
  DeletionConfirmationDialog,
  deletionSubjectLabel,
  type DeletionConfirmationKind
} from './features/deletion/DeletionConfirmationDialog';
import { MissingMastersStatus } from './features/plugins/MissingMastersStatus';
import {
  InstallDialog,
  type InstallDialogState
} from './features/install/InstallDialog';
import {
  MOD_CREATION_NAME_MAX_LENGTH,
  ModCreationDialog,
  type ModCreationDialogKind,
  type ModCreationDialogState
} from './features/mods/ModCreationDialog';
import {
  OperationOverlay,
  type OperationOverlayState
} from './features/operations/OperationOverlay';
import { SettingsWorkspace } from './features/settings/SettingsWorkspace';
import {
  isTextEditorFileName,
  TextEditorWorkspace
} from './features/text-editor/TextEditorWorkspace';
import { previewKindForFile } from './features/file-preview/preview-kind-registry';
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
  mergeProjectIntoCatalog,
  openProjectConfig,
  previewProjectDirectory,
  projectCatalogFallback,
  renameProjectConfig,
  upsertProject
} from './services/project-catalog-service';
import {
  appendOverwriteOrderItem,
  createOverwriteOrderItem,
  emptyModWorkspaceState,
  formatFileSize,
  hasConflict,
  isModOverwriteItem,
  isModNestedUnderSeparator,
  modConflictMarkerStates,
  modConflictMarkerStatesForHighlight,
  modItemTitle,
  modLatestVersionText,
  modOverwriteView,
  modOrderItemMatchesLookup,
  modRowConflictHighlight,
  modSeparatorChildCount,
  modStatusText,
  modTableStatusView,
  modVersionText,
  modWorkspaceReducer,
  optimisticModInstallState,
  reorderModOrderItems,
  removeModOrderItems,
  selectedModOrderItem,
  targetIndexForDrop,
  visibleModOrderItems,
  type ModConflictHighlight,
  type ModConflictMarkerState
} from './mod-workspace-state';
import {
  canDragPluginOrderItem,
  emptyPluginWorkspaceState,
  enabledPluginNameKeys,
  isPluginNestedUnderSeparator,
  isSkyrimMissingMasterStatusProject,
  mergePendingPluginEnabledStates,
  pluginCapabilityView,
  pluginHexIndex,
  pluginItemTitle,
  pluginMissingMasterSummary,
  pluginSeparatorChildCount,
  pluginSeparatorMissingMasterSummary,
  pluginSourceLabel,
  pluginSourceModKey,
  pluginStatusText,
  pluginTypeLabel,
  pluginWorkspaceReducer,
  reorderPluginOrderItems,
  selectedPluginOrderItem,
  targetIndexForPluginDrop,
  targetIndexForPluginMove,
  type PluginMissingMasterContext,
  type PendingPluginEnabledState,
  visiblePluginOrderItems
} from './plugin-workspace-state';
import {
  downloadCapabilityView,
  downloadRawTitle,
  downloadStatusView,
  downloadTitle,
  downloadWorkspaceReducer,
  emptyDownloadWorkspaceState,
  filterDownloadEntries,
  hasActiveDownload,
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
  createCheckingNexusAuthStatus,
  createVerifiedNexusAuthStatus,
  loadCachedNexusAuthStatus,
  nexusCanToggle,
  nexusIsVerifiedLinked,
  normalizeThemeMode,
  selectPreferredTransferDrive,
  fluxoraOriginalRepositoryUrl,
  loadDeveloperModeSetting,
  saveCachedNexusAuthStatus,
  saveDeveloperModeSetting,
  settingsCapabilityView,
  type NexusAuthViewStatus,
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
  ngioGrassCacheActionView,
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
  type InstallModOrderPlacement,
  type InstallSource
} from './install-workspace-state';
import { defaultModNameFromPath, shortPath } from './services/path-display-service';
import {
  createProjectOpenTiming,
  formatProjectOpenBackgroundPerformanceMessage,
  formatProjectOpenPerformanceMessage,
  type ProjectOpenTiming
} from './services/project-open-performance';
import { createRendererOperationId, errorMessage } from './services/renderer-operation-service';
import { installRendererRefreshShortcut } from './services/renderer-refresh-shortcut-service';
import {
  createPendingPathAccumulator,
  createScopedSequenceTracker,
  createTrailingRefreshCoordinator,
  drainPendingPathsWithRetry,
  topLevelChangedModPaths
} from './services/trailing-refresh-coordinator';
import {
  createMo2TransferImportRequest,
  normalizeMo2TransferAnalysis,
  normalizeMo2TransferDestinationRoot
} from './mo2-transfer-request';
import { createVirtualWindow } from './ui-performance';
import type {
  FluxoraAppInfo,
  FluxoraAiHostStatus,
  FluxoraApiLimitProvider,
  FluxoraContentLayoutPreview,
  FluxoraDownloadEntry,
  FluxoraExecutable,
  FluxoraExecutableLaunchResult,
  FluxoraExistingModInstallMode,
  FluxoraFileDropEvent,
  FluxoraFomodInstaller,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackManualSourceArchive,
  FluxoraFluxPackPackageType,
  FluxoraFluxPackSourceInstallPlan,
  FluxoraFluxPackSummary,
  FluxoraGameTemplate,
  FluxoraInstalledMod,
  FluxoraInstalledModSummary,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraMo2TransferHandoff,
  FluxoraEffectiveFileTreePage,
  FluxoraEffectiveFileTreeEntry,
  FluxoraEffectiveFileTreeSnapshot,
  FluxoraModConflictTreePage,
  FluxoraModDetailsBootstrap,
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem,
  FluxoraNexusModsAuthStatus,
  FluxoraNxmInboundLinksCaptured,
  FluxoraNxmProtocolResult,
  FluxoraPluginOrderItem,
  FluxoraProject,
  FluxoraSecurityState,
  FluxoraThemeMode,
  FluxoraTransferDriveOption,
  NativeBridgeStatus
} from '../shared/fluxora-api';

interface FluxPackInstallConflictState {
  fluxPackPath: string;
  project: FluxoraProject;
  summary: FluxoraFluxPackSummary;
}

interface FluxPackInstallExecution {
  existingConfigPath?: string;
  fluxPackPath: string;
  installRootDirectory: string;
  summary: FluxoraFluxPackSummary;
  targetProject: FluxoraProject | null;
}

interface FluxPackManualDownloadState {
  execution: FluxPackInstallExecution;
  selectedArchives: Record<string, string>;
  sources: FluxoraFluxPackSourceInstallPlan[];
}

const FilePreviewWorkspace = lazy(async () => {
  const module = await import('./features/file-preview/FilePreviewWorkspace');
  return { default: module.FilePreviewWorkspace };
});

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

interface LoadCatalogOptions {
  mergeProject?: FluxoraProject;
  keepMergedProjectOnError?: boolean;
  preferredProjectId?: string | null;
}

interface ProjectMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface RowContextMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface StartMo2TransferOptions {
  analysis?: FluxoraModOrganizerImportAnalysis | null;
  skipMainHandoff?: boolean;
}

type InstallAnalysisResult =
  | {
      kind: 'fomod';
      fallbackName: string;
      fomodInstaller: FluxoraFomodInstaller;
    }
  | {
      kind: 'layout';
      fallbackName: string;
      layoutPreview: FluxoraContentLayoutPreview;
    };

interface LaunchSplashState {
  appName: string;
  buildName: string;
  detail: string;
  operationId: string;
  state: 'starting' | 'running';
  subtitle?: string;
  title: string;
}

interface OpeningBuildSplashState {
  buildName: string;
  operationId: string;
  progress: number;
}

interface BuildPathEditorSnapshot {
  buildPathDraft: BuildPathDraft;
  buildPathExecutables: FluxoraExecutable[];
  buildPathsError: string | null;
  fluxPackInstallResult: FluxoraFluxPackInstallResult | null;
  fluxPackSummary: FluxoraFluxPackSummary | null;
  grassCacheConfirmationOpen: boolean;
  isBuildPathsOpen: boolean;
  isDirty: boolean;
}

interface OverwriteClearSplashState {
  buildName: string;
  operationId: string;
  progress: number;
}

type RightPaneId = 'plugins' | 'data' | 'downloads' | 'build';
type WorkspaceStoreId = 'mods' | 'plugins' | 'downloads' | 'profiles' | 'executables';
type DownloadDropCue = 'idle' | 'hover' | 'importing';
type RowReorderKind = 'mod' | 'plugin';
type RowDropPlacement = 'before' | 'after';
type ModDetailsTabId = 'files' | 'conflicts';

interface EffectiveFileTreeRow {
  entry: FluxoraEffectiveFileTreeEntry;
  level: number;
}

interface RowDropTargetState {
  orderId: string;
  placement: RowDropPlacement;
}

interface RowReorderSession {
  kind: RowReorderKind;
  pointerId: number;
  sourceOrderId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
  frameId: number | null;
  targetOrderId: string | null;
  placement: RowDropPlacement | null;
  scrollContainer: HTMLElement | null;
}

interface WorkspaceLoadOptions {
  coordinatedSequence?: number;
  persistedSnapshot?: boolean;
  showBusy?: boolean;
  showLoading?: boolean;
  resetScroll?: boolean;
  operationId?: string;
  profileName?: string;
}

const buildContentWatchKeyForProject = (
  project: FluxoraProject,
  profileName: string
): string | null => {
  const modsDirectory = project.paths?.modsDirectory;
  const profilesDirectory = project.paths?.profilesDirectory;
  if (!modsDirectory || !profilesDirectory) {
    return null;
  }
  return JSON.stringify([
    project.projectDirectory,
    modsDirectory,
    profilesDirectory,
    profileName,
    project.paths?.gameDirectory ?? ''
  ]);
};

const buildContentScopeKey = (projectDirectory: string): string =>
  projectDirectory.replaceAll('/', '\\').toLocaleLowerCase('en-US');

interface WorkspaceMutationOptions {
  showBusy?: boolean;
  reload?: WorkspaceLoadOptions;
}

interface PendingPluginEnableSave extends PendingPluginEnabledState {
  contextKey: string;
  pending: boolean;
  sequence: number;
}

interface ActiveAiRunControl {
  cancelled: boolean;
  handle: AiLocalRunHandle | null;
  operationId: string;
  runId: string;
}

interface DeletionConfirmationRequest {
  kind: DeletionConfirmationKind;
  itemName: string;
  itemCount?: number;
  onConfirm: () => Promise<void>;
}

type MenuIconStyle = CSSProperties & { '--menu-icon': string };
type AssetIconStyle = CSSProperties & { '--asset-icon': string };
type ModConflictMarkerStyle = CSSProperties & {
  '--conflict-marker-top': string;
  '--conflict-marker-offset': string;
};

const effectiveFileTreeCacheKey = (projectDirectory: string, profileName: string): string =>
  `${projectDirectory}\n${profileName || 'Default'}`;

const effectiveFileTreeRevisionCacheKey = (
  projectDirectory: string,
  profileName: string,
  revision: string
): string => `${effectiveFileTreeCacheKey(projectDirectory, profileName)}\n${revision}`;

const effectiveFileTreeSnapshotFromPage = (
  page: FluxoraEffectiveFileTreePage
): FluxoraEffectiveFileTreeSnapshot => ({
  profileName: page.profileName,
  revision: page.revision,
  totalFileCount: page.totalFileCount,
  totalFileCountKnown: page.totalFileCountKnown ?? true,
  entries: page.entries
});

const mergeEffectiveFileTreePage = (
  current: FluxoraEffectiveFileTreeSnapshot | null,
  page: FluxoraEffectiveFileTreePage
): FluxoraEffectiveFileTreeSnapshot => {
  const byPath = new Map<string, FluxoraEffectiveFileTreeEntry>();
  const pageParentPath = page.parentPath ?? '';
  for (const entry of current?.entries ?? []) {
    if (entry.parentPath === pageParentPath) {
      continue;
    }
    byPath.set(entry.relativePath, entry);
  }
  for (const entry of page.entries) {
    byPath.set(entry.relativePath, entry);
  }

  return {
    profileName: page.profileName,
    revision: page.revision,
    totalFileCount: page.totalFileCount,
    totalFileCountKnown: page.totalFileCountKnown ?? true,
    entries: [...byPath.values()]
  };
};

const modDetailsBootstrapStoragePrefix = 'fluxora.mod-details.bootstrap.';

const modDetailsBootstrapStorageKey = (key: string): string =>
  `${modDetailsBootstrapStoragePrefix}${key}`;

const writeModDetailsBootstrap = (bootstrap: FluxoraModDetailsBootstrap): void => {
  try {
    window.localStorage.setItem(
      modDetailsBootstrapStorageKey(bootstrap.key),
      JSON.stringify(bootstrap)
    );
  } catch {
    // Bootstrap is an optimization. The window can still load through the bridge.
  }
};

const readModDetailsBootstrap = (key: string): FluxoraModDetailsBootstrap | null => {
  if (!key) {
    return null;
  }

  const storageKey = modDetailsBootstrapStorageKey(key);
  try {
    const raw = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<FluxoraModDetailsBootstrap>;
    return parsed && typeof parsed.key === 'string' && parsed.item ? parsed as FluxoraModDetailsBootstrap : null;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
};

interface BuildSettingsBootstrap {
  key: string;
  draft: BuildPathDraft;
  executables: FluxoraExecutable[];
  project: FluxoraProject;
}

const buildSettingsBootstrapStoragePrefix = 'fluxora.build-settings.bootstrap.';

const buildSettingsBootstrapStorageKey = (key: string): string =>
  `${buildSettingsBootstrapStoragePrefix}${encodeURIComponent(key)}`;

const writeBuildSettingsBootstrap = (bootstrap: BuildSettingsBootstrap): void => {
  try {
    window.localStorage.setItem(
      buildSettingsBootstrapStorageKey(bootstrap.key),
      JSON.stringify(bootstrap)
    );
  } catch {
    // Bootstrap is an optimization. The window can still load through the bridge.
  }
};

const readBuildSettingsBootstrap = (key: string): BuildSettingsBootstrap | null => {
  if (!key) {
    return null;
  }

  const storageKey = buildSettingsBootstrapStorageKey(key);
  try {
    const raw = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<BuildSettingsBootstrap>;
    const project = parsed.project as Partial<FluxoraProject> | undefined;
    const draft = parsed.draft as Partial<BuildPathDraft> | undefined;
    return parsed &&
      parsed.key === key &&
      project &&
      typeof project.configPath === 'string' &&
      draft &&
      typeof draft.projectDirectory === 'string'
      ? {
          key,
          draft: draft as BuildPathDraft,
          executables: Array.isArray(parsed.executables) ? parsed.executables : [],
          project: project as FluxoraProject
        }
      : null;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
};

const effectiveFileTreeSourceLabel = (entry: FluxoraEffectiveFileTreeEntry): string => {
  if (entry.sourceKind === 'game') {
    return 'Game';
  }
  if (entry.sourceKind === 'overwrite') {
    return 'Overwrite';
  }
  if (entry.sourceKind === 'mod') {
    return entry.sourceName;
  }
  return '';
};

const effectiveVirtualPathLabel = (entry: FluxoraEffectiveFileTreeEntry): string =>
  entry.virtualPath || entry.relativePath || 'Game root';

const modConflictMarkerLabels: Record<ModConflictMarkerState, string> = {
  overwrites: 'Перезаписывает',
  overwritten: 'Перезаписывается',
  'fully-overwritten': 'Полностью перезаписан'
};

const modConflictMarkerTitle = (states: ModConflictMarkerState[]): string =>
  states.map((state) => modConflictMarkerLabels[state]).join(' · ');

function MenuIcon({ source }: { source: string }) {
  return (
    <span
      aria-hidden="true"
      className="mod-row-menu__icon"
      style={{ '--menu-icon': `url("${source}")` } as MenuIconStyle}
    />
  );
}

function AssetIcon({ source }: { source: string }) {
  return (
    <span
      aria-hidden="true"
      className="asset-icon"
      style={{ '--asset-icon': `url("${source}")` } as AssetIconStyle}
    />
  );
}

function ModConflictMarkers({
  className,
  states
}: {
  className?: string;
  states: ModConflictMarkerState[];
}) {
  if (states.length === 0) {
    return null;
  }

  return (
    <span
      aria-label={modConflictMarkerTitle(states)}
      className={['mod-conflict-markers', className].filter(Boolean).join(' ')}
      role="group"
      title={modConflictMarkerTitle(states)}
    >
      {states.map((state) => (
        <StatusDot
          className="mod-conflict-marker-dot"
          key={state}
          label={modConflictMarkerLabels[state]}
          size={18}
          state={state}
          title={modConflictMarkerLabels[state]}
        />
      ))}
    </span>
  );
}

const navItems: Array<{ id: RouteId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'build', label: 'Build', icon: Layers }
];

const modDetailsTabs: Array<{ id: ModDetailsTabId; label: string; icon: string }> = [
  { id: 'files', label: 'Файлы', icon: modDetailsFilesIcon },
  { id: 'conflicts', label: 'Конфликты', icon: modDetailsConflictsIcon }
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
  { id: 'downloads', label: 'Загрузки', icon: Download }
];

const openingBuildMessages = [
  'Загружаем вашу сборку',
  'Смотрим плагины',
  'Проверяем профиль',
  'Готовим рабочее пространство',
  'Еще чуть-чуть'
] as const;

const overwriteClearMessages = [
  'Очищаем override',
  'Удаляем временные файлы',
  'Обновляем список модов',
  'Почти готово'
] as const;

const rendererBuildDate =
  typeof import.meta.env.VITE_FLUXORA_BUILD_DATE === 'string'
    ? import.meta.env.VITE_FLUXORA_BUILD_DATE
    : '';

const projectMatchesSelection = (project: FluxoraProject, selection: string): boolean =>
  project.id === selection ||
  project.configPath === selection ||
  project.projectDirectory === selection;

const modRowHeight = 48;
const modVisibleRows = 28;
const modOverscanRows = 8;
const pluginRowHeight = 48;
const pluginVisibleRows = 28;
const pluginOverscanRows = 8;
const modLoadingSkeletonRows = Array.from({ length: 10 }, (_, index) => index);
const pluginLoadingSkeletonRows = Array.from({ length: 10 }, (_, index) => index);
const effectiveFileTreeSkeletonRows = Array.from({ length: 14 }, (_, index) => index);
const loadingSkeletonWidths = ['72%', '58%', '66%', '48%', '62%'] as const;
const downloadRowHeight = 48;
const downloadVisibleRows = 28;
const downloadOverscanRows = 8;
const DOWNLOAD_PROGRESS_REFRESH_INTERVAL_MS = 500;
const downloadSkeletonRows = [
  {
    id: 'skyui',
    titleWidth: 68,
    progressWidth: 46,
    barWidth: 78,
    sizeWidth: 42,
    sourceWidth: 62
  },
  {
    id: 'fomod',
    titleWidth: 84,
    progressWidth: 38,
    barWidth: 100,
    sizeWidth: 56,
    sourceWidth: 74
  },
  {
    id: 'textures',
    titleWidth: 74,
    progressWidth: 54,
    barWidth: 64,
    sizeWidth: 48,
    sourceWidth: 58
  },
  {
    id: 'weather',
    titleWidth: 58,
    progressWidth: 42,
    barWidth: 86,
    sizeWidth: 52,
    sourceWidth: 70
  },
  {
    id: 'animations',
    titleWidth: 77,
    progressWidth: 50,
    barWidth: 72,
    sizeWidth: 46,
    sourceWidth: 64
  },
  {
    id: 'ui',
    titleWidth: 63,
    progressWidth: 36,
    barWidth: 94,
    sizeWidth: 58,
    sourceWidth: 78
  },
  {
    id: 'lod',
    titleWidth: 88,
    progressWidth: 48,
    barWidth: 58,
    sizeWidth: 44,
    sourceWidth: 60
  },
  {
    id: 'audio',
    titleWidth: 70,
    progressWidth: 44,
    barWidth: 82,
    sizeWidth: 54,
    sourceWidth: 68
  },
  {
    id: 'patches',
    titleWidth: 80,
    progressWidth: 40,
    barWidth: 76,
    sizeWidth: 50,
    sourceWidth: 66
  },
  {
    id: 'landscape',
    titleWidth: 61,
    progressWidth: 52,
    barWidth: 90,
    sizeWidth: 40,
    sourceWidth: 72
  },
  {
    id: 'npc',
    titleWidth: 73,
    progressWidth: 34,
    barWidth: 68,
    sizeWidth: 62,
    sourceWidth: 56
  },
  {
    id: 'quests',
    titleWidth: 66,
    progressWidth: 56,
    barWidth: 96,
    sizeWidth: 46,
    sourceWidth: 76
  }
] as const;
const projectMenuWidth = 174;
const projectMenuEstimatedHeight = 116;
const projectMenuViewportPadding = 8;
const rowContextMenuWidth = 224;
const rowContextMenuEstimatedHeight = 268;
const rowContextMenuItemHeight = 30;
const rowContextMenuPaddingY = 12;
const rowContextMenuViewportPadding = 8;
const rowReorderDragThreshold = 5;
const rowReorderAutoScrollEdge = 36;
const rowReorderAutoScrollMaxStep = 18;
const downloadInstallDragType = 'application/x-fluxora-download-id';
const pluginMissingMasterStatusLimit = 20;
const backgroundReorderLoadOptions: WorkspaceLoadOptions = {
  resetScroll: false,
  showBusy: false,
  showLoading: false
};

const fileUriToPath = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') {
      return value;
    }

    const pathName = decodeURIComponent(url.pathname);
    const windowsPath = pathName.match(/^\/[a-zA-Z]:/) ? pathName.slice(1) : pathName;
    return windowsPath.replace(/\//g, '\\');
  } catch {
    return value;
  }
};

const normalizeDownloadDropPaths = (paths: readonly string[]): string[] =>
  Array.from(
    new Set(
      paths
        .map((path) => fileUriToPath(path.trim()))
        .filter((path) => path.length > 0 && !path.startsWith('#'))
    )
  );

const dataTransferText = (dataTransfer: DataTransfer, type: string): string => {
  try {
    return dataTransfer.getData(type);
  } catch {
    return '';
  }
};

const downloadDropPathsFromDataTransfer = (dataTransfer: DataTransfer): string[] =>
  normalizeDownloadDropPaths(
    [
      dataTransferText(dataTransfer, 'text/uri-list'),
      dataTransferText(dataTransfer, 'text/plain')
    ].flatMap((value) => value.split(/\r?\n/))
  );

const isPointInsideRect = (x: number, y: number, rect: DOMRect): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

const isFileDropPositionInsideRect = (
  position: { x: number; y: number },
  rect: DOMRect
): boolean => {
  if (isPointInsideRect(position.x, position.y, rect)) {
    return true;
  }

  const scale = window.devicePixelRatio || 1;
  return scale !== 1 && isPointInsideRect(position.x / scale, position.y / scale, rect);
};

const pluginWorkspaceContextKey = (project: FluxoraProject, profileName: string): string =>
  `${project.projectDirectory}\u0000${project.templateId}\u0000${profileName}`;

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

const rowContextMenuPositionFromPreferredPoint = (
  preferredLeft: number,
  preferredTop: number,
  estimatedHeight = rowContextMenuEstimatedHeight
): RowContextMenuPosition => {
  const maxLeft = Math.max(
    rowContextMenuViewportPadding,
    window.innerWidth - rowContextMenuWidth - rowContextMenuViewportPadding
  );
  const maxTop = Math.max(
    rowContextMenuViewportPadding,
    window.innerHeight - estimatedHeight - rowContextMenuViewportPadding
  );
  const left = Math.max(rowContextMenuViewportPadding, Math.min(preferredLeft, maxLeft));
  const top = Math.max(rowContextMenuViewportPadding, Math.min(preferredTop, maxTop));

  return {
    left,
    top,
    maxHeight: Math.max(
      64,
      Math.min(estimatedHeight, window.innerHeight - top - rowContextMenuViewportPadding)
    )
  };
};

const rowContextMenuPositionFromPointer = (
  clientX: number,
  clientY: number,
  estimatedHeight?: number
): RowContextMenuPosition => rowContextMenuPositionFromPreferredPoint(clientX, clientY, estimatedHeight);

const rowContextMenuPositionFromAnchor = (
  anchor: DOMRect,
  estimatedHeight?: number
): RowContextMenuPosition =>
  rowContextMenuPositionFromPreferredPoint(
    anchor.right - rowContextMenuWidth,
    anchor.top + 8,
    estimatedHeight
  );

const downloadRowMenuEstimatedHeight = (entry: FluxoraDownloadEntry): number => {
  const itemCount = 3 + (entry.isDownloading ? 1 : 0) + (entry.canResume ? 1 : 0);
  return rowContextMenuPaddingY + itemCount * rowContextMenuItemHeight;
};

const isInteractiveRowDragTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest('button, input, label, select, textarea, a, [role="button"], [data-no-row-drag="true"]')
  );
};

const isEditableShortcutTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const rowDropPlacementFromPointer = (
  row: HTMLElement,
  pointerY: number
): RowDropPlacement => {
  const rect = row.getBoundingClientRect();
  return pointerY < rect.top + rect.height / 2 ? 'before' : 'after';
};

export const App = () => {
  const windowParameters = useMemo(() => new URLSearchParams(window.location.search), []);
  const windowMode = windowParameters.get('window');
  const isSettingsWindow = windowMode === 'settings';
  const isBuildSettingsWindow = windowMode === 'build-settings';
  const isModDetailsWindow = windowMode === 'mod-details';
  const isTextEditorWindow = windowMode === 'text-editor';
  const isFilePreviewWindow = windowMode === 'file-preview';
  const isSecondaryWindow =
    isSettingsWindow ||
    isBuildSettingsWindow ||
    isModDetailsWindow ||
    isTextEditorWindow ||
    isFilePreviewWindow;
  const buildSettingsProjectId = windowParameters.get('project');
  const buildSettingsInitialName = windowParameters.get('name')?.trim() ?? '';
  const initialBuildSettingsBootstrap = useMemo(
    () => (isBuildSettingsWindow ? readBuildSettingsBootstrap(buildSettingsProjectId ?? '') : null),
    [buildSettingsProjectId, isBuildSettingsWindow]
  );
  const modDetailsProjectId = windowParameters.get('project');
  const modDetailsModId = windowParameters.get('mod')?.trim() ?? '';
  const modDetailsInitialName = windowParameters.get('name')?.trim() ?? '';
  const modDetailsProfileName = windowParameters.get('profile')?.trim() ?? '';
  const modDetailsBootstrapKey = windowParameters.get('bootstrap')?.trim() ?? '';
  const initialModDetailsBootstrap = useMemo(
    () => (isModDetailsWindow ? readModDetailsBootstrap(modDetailsBootstrapKey) : null),
    [isModDetailsWindow, modDetailsBootstrapKey]
  );
  const textEditorProjectId = windowParameters.get('project');
  const textEditorModId = windowParameters.get('mod')?.trim() ?? '';
  const textEditorInitialPath = windowParameters.get('path')?.trim() ?? '';
  const textEditorInitialName = windowParameters.get('name')?.trim() ?? '';
  const filePreviewProjectId = windowParameters.get('project');
  const filePreviewModId = windowParameters.get('mod')?.trim() ?? '';
  const filePreviewInitialPath = windowParameters.get('path')?.trim() ?? '';
  const filePreviewInitialName = windowParameters.get('name')?.trim() ?? '';
  const filePreviewProfileName = windowParameters.get('profile')?.trim() ?? '';
  const filePreviewKind = windowParameters.get('kind')?.trim() ?? 'nif';
  const [activeRoute, setActiveRoute] = useState<RouteId>(() =>
    isSettingsWindow
      ? 'settings'
      : isModDetailsWindow || isTextEditorWindow || isFilePreviewWindow
        ? 'mods'
        : 'home'
  );
  const [appInfo, setAppInfo] = useState<FluxoraAppInfo | null>(null);
  const [securityState, setSecurityState] = useState<FluxoraSecurityState | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<NativeBridgeStatus | null>(null);
  const [catalog, setCatalog] = useState(projectCatalogFallback);
  const [projects, setProjects] = useState<FluxoraProject[]>(() =>
    initialBuildSettingsBootstrap?.project ? [initialBuildSettingsBootstrap.project] : []
  );
  const [templates, setTemplates] = useState<FluxoraGameTemplate[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    isBuildSettingsWindow ? buildSettingsProjectId : null
  );
  const [loadedWorkspaceProjectId, setLoadedWorkspaceProjectId] = useState<string | null>(null);
  const [projectOpenCommitSequence, setProjectOpenCommitSequence] = useState(0);
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [projectMenuPosition, setProjectMenuPosition] = useState<ProjectMenuPosition | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>('idle');
  const [searchText, setSearchText] = useState('');
  const [templateSearchText, setTemplateSearchText] = useState('');
  const [, setMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [aiChat, dispatchAiChat] = useReducer(aiChatReducer, initialAiChatState);
  const [aiHostStatus, setAiHostStatus] = useState<FluxoraAiHostStatus | null>(null);
  const [aiChatSettings, setAiChatSettings] = useState<AiChatSettings>(() =>
    loadAiChatSettings(window.localStorage)
  );
  const activeAiRunRef = useRef<ActiveAiRunControl | null>(null);
  const [openingBuildSplash, setOpeningBuildSplash] =
    useState<OpeningBuildSplashState | null>(null);
  const [isOpeningBuildLocked, setIsOpeningBuildLocked] = useState(false);
  const openingBuildCancelRequestsRef = useRef<Set<string>>(new Set());
  const openingBuildOperationIdRef = useRef<string | null>(null);
  const pendingProjectOpenTimingRef = useRef<{
    projectId: string;
    project: FluxoraProject;
    timing: ProjectOpenTiming;
  } | null>(null);
  const projectOpenExactWorkspaceRef = useRef<{
    contentRevision: number;
    invalidationsSettledAtStart: boolean;
    operationId: string;
    projectId: string;
    watchGeneration: number;
    watchKey: string | null;
  } | null>(null);
  const coordinatedWorkspaceLoadRef = useRef<{ projectId: string; sequence: number } | null>(null);
  const coordinatedWorkspaceLoadSequenceRef = useRef(0);
  const buildContentRefreshCoordinator = useMemo(createTrailingRefreshCoordinator, []);
  const pendingBuildContentModPaths = useMemo(createPendingPathAccumulator, []);
  const buildContentEventSequences = useMemo(createScopedSequenceTracker, []);
  const buildContentWatchKeyRef = useRef<string | null>(null);
  const buildContentWatchPromiseRef = useRef<Promise<void> | null>(null);
  const buildContentWatchGenerationRef = useRef(0);
  const buildContentEventRevisionRef = useRef(0);
  const buildContentObservedRevisionByScopeRef = useRef(new Map<string, number>());
  const buildContentInvalidatedRevisionByScopeRef = useRef(new Map<string, number>());
  const exactWorkspaceWatchCoverageRef = useRef<{
    contentRevision: number;
    watchGeneration: number;
    watchKey: string;
  } | null>(null);
  const selectedProjectDirectoryRef = useRef<string | null>(null);
  const selectedWorkspaceScopeRef = useRef<{
    profileName: string;
    project: FluxoraProject | null;
  }>({ profileName: '', project: null });
  const openingBuildPreviousViewRef = useRef<{
    buildPathEditor: BuildPathEditorSnapshot;
    profileName: string;
    route: RouteId;
    selectedExecutableId: string | null;
    selectedProjectId: string | null;
    loadedWorkspaceProjectId: string | null;
  } | null>(null);
  const pendingBuildPathEditorRestoreRef = useRef<{
    selectedProjectId: string | null;
    snapshot: BuildPathEditorSnapshot;
  } | null>(null);
  const [overwriteClearSplash, setOverwriteClearSplash] =
    useState<OverwriteClearSplashState | null>(null);
  const overwriteClearOperationIdRef = useRef<string | null>(null);
  const [languageBusy, setLanguageBusy] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<FluxoraThemeMode>('dark');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('connections');
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(() =>
    loadDeveloperModeSetting(window.localStorage)
  );
  const [settingsBusyLabel, setSettingsBusyLabel] = useState<string | null>(null);
  const [nexusStatus, setNexusStatus] = useState<NexusAuthViewStatus>(() =>
    loadCachedNexusAuthStatus(window.localStorage)
  );
  const [nexusBusy, setNexusBusy] = useState(false);
  const [apiLimitProviders, setApiLimitProviders] = useState<FluxoraApiLimitProvider[]>([]);
  const [apiLimitsBusy, setApiLimitsBusy] = useState(false);
  const nxmAutoRegistrationAttemptedRef = useRef(false);
  const pendingInboundNxmEventRef = useRef<FluxoraNxmInboundLinksCaptured | null>(null);
  const [transferSourceDirectory, setTransferSourceDirectory] = useState('');
  const [transferDestinationRootDirectory, setTransferDestinationRootDirectory] = useState('');
  const [transferStep, setTransferStep] = useState<TransferStepId>('source');
  const [transferDestinationDrives, setTransferDestinationDrives] = useState<FluxoraTransferDriveOption[]>([]);
  const [transferDriveState, setTransferDriveState] = useState<TransferDriveListState>('idle');
  const [transferAnalysis, setTransferAnalysis] =
    useState<FluxoraModOrganizerImportAnalysis | null>(null);
  const [transferProgress, setTransferProgress] =
    useState<FluxoraModOrganizerImportProgress | null>(null);
  const [transferRunningOperationId, setTransferRunningOperationId] = useState<string | null>(null);
  const transferRunningOperationIdRef = useRef<string | null>(null);
  const transferAnalysisRequestRef = useRef<{
    key: string;
    promise: Promise<FluxoraModOrganizerImportAnalysis | null>;
  } | null>(null);
  const [transferCancelRequested, setTransferCancelRequested] = useState(false);
  const [transferResult, setTransferResult] = useState<FluxoraProject | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const chromePlatform = appInfo?.platform ?? bridgeStatus?.capabilities?.platform ?? 'unknown';
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
  const [modMenuPosition, setModMenuPosition] = useState<RowContextMenuPosition | null>(null);
  const [modsToolbarMenuPosition, setModsToolbarMenuPosition] =
    useState<RowContextMenuPosition | null>(null);
  const [modCreationDialog, setModCreationDialog] = useState<ModCreationDialogState | null>(null);
  const [modListScrollTop, setModListScrollTop] = useState(0);
  const [draggedModOrderId, setDraggedModOrderId] = useState<string | null>(null);
  const [modDropTarget, setModDropTarget] = useState<RowDropTargetState | null>(null);
  const [downloadInstallDropTarget, setDownloadInstallDropTarget] =
    useState<RowDropTargetState | null>(null);
  const [fileTreeCache, setFileTreeCache] = useState<Record<string, FluxoraModFileTreeEntry[]>>(
    () => {
      if (initialModDetailsBootstrap?.rootFileTree) {
        return { '': initialModDetailsBootstrap.rootFileTree };
      }

      return {} as Record<string, FluxoraModFileTreeEntry[]>;
    }
  );
  const [expandedFileTree, setExpandedFileTree] = useState<Record<string, boolean>>({});
  const [fileTreeState, setFileTreeState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [fileTreeLoadingPath, setFileTreeLoadingPath] = useState<string | null>(null);
  const [effectiveFileTreeSnapshot, setEffectiveFileTreeSnapshot] =
    useState<FluxoraEffectiveFileTreeSnapshot | null>(null);
  const effectiveFileTreeSnapshotRef = useRef<FluxoraEffectiveFileTreeSnapshot | null>(null);
  const effectiveFileTreeCacheRef = useRef<Record<string, FluxoraEffectiveFileTreeSnapshot>>({});
  const effectiveFileTreeInFlightRequestKeyRef = useRef<string | null>(null);
  const effectiveFileTreeLoadedRequestKeyRef = useRef<string | null>(null);
  const effectiveFileTreeFailedRequestKeyRef = useRef<string | null>(null);
  const effectiveFileTreeRequestSequenceRef = useRef(0);
  const effectiveFileTreeLoadingChildrenRef = useRef<Set<string>>(new Set());
  const [effectiveFileTreeState, setEffectiveFileTreeState] = useState<
    'idle' | 'refreshing' | 'ready' | 'error'
  >('idle');
  const [effectiveFileTreeError, setEffectiveFileTreeError] = useState<string | null>(null);
  const [effectiveFileTreeLoadingChildren, setEffectiveFileTreeLoadingChildren] = useState<
    Record<string, boolean>
  >({});
  const [expandedEffectiveFileTree, setExpandedEffectiveFileTree] = useState<Record<string, boolean>>({
    '': true,
    Data: true
  });
  const [effectiveFileTreeScrollTop, setEffectiveFileTreeScrollTop] = useState(0);
  const [modDetailsSummary, setModDetailsSummary] = useState<FluxoraModOrderItem | null>(
    () => initialModDetailsBootstrap?.item ?? null
  );
  const [modDetailsConflictPage, setModDetailsConflictPage] =
    useState<FluxoraModConflictTreePage | null>(null);
  const [modDetailsTab, setModDetailsTab] = useState<ModDetailsTabId>('files');
  const [modDetailsConflictScanState, setModDetailsConflictScanState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  effectiveFileTreeSnapshotRef.current = effectiveFileTreeSnapshot;
  const [pluginsWorkspace, dispatchPluginsWorkspace] = useReducer(
    pluginWorkspaceReducer,
    undefined,
    emptyPluginWorkspaceState
  );
  const [pluginsBusyLabel, setPluginsBusyLabel] = useState<string | null>(null);
  const [pluginMenuOrderId, setPluginMenuOrderId] = useState<string | null>(null);
  const [pluginMenuPosition, setPluginMenuPosition] =
    useState<RowContextMenuPosition | null>(null);
  const [pluginListScrollTop, setPluginListScrollTop] = useState(0);
  const [draggedPluginOrderId, setDraggedPluginOrderId] = useState<string | null>(null);
  const [pluginDropTarget, setPluginDropTarget] = useState<RowDropTargetState | null>(null);
  const [downloadsWorkspace, dispatchDownloadsWorkspace] = useReducer(
    downloadWorkspaceReducer,
    undefined,
    emptyDownloadWorkspaceState
  );
  const [downloadsBusyLabel, setDownloadsBusyLabel] = useState<string | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [downloadMenuPosition, setDownloadMenuPosition] =
    useState<RowContextMenuPosition | null>(null);
  const [downloadListScrollTop, setDownloadListScrollTop] = useState(0);
  const [downloadDropCue, setDownloadDropCueState] = useState<DownloadDropCue>('idle');
  const [draggedDownloadInstallId, setDraggedDownloadInstallId] = useState<string | null>(null);
  const downloadDropCueRef = useRef<DownloadDropCue>('idle');
  const downloadDropSurfaceRef = useRef<HTMLDivElement | null>(null);
  const downloadDropResetRef = useRef<number | null>(null);
  const downloadProgressRefreshInFlightRef = useRef(false);
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
  const installAnalysisPromiseRef = useRef<Promise<InstallAnalysisResult> | null>(null);
  const installSubmitInFlightRef = useRef<string | null>(null);
  const [isBuildPathsOpen, setIsBuildPathsOpen] = useState(false);
  const [buildPathDraft, setBuildPathDraft] = useState<BuildPathDraft>(() =>
    initialBuildSettingsBootstrap?.draft ??
    emptyBuildPathDraft(initialBuildSettingsBootstrap?.project ?? null)
  );
  const [buildPathExecutables, setBuildPathExecutables] = useState<FluxoraExecutable[]>(
    () =>
      initialBuildSettingsBootstrap?.executables ??
      initialBuildSettingsBootstrap?.project.executables ??
      []
  );
  const [buildPathsBusyLabel, setBuildPathsBusyLabel] = useState<string | null>(null);
  const [buildPathsError, setBuildPathsError] = useState<string | null>(null);
  const [fluxPackSummary, setFluxPackSummary] = useState<FluxoraFluxPackSummary | null>(null);
  const [fluxPackPackageType, setFluxPackPackageType] =
    useState<FluxoraFluxPackPackageType>('recipe');
  const [fluxPackExportPath, setFluxPackExportPath] = useState<string | null>(null);
  const [fluxPackInstallConflict, setFluxPackInstallConflict] =
    useState<FluxPackInstallConflictState | null>(null);
  const [fluxPackManualDownload, setFluxPackManualDownload] =
    useState<FluxPackManualDownloadState | null>(null);
  const [fluxPackInstallResult, setFluxPackInstallResult] =
    useState<FluxoraFluxPackInstallResult | null>(null);
  const [operationOverlay, setOperationOverlay] = useState<OperationOverlayState | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] =
    useState<DeletionConfirmationRequest | null>(null);
  const [grassCacheConfirmationOpen, setGrassCacheConfirmationOpen] = useState(false);
  const createCancelRequestsRef = useRef<Set<string>>(new Set());
  const refreshInFlightRef = useRef(false);
  const refreshCurrentViewRef = useRef<() => void | Promise<void>>(() => undefined);
  const rowReorderSessionRef = useRef<RowReorderSession | null>(null);
  const modOrderSaveSequenceRef = useRef(0);
  const pendingModOrderSavesRef = useRef<Set<Promise<void>>>(new Set());
  const modEnableSaveSequenceRef = useRef(0);
  const latestModEnableSequenceByOrderIdRef = useRef<Map<string, number>>(new Map());
  const modBulkEnableSequenceRef = useRef(0);
  const pluginOrderSaveSequenceRef = useRef(0);
  const pendingPluginOrderSavesRef = useRef<Set<Promise<void>>>(new Set());
  const pluginEnableSaveSequenceRef = useRef(0);
  const latestPluginEnableSequenceByOrderIdRef = useRef<Map<string, number>>(new Map());
  const pendingPluginEnableStatesByOrderIdRef =
    useRef<Map<string, PendingPluginEnableSave>>(new Map());
  const suppressNextRowClickRef = useRef(false);
  const buildPathDraftDirtyRef = useRef(false);
  const workspaceStoreLoadSequenceRef = useRef<Record<WorkspaceStoreId, number>>({
    downloads: 0,
    executables: 0,
    mods: 0,
    plugins: 0,
    profiles: 0
  });
  const workspaceStoreBusyLoadSequenceRef = useRef<
    Record<WorkspaceStoreId, number | null>
  >({
    downloads: null,
    executables: null,
    mods: null,
    plugins: null,
    profiles: null
  });
  const canBeginWorkspaceStoreLoad = (options: WorkspaceLoadOptions): boolean => {
    const coordinatedLoad = coordinatedWorkspaceLoadRef.current;
    return (
      !coordinatedLoad || options.coordinatedSequence === coordinatedLoad.sequence
    );
  };
  const beginWorkspaceStoreLoad = (store: WorkspaceStoreId): number => {
    const nextSequence = workspaceStoreLoadSequenceRef.current[store] + 1;
    workspaceStoreLoadSequenceRef.current[store] = nextSequence;
    return nextSequence;
  };
  const isCurrentWorkspaceStoreLoad = (
    store: WorkspaceStoreId,
    sequence: number
  ): boolean => workspaceStoreLoadSequenceRef.current[store] === sequence;
  const buildSettingsLoadedProjectRef = useRef<string | null>(null);
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
  selectedProjectDirectoryRef.current = selectedProject?.projectDirectory ?? null;
  const aiSessionScope = useMemo(
    () => ({
      buildLabel: selectedProject?.name,
      configPath: selectedProject?.configPath,
      projectDirectory: selectedProject?.projectDirectory,
      projectId: selectedProject?.id
    }),
    [
      selectedProject?.configPath,
      selectedProject?.id,
      selectedProject?.name,
      selectedProject?.projectDirectory
    ]
  );
  const windowTitle = useMemo(() => {
    if (isBuildSettingsWindow) {
      return `Settings · ${selectedProject?.name ?? (buildSettingsInitialName || 'Build')}`;
    }

    if (isModDetailsWindow) {
      return `Mod · ${modDetailsInitialName || 'Details'}`;
    }

    if (isTextEditorWindow) {
      return `Editor · ${textEditorInitialName || 'Text file'}`;
    }

    if (isFilePreviewWindow) {
      return `Preview · ${filePreviewInitialName || 'File'}`;
    }

    return isSettingsWindow ? 'Settings' : 'Fluxora';
  }, [
    buildSettingsInitialName,
    filePreviewInitialName,
    isFilePreviewWindow,
    isBuildSettingsWindow,
    isModDetailsWindow,
    isSettingsWindow,
    isTextEditorWindow,
    modDetailsInitialName,
    selectedProject?.name,
    textEditorInitialName
  ]);

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
    () =>
      visibleModOrderItems(
        modsWorkspace.items,
        deferredModSearchText,
        modsWorkspace.collapsedSeparatorOrderIds
      ),
    [modsWorkspace.items, deferredModSearchText, modsWorkspace.collapsedSeparatorOrderIds]
  );

  const overwriteModItem = useMemo(
    () =>
      selectedProject?.paths?.overwriteDirectory
        ? createOverwriteOrderItem(
            selectedProject.name,
            selectedProject.paths.overwriteDirectory,
            bridgeStatus?.language
          )
        : null,
    [bridgeStatus?.language, selectedProject?.name, selectedProject?.paths?.overwriteDirectory]
  );

  const displayedModItems = useMemo(
    () => appendOverwriteOrderItem(filteredModItems, overwriteModItem, deferredModSearchText),
    [deferredModSearchText, filteredModItems, overwriteModItem]
  );

  const selectableModOrderIds = useMemo(
    () =>
      displayedModItems
        .filter((item) => !isModOverwriteItem(item))
        .map((item) => item.orderId),
    [displayedModItems]
  );

  const selectedModItem = useMemo(
    () => {
      if (modsWorkspace.selectedOrderId === overwriteModItem?.orderId) {
        return overwriteModItem;
      }

      return selectedModOrderItem(
        modsWorkspace.items,
        modsWorkspace.selectedOrderId,
        modsWorkspace.collapsedSeparatorOrderIds
      );
    },
    [
      modsWorkspace.items,
      modsWorkspace.selectedOrderId,
      modsWorkspace.collapsedSeparatorOrderIds,
      overwriteModItem
    ]
  );

  const selectedModDeletionItems = useMemo(
    () =>
      modsWorkspace.items.filter(
        (item) => item.isMod && modsWorkspace.selectedOrderIds.has(item.orderId)
      ),
    [modsWorkspace.items, modsWorkspace.selectedOrderIds]
  );

  const modDetailsConflictEntries = useMemo(() => {
    return {
      overwrites: modDetailsConflictPage?.overwrites ?? [],
      overwritten: modDetailsConflictPage?.overwritten ?? []
    };
  }, [modDetailsConflictPage]);

  const totalModCount = useMemo(
    () => modsWorkspace.items.filter((item) => item.isMod).length,
    [modsWorkspace.items]
  );

  const enabledModCount = useMemo(
    () => modsWorkspace.items.filter((item) => item.isMod && item.isEnabled).length,
    [modsWorkspace.items]
  );

  const filteredPluginItems = useMemo(
    () =>
      visiblePluginOrderItems(
        pluginsWorkspace.items,
        deferredPluginSearchText,
        pluginsWorkspace.collapsedSeparatorOrderIds
      ),
    [
      pluginsWorkspace.items,
      deferredPluginSearchText,
      pluginsWorkspace.collapsedSeparatorOrderIds
    ]
  );

  const selectablePluginOrderIds = useMemo(
    () => filteredPluginItems.map((item) => item.orderId),
    [filteredPluginItems]
  );

  const selectedPluginItem = useMemo(
    () =>
      selectedPluginOrderItem(
        pluginsWorkspace.items,
        pluginsWorkspace.selectedOrderId,
        pluginsWorkspace.collapsedSeparatorOrderIds
      ),
    [
      pluginsWorkspace.items,
      pluginsWorkspace.selectedOrderId,
      pluginsWorkspace.collapsedSeparatorOrderIds
    ]
  );

  const filteredDownloadItems = useMemo(
    () => filterDownloadEntries(downloadsWorkspace.items, deferredDownloadSearchText),
    [downloadsWorkspace.items, deferredDownloadSearchText]
  );

  const selectableDownloadIds = useMemo(
    () => filteredDownloadItems.map((entry) => entry.id),
    [filteredDownloadItems]
  );

  const selectedDownloadItem = useMemo(
    () => selectedDownloadEntry(downloadsWorkspace.items, downloadsWorkspace.selectedId),
    [downloadsWorkspace.items, downloadsWorkspace.selectedId]
  );

  const selectedDownloadDeletionEntries = useMemo(
    () =>
      downloadsWorkspace.items.filter(
        (entry) => entry.canDelete && downloadsWorkspace.selectedIds.has(entry.id)
      ),
    [downloadsWorkspace.items, downloadsWorkspace.selectedIds]
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
  selectedWorkspaceScopeRef.current = {
    profileName: selectedProjectProfileName,
    project: selectedProject
  };

  const modWorkspaceProfileName =
    isFilePreviewWindow && filePreviewProfileName
      ? filePreviewProfileName
      : isModDetailsWindow && modDetailsProfileName
      ? modDetailsProfileName
      : selectedProjectProfileName;

  const buildPathRevisionKey = useMemo(
    () =>
      [
        selectedProject?.projectDirectory ?? '',
        selectedProject?.paths?.gameDirectory ?? selectedProject?.gamePath ?? '',
        selectedProject?.paths?.modsDirectory ?? '',
        selectedProject?.paths?.profilesDirectory ?? '',
        selectedProject?.paths?.overwriteDirectory ?? ''
      ].join('\n'),
    [
      selectedProject?.gamePath,
      selectedProject?.paths?.gameDirectory,
      selectedProject?.paths?.modsDirectory,
      selectedProject?.paths?.overwriteDirectory,
      selectedProject?.paths?.profilesDirectory,
      selectedProject?.projectDirectory
    ]
  );

  const modOrderRevisionKey = useMemo(
    () =>
      modsWorkspace.items
        .map((item) =>
          [
            item.orderId,
            item.id,
            item.order,
            item.name,
            item.isEnabled ? '1' : '0',
            item.fileCount,
            item.overwrittenFileCount,
            item.overwritingFileCount
          ].join(':')
        )
        .join('|'),
    [modsWorkspace.items]
  );

  const effectiveFileTreeRequestKey = useMemo(
    () =>
      selectedProject
        ? [
            selectedProject.projectDirectory,
            selectedProjectProfileName,
            buildPathRevisionKey,
            modOrderRevisionKey
          ].join('\n')
        : '',
    [
      buildPathRevisionKey,
      modOrderRevisionKey,
      selectedProject,
      selectedProjectProfileName
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

  const enabledPluginSlotCounts = useMemo(() => {
    const counts = {
      enabled: 0,
      heavy: 0,
      light: 0
    };

    pluginsWorkspace.items.forEach((item) => {
      if (!item.isPlugin || !item.isEnabled) {
        return;
      }

      counts.enabled += 1;
      if (item.isLight) {
        counts.light += 1;
      } else {
        counts.heavy += 1;
      }
    });

    return counts;
  }, [pluginsWorkspace.items]);

  const selectedProjectRuntimeSummary = useMemo<ProjectRuntimeSummary | undefined>(() => {
    if (!loadedWorkspaceProjectId) {
      return undefined;
    }

    const modEntries =
      installedMods.length > 0
        ? installedMods
        : modsWorkspace.items.filter((item) => item.isMod);
    const hasModData = installedMods.length > 0 || modsWorkspace.loadState === 'ready';

    return {
      projectId: loadedWorkspaceProjectId,
      modCount: hasModData ? modEntries.length : undefined,
      disabledModCount: hasModData
        ? modEntries.filter((item) => !item.isEnabled).length
        : undefined,
      downloadsCount:
        downloadsWorkspace.loadState === 'ready' ? downloadsWorkspace.items.length : undefined
    };
  }, [
    downloadsWorkspace.items,
    downloadsWorkspace.loadState,
    installedMods,
    loadedWorkspaceProjectId,
    modsWorkspace.items,
    modsWorkspace.loadState
  ]);

  const selectedProjectLibraryStats = useMemo(
    () =>
      selectedProject
        ? buildProjectLibraryStats(selectedProject, selectedProjectRuntimeSummary)
        : null,
    [selectedProject, selectedProjectRuntimeSummary]
  );

  useEffect(() => {
    const pending = pendingProjectOpenTimingRef.current;
    if (!pending || pending.projectId !== loadedWorkspaceProjectId) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const current = pendingProjectOpenTimingRef.current;
      if (!current || current !== pending || current.projectId !== loadedWorkspaceProjectId) {
        return;
      }

      pendingProjectOpenTimingRef.current = null;
      const sample = current.timing.complete(current.projectId);
      void window.fluxora.ui
        .log({
          level: 'info',
          category: 'Performance',
          message: formatProjectOpenPerformanceMessage(sample),
          operationId: sample.operationId
        })
        .catch(() => undefined);
      void (async () => {
        if (selectedProjectDirectoryRef.current !== current.project.projectDirectory) {
          return;
        }
        await loadDownloadsWorkspace(current.project, {
          operationId: sample.operationId,
          resetScroll: true,
          showBusy: false,
          showLoading: true
        });
        if (selectedProjectDirectoryRef.current !== current.project.projectDirectory) {
          return;
        }
        const profileName = projectDefaultProfileName(current.project);
        const liveScope = selectedWorkspaceScopeRef.current;
        if (
          liveScope.project?.projectDirectory !== current.project.projectDirectory ||
          liveScope.profileName !== profileName
        ) {
          // A profile transition owns its own exact load. The open operation
          // must not let its original profile overwrite the now-visible one.
          return;
        }
        const watchKey = buildContentWatchKeyForProject(current.project, profileName);
        const watchPromise = buildContentWatchPromiseRef.current;
        if (
          watchKey === null ||
          buildContentWatchKeyRef.current !== watchKey ||
          watchPromise === null
        ) {
          return;
        }
        try {
          await watchPromise;
        } catch {
          return;
        }
        const watchedScope = selectedWorkspaceScopeRef.current;
        if (
          watchedScope.project?.projectDirectory !== current.project.projectDirectory ||
          watchedScope.profileName !== profileName ||
          buildContentWatchPromiseRef.current !== watchPromise ||
          buildContentWatchKeyRef.current !== watchKey
        ) {
          return;
        }
        const scopeKey = buildContentScopeKey(current.project.projectDirectory);
        const contentRevision =
          buildContentObservedRevisionByScopeRef.current.get(scopeKey) ?? 0;
        const invalidatedRevision =
          buildContentInvalidatedRevisionByScopeRef.current.get(scopeKey) ?? 0;
        const watchGeneration = buildContentWatchGenerationRef.current;
        const invalidationsSettled = invalidatedRevision >= contentRevision;
        const exactWorkspace = projectOpenExactWorkspaceRef.current;
        const exactWorkspacePreparedDuringOpen =
          exactWorkspace?.operationId === sample.operationId &&
          exactWorkspace.projectId === current.projectId &&
          exactWorkspace.watchKey === watchKey &&
          exactWorkspace.watchGeneration === watchGeneration &&
          exactWorkspace.contentRevision === contentRevision &&
          exactWorkspace.invalidationsSettledAtStart &&
          invalidationsSettled;
        const exactCoverage = exactWorkspaceWatchCoverageRef.current;
        const exactWorkspaceCoveredByWatcher =
          watchKey !== null &&
          buildContentWatchKeyRef.current === watchKey &&
          exactCoverage?.watchKey === watchKey &&
          exactCoverage.watchGeneration === watchGeneration &&
          exactCoverage.contentRevision === contentRevision &&
          invalidationsSettled;
        if (exactWorkspacePreparedDuringOpen) {
          projectOpenExactWorkspaceRef.current = null;
        }
        // Never start an exact read while an older invalidation is unresolved.
        // Such a read can observe the stale cache immediately before the
        // invalidation clears it, then return after the revision looks settled.
        // The event coordinator owns the exact read that follows invalidation.
        if (!invalidationsSettled) {
          return;
        }
        const reconciled = exactWorkspacePreparedDuringOpen || exactWorkspaceCoveredByWatcher
          ? true
          : await loadModsWorkspace(current.project, {
              operationId: sample.operationId,
              profileName,
              resetScroll: false,
              showBusy: false,
              showLoading: false
            });
        if (
          !reconciled ||
          selectedProjectDirectoryRef.current !== current.project.projectDirectory
        ) {
          return;
        }
        if (
          buildContentWatchGenerationRef.current !== watchGeneration ||
          selectedWorkspaceScopeRef.current.project?.projectDirectory !==
            current.project.projectDirectory ||
          selectedWorkspaceScopeRef.current.profileName !== profileName ||
          buildContentWatchPromiseRef.current !== watchPromise ||
          (buildContentObservedRevisionByScopeRef.current.get(scopeKey) ?? 0) !== contentRevision ||
          (buildContentInvalidatedRevisionByScopeRef.current.get(scopeKey) ?? 0) < contentRevision ||
          buildContentWatchKeyRef.current !== watchKey
        ) {
          return;
        }
        const pluginsReconciled = await loadPluginsWorkspace(current.project, {
          operationId: sample.operationId,
          profileName,
          resetScroll: false,
          showBusy: false,
          showLoading: false
        });
        if (
          !pluginsReconciled ||
          selectedProjectDirectoryRef.current !== current.project.projectDirectory ||
          buildContentWatchGenerationRef.current !== watchGeneration ||
          selectedWorkspaceScopeRef.current.profileName !== profileName ||
          buildContentWatchPromiseRef.current !== watchPromise ||
          (buildContentObservedRevisionByScopeRef.current.get(scopeKey) ?? 0) !== contentRevision ||
          (buildContentInvalidatedRevisionByScopeRef.current.get(scopeKey) ?? 0) < contentRevision ||
          buildContentWatchKeyRef.current !== watchKey
        ) {
          return;
        }
        exactWorkspaceWatchCoverageRef.current = {
          contentRevision,
          watchGeneration,
          watchKey
        };
        const backgroundSample = current.timing.completeBackground(current.projectId);
        await window.fluxora.ui.log({
          level: 'info',
          category: 'Performance',
          message: formatProjectOpenBackgroundPerformanceMessage(backgroundSample),
          operationId: backgroundSample.operationId
        });
      })().catch(() => undefined);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [loadedWorkspaceProjectId, projectOpenCommitSequence]);

  const buildProfileOptions = useMemo(() => {
    if (profilesWorkspace.items.length > 0) {
      return profilesWorkspace.items;
    }

    return selectedProjectProfileName ? [selectedProjectProfileName] : [];
  }, [profilesWorkspace.items, selectedProjectProfileName]);

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
  const showPluginMissingMastersStatus = useMemo(
    () => isSkyrimMissingMasterStatusProject(selectedProject),
    [selectedProject]
  );
  const disabledPluginSourceModNameKeys = useMemo(() => {
    const keys = new Set<string>();
    const addSourceModKey = (value: string | null | undefined) => {
      const key = pluginSourceModKey(value);
      if (key) {
        keys.add(key);
      }
    };

    modsWorkspace.items.forEach((item) => {
      if (item.isMod && !item.isEnabled) {
        addSourceModKey(modItemTitle(item));
      }
    });
    installedMods.forEach((mod) => {
      if (!mod.isEnabled) {
        addSourceModKey(mod.name);
      }
    });

    return keys;
  }, [installedMods, modsWorkspace.items]);
  const pluginMissingMasterContext = useMemo<PluginMissingMasterContext>(
    () => ({
      disabledSourceModNameKeys: disabledPluginSourceModNameKeys,
      enabledPluginNameKeys: enabledPluginNameKeys(
        pluginsWorkspace.items,
        disabledPluginSourceModNameKeys
      )
    }),
    [disabledPluginSourceModNameKeys, pluginsWorkspace.items]
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

  const grassCacheModEntries = useMemo(
    () =>
      installedMods.length > 0
        ? installedMods
        : modsWorkspace.items.filter((item) => item.isMod),
    [installedMods, modsWorkspace.items]
  );

  const grassCacheAction = useMemo(
    () => ngioGrassCacheActionView(selectedProject, grassCacheModEntries, bridgeStatus),
    [bridgeStatus, grassCacheModEntries, selectedProject]
  );

  const settingsCapabilities = useMemo(
    () => settingsCapabilityView(bridgeStatus),
    [bridgeStatus]
  );

  const rememberNexusStatus = (status: FluxoraNexusModsAuthStatus) => {
    setNexusStatus(createVerifiedNexusAuthStatus(status));
    saveCachedNexusAuthStatus(window.localStorage, status);
  };
  const rememberApiLimitProviders = (providers: FluxoraApiLimitProvider[]) => {
    setApiLimitProviders(providers);
  };
  const markNexusStatusChecking = () => {
    setNexusStatus((currentStatus) => createCheckingNexusAuthStatus(currentStatus));
  };
  const nexusVerifiedLinked = nexusIsVerifiedLinked(nexusStatus);

  const isTransferRunning = transferRunningOperationId !== null;
  const operationCancellationSupported =
    bridgeStatus?.capabilities?.features.operationCancellation?.state === 'available';
  const transferCancellationSupported = settingsCapabilities.transferCancellationAvailable;

  const visibleModWindow = useMemo(() => {
    return createVirtualWindow(displayedModItems, modListScrollTop, {
      rowHeight: modRowHeight,
      visibleRows: modVisibleRows,
      overscanRows: modOverscanRows
    });
  }, [displayedModItems, modListScrollTop]);

  const modConflictScrollbarMarkers = useMemo(() => {
    if (displayedModItems.length === 0) {
      return [];
    }

    return displayedModItems.flatMap((item, index) => {
      const highlight = modRowConflictHighlight(modsWorkspace.items, item, selectedModItem);
      const isCollapsedSeparator =
        item.isSeparator && modsWorkspace.collapsedSeparatorOrderIds.has(item.orderId);
      const states = item.isSeparator
        ? isCollapsedSeparator
          ? modConflictMarkerStatesForHighlight(highlight)
          : []
        : modConflictMarkerStatesForHighlight(highlight);

      return states.map((state, stateIndex) => ({
        key: `${item.orderId}:${state}`,
        state,
        offset: `${(stateIndex - (states.length - 1) / 2) * 4}px`,
        top: `${((index + 0.5) / displayedModItems.length) * 100}%`
      }));
    });
  }, [
    displayedModItems,
    modsWorkspace.collapsedSeparatorOrderIds,
    modsWorkspace.items,
    selectedModItem
  ]);

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

  const effectiveFileTreeChildren = useMemo(() => {
    const children = new Map<string, FluxoraEffectiveFileTreeEntry[]>();
    for (const entry of effectiveFileTreeSnapshot?.entries ?? []) {
      if (!entry.relativePath) {
        continue;
      }

      const siblings = children.get(entry.parentPath) ?? [];
      siblings.push(entry);
      children.set(entry.parentPath, siblings);
    }

    for (const siblings of children.values()) {
      siblings.sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
    }

    return children;
  }, [effectiveFileTreeSnapshot?.entries]);

  const effectiveFileTreeRows = useMemo<EffectiveFileTreeRow[]>(() => {
    const entries = effectiveFileTreeSnapshot?.entries ?? [];
    const rootEntry = entries.find((entry) => !entry.relativePath) ?? null;
    const rows: EffectiveFileTreeRow[] = [];

    const appendChildren = (parentPath: string, level: number) => {
      const children = effectiveFileTreeChildren.get(parentPath) ?? [];
      for (const entry of children) {
        rows.push({ entry, level });
        if (entry.isDirectory && expandedEffectiveFileTree[entry.relativePath]) {
          appendChildren(entry.relativePath, level + 1);
        }
      }
    };

    if (rootEntry) {
      rows.push({ entry: rootEntry, level: 1 });
      if (expandedEffectiveFileTree['']) {
        appendChildren('', 2);
      }
      return rows;
    }

    appendChildren('', 1);
    return rows;
  }, [effectiveFileTreeChildren, effectiveFileTreeSnapshot?.entries, expandedEffectiveFileTree]);

  const visibleEffectiveFileTreeWindow = useMemo(() => {
    return createVirtualWindow(effectiveFileTreeRows, effectiveFileTreeScrollTop, {
      rowHeight: 32,
      visibleRows: 38,
      overscanRows: 10
    });
  }, [effectiveFileTreeRows, effectiveFileTreeScrollTop]);

  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === activeRoute)?.label ?? 'Home',
    [activeRoute]
  );

  const loadCatalog = async (options: LoadCatalogOptions = {}) => {
    setCatalogState('loading');
    setMessage(null);

    try {
      const { catalog: nextCatalog, templates: nextTemplates } = await loadProjectCatalog();
      const mergedCatalog = options.mergeProject
        ? mergeProjectIntoCatalog(nextCatalog, options.mergeProject)
        : nextCatalog;
      const nextProjects = mergedCatalog.projects;

      setCatalog(mergedCatalog);
      setProjects(nextProjects);
      setTemplates(nextTemplates);
      setCatalogState('ready');
      setSelectedProjectId((current) => {
        const preferred = options.preferredProjectId ?? current;
        if (
          preferred &&
          nextProjects.some((project) => projectMatchesSelection(project, preferred))
        ) {
          return preferred;
        }

        return null;
      });
    } catch (error) {
      const nextMessage = errorMessage(error);
      const mergeProject = options.mergeProject;
      if (mergeProject) {
        setCatalog((current) => mergeProjectIntoCatalog(current, mergeProject));
        setProjects((current) => upsertProject(current, mergeProject));
        setSelectedProjectId(options.preferredProjectId ?? mergeProject.id);
        if (options.keepMergedProjectOnError) {
          setCatalogState('ready');
          return;
        }
      }
      setCatalogState('error');
      setMessage(nextMessage);
    }
  };

  const loadModsWorkspace = async (
    project = selectedProject,
    options: WorkspaceLoadOptions = {}
  ) => {
    if (!canBeginWorkspaceStoreLoad(options)) {
      return false;
    }
    const loadSequence = beginWorkspaceStoreLoad('mods');
    if (workspaceStoreBusyLoadSequenceRef.current.mods !== null) {
      workspaceStoreBusyLoadSequenceRef.current.mods = null;
      setModsBusyLabel(null);
    }
    if (!project || !bridgeStatus?.ready) {
      return false;
    }

    const hasCurrentRows = modsWorkspace.items.length > 0;
    const showBusy = options.showBusy ?? false;
    const showLoading = options.showLoading ?? !hasCurrentRows;
    const resetScroll = options.resetScroll ?? true;
    const operationId = options.operationId ?? createRendererOperationId('mods_load');
    const profileName = options.profileName ?? modWorkspaceProfileName;
    if (showLoading) {
      dispatchModsWorkspace({ type: 'load-started' });
    }
    if (showBusy) {
      workspaceStoreBusyLoadSequenceRef.current.mods = loadSequence;
      setModsBusyLabel('Loading mods');
      setMessage(null);
    }

    try {
      const getWorkspace = options.persistedSnapshot
        ? window.fluxora.mods.getPersistedWorkspace
        : window.fluxora.mods.getWorkspace;
      let { installedMods: nextInstalledMods, modOrder: nextOrder } =
        await getWorkspace(project.projectDirectory, profileName, { operationId });
      let usedExactFallback = false;
      let exactFallbackContentRevision = 0;
      let exactFallbackInvalidationsSettledAtStart = false;
      let exactFallbackWatchGeneration = -1;
      let exactFallbackWatchKey: string | null = null;

      if (
        options.persistedSnapshot &&
        (nextInstalledMods.length === 0 || nextOrder.length === 0)
      ) {
        if (!isCurrentWorkspaceStoreLoad('mods', loadSequence)) {
          return false;
        }
        exactFallbackContentRevision =
          buildContentObservedRevisionByScopeRef.current.get(
            buildContentScopeKey(project.projectDirectory)
          ) ?? 0;
        exactFallbackInvalidationsSettledAtStart =
          (buildContentInvalidatedRevisionByScopeRef.current.get(
            buildContentScopeKey(project.projectDirectory)
          ) ?? 0) >= exactFallbackContentRevision;
        exactFallbackWatchGeneration = buildContentWatchGenerationRef.current;
        exactFallbackWatchKey = buildContentWatchKeyForProject(project, profileName);
        ({ installedMods: nextInstalledMods, modOrder: nextOrder } =
          await window.fluxora.mods.getWorkspace(project.projectDirectory, profileName, {
            operationId
          }));
        usedExactFallback = true;
      }

      if (!isCurrentWorkspaceStoreLoad('mods', loadSequence)) {
        return false;
      }
      if (usedExactFallback) {
        projectOpenExactWorkspaceRef.current = {
          contentRevision: exactFallbackContentRevision,
          invalidationsSettledAtStart: exactFallbackInvalidationsSettledAtStart,
          operationId,
          projectId: project.id,
          watchGeneration: exactFallbackWatchGeneration,
          watchKey: exactFallbackWatchKey
        };
      }

      setInstalledMods(nextInstalledMods);
      dispatchModsWorkspace({ type: 'items-loaded', items: nextOrder });
      if (resetScroll) {
        setModListScrollTop(0);
      }
      setDraggedModOrderId(null);
      setModDropTarget(null);
      return true;
    } catch (error) {
      if (!isCurrentWorkspaceStoreLoad('mods', loadSequence)) {
        return false;
      }
      dispatchModsWorkspace({
        type: 'load-failed',
        message: errorMessage(error),
        silent: !showLoading
      });
      setMessage(errorMessage(error));
      return false;
    } finally {
      if (workspaceStoreBusyLoadSequenceRef.current.mods === loadSequence) {
        workspaceStoreBusyLoadSequenceRef.current.mods = null;
        setModsBusyLabel(null);
      }
    }
  };

  const loadModFileTree = async (
    relativeDirectory = '',
    item: FluxoraModOrderItem | null = selectedModItem
  ) => {
    const projectDirectory =
      selectedProject?.projectDirectory ?? initialModDetailsBootstrap?.projectDirectory ?? '';
    if (!projectDirectory || !item?.isMod) {
      return;
    }

    const operationId = createRendererOperationId('mods_file_tree');
    setFileTreeLoadingPath(relativeDirectory);
    setFileTreeState((current) => (relativeDirectory ? current : 'loading'));

    try {
      const entries = await window.fluxora.mods.getFileTree(
        projectDirectory,
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

  const loadEffectiveFileTreeChildren = async (
    entry: FluxoraEffectiveFileTreeEntry,
    snapshotOverride: FluxoraEffectiveFileTreeSnapshot | null = effectiveFileTreeSnapshot
  ) => {
    if (!selectedProject || !bridgeStatus?.ready || !entry.isDirectory || !entry.hasChildren) {
      return;
    }

    const snapshot = snapshotOverride;
    if (!snapshot?.revision) {
      return;
    }

    const hasLoadedChildren = snapshot.entries.some(
      (candidate) => candidate.parentPath === entry.relativePath && candidate.relativePath
    );
    if (hasLoadedChildren) {
      return;
    }

    const childKey = entry.relativePath || '__root__';
    if (effectiveFileTreeLoadingChildrenRef.current.has(childKey)) {
      return;
    }

    const operationId = createRendererOperationId('mods_effective_file_tree_children');
    effectiveFileTreeLoadingChildrenRef.current.add(childKey);
    setEffectiveFileTreeLoadingChildren((current) => ({ ...current, [childKey]: true }));
    setEffectiveFileTreeError(null);

    try {
      const page = await window.fluxora.mods.getEffectiveFileTreeChildren(
        selectedProject.projectDirectory,
        snapshot.profileName,
        snapshot.revision,
        entry.relativePath,
        undefined,
        250,
        { operationId }
      );
      setEffectiveFileTreeSnapshot((current) => {
        if (current?.revision && current.revision !== page.revision) {
          return current;
        }

        const nextSnapshot = mergeEffectiveFileTreePage(current ?? snapshot, page);
        effectiveFileTreeCacheRef.current[
          effectiveFileTreeCacheKey(selectedProject.projectDirectory, nextSnapshot.profileName)
        ] = nextSnapshot;
        effectiveFileTreeCacheRef.current[
          effectiveFileTreeRevisionCacheKey(
            selectedProject.projectDirectory,
            nextSnapshot.profileName,
            nextSnapshot.revision
          )
        ] = nextSnapshot;
        effectiveFileTreeSnapshotRef.current = nextSnapshot;
        return nextSnapshot;
      });
      setEffectiveFileTreeState('ready');
    } catch (error) {
      setEffectiveFileTreeState((current) =>
        effectiveFileTreeSnapshotRef.current ? current : 'error'
      );
      setEffectiveFileTreeError(errorMessage(error));
      setMessage(errorMessage(error));
    } finally {
      effectiveFileTreeLoadingChildrenRef.current.delete(childKey);
      setEffectiveFileTreeLoadingChildren((current) => {
        const next = { ...current };
        delete next[childKey];
        return next;
      });
    }
  };

  const loadEffectiveFileTree = async (
    project = selectedProject,
    profileName = selectedProjectProfileName,
    options: { force?: boolean; requestKey?: string } = {}
  ) => {
    if (!project || !bridgeStatus?.ready) {
      return;
    }

    const cacheKey = effectiveFileTreeCacheKey(project.projectDirectory, profileName);
    const requestKey = options.requestKey ?? cacheKey;
    const cachedSnapshot = effectiveFileTreeCacheRef.current[cacheKey];
    const currentSnapshot = effectiveFileTreeSnapshotRef.current;
    const dataTreeVisible =
      (activeRoute === 'build' || activeRoute === 'workspace') && activeRightPane === 'data';
    const canRefreshHiddenSnapshot = Boolean(currentSnapshot || cachedSnapshot);
    if (!dataTreeVisible && !canRefreshHiddenSnapshot) {
      return;
    }

    if (cachedSnapshot) {
      setEffectiveFileTreeSnapshot(cachedSnapshot);
      setEffectiveFileTreeState('ready');
      setEffectiveFileTreeError(null);
      if (!options.force && effectiveFileTreeLoadedRequestKeyRef.current === requestKey) {
        return;
      }
    } else if (!currentSnapshot) {
      setEffectiveFileTreeState('refreshing');
    }

    if (effectiveFileTreeInFlightRequestKeyRef.current === requestKey) {
      return;
    }

    if (!options.force && effectiveFileTreeFailedRequestKeyRef.current === requestKey) {
      return;
    }

    effectiveFileTreeInFlightRequestKeyRef.current = requestKey;
    const requestSequence = effectiveFileTreeRequestSequenceRef.current + 1;
    effectiveFileTreeRequestSequenceRef.current = requestSequence;
    const operationId = createRendererOperationId('mods_effective_file_tree');
    try {
      const page = await window.fluxora.mods.getEffectiveFileTreeRoot(
        project.projectDirectory,
        profileName,
        250,
        { operationId }
      );
      if (effectiveFileTreeRequestSequenceRef.current !== requestSequence) {
        return;
      }

      const previousSnapshot =
        effectiveFileTreeCacheRef.current[cacheKey] ?? effectiveFileTreeSnapshotRef.current;
      const snapshot =
        previousSnapshot?.revision === page.revision
          ? mergeEffectiveFileTreePage(previousSnapshot, page)
          : effectiveFileTreeSnapshotFromPage(page);
      effectiveFileTreeCacheRef.current[cacheKey] = snapshot;
      effectiveFileTreeCacheRef.current[
        effectiveFileTreeRevisionCacheKey(project.projectDirectory, profileName, snapshot.revision)
      ] = snapshot;
      effectiveFileTreeSnapshotRef.current = snapshot;
      setEffectiveFileTreeSnapshot(snapshot);
      setEffectiveFileTreeState('ready');
      setEffectiveFileTreeError(null);
      effectiveFileTreeLoadedRequestKeyRef.current = requestKey;
      if (effectiveFileTreeFailedRequestKeyRef.current === requestKey) {
        effectiveFileTreeFailedRequestKeyRef.current = null;
      }
      const dataEntry = snapshot.entries.find((entry) => entry.relativePath === 'Data');
      setExpandedEffectiveFileTree((current) => {
        const next = { ...current };
        let changed = false;
        if (next[''] === undefined) {
          next[''] = true;
          changed = true;
        }
        if (dataEntry && next[dataEntry.relativePath] === undefined) {
          next[dataEntry.relativePath] = true;
          changed = true;
        }
        return changed ? next : current;
      });
      if (dataEntry?.hasChildren) {
        void loadEffectiveFileTreeChildren(dataEntry, snapshot);
      }
    } catch (error) {
      effectiveFileTreeFailedRequestKeyRef.current = requestKey;
      setEffectiveFileTreeState((current) =>
        effectiveFileTreeSnapshotRef.current || cachedSnapshot || current === 'ready'
          ? 'ready'
          : 'error'
      );
      setEffectiveFileTreeError(errorMessage(error));
      setMessage(errorMessage(error));
    } finally {
      if (effectiveFileTreeInFlightRequestKeyRef.current === requestKey) {
        effectiveFileTreeInFlightRequestKeyRef.current = null;
      }
    }
  };

  const runModMutation = async (
    busyText: string,
    action: (operationId: string) => Promise<unknown>,
    options: WorkspaceMutationOptions = {}
  ) => {
    if (!selectedProject) {
      return;
    }

    const showBusy = options.showBusy ?? true;
    const operationId = createRendererOperationId('mods_mutation');
    if (showBusy) {
      setModsBusyLabel(busyText);
      setMessage(null);
    }

    try {
      await action(operationId);
      await loadModsWorkspace(selectedProject, options.reload);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (showBusy) {
        setModsBusyLabel(null);
      }
    }
  };

  const trackModOrderSave = (promise: Promise<void>) => {
    pendingModOrderSavesRef.current.add(promise);
    void promise.catch(() => undefined).finally(() => {
      pendingModOrderSavesRef.current.delete(promise);
    });
  };

  const trackPluginOrderSave = (promise: Promise<void>) => {
    pendingPluginOrderSavesRef.current.add(promise);
    void promise.catch(() => undefined).finally(() => {
      pendingPluginOrderSavesRef.current.delete(promise);
    });
  };

  const pendingPluginEnableStatesForContext = (
    contextKey: string,
    snapshotSequence: number
  ): ReadonlyMap<string, PendingPluginEnabledState> => {
    const pending = pendingPluginEnableStatesByOrderIdRef.current;
    if (pending.size === 0) {
      return pending;
    }

    const scoped = new Map<string, PendingPluginEnabledState>();
    pending.forEach((state, orderId) => {
      if (state.contextKey === contextKey && (state.pending || state.sequence > snapshotSequence)) {
        scoped.set(orderId, state);
      }
    });
    return scoped;
  };

  const applyPendingPluginEnableStates = (
    items: FluxoraPluginOrderItem[],
    contextKey: string,
    snapshotSequence: number
  ): FluxoraPluginOrderItem[] =>
    mergePendingPluginEnabledStates(
      items,
      pendingPluginEnableStatesForContext(contextKey, snapshotSequence)
    );

  const completeLatestPluginEnableSave = (orderId: string, sequence: number): boolean => {
    if (latestPluginEnableSequenceByOrderIdRef.current.get(orderId) !== sequence) {
      return false;
    }

    latestPluginEnableSequenceByOrderIdRef.current.delete(orderId);
    const pending = pendingPluginEnableStatesByOrderIdRef.current.get(orderId);
    if (pending?.sequence === sequence) {
      pendingPluginEnableStatesByOrderIdRef.current.set(orderId, {
        ...pending,
        pending: false
      });
    }
    return true;
  };

  const revertLatestPluginEnableSave = (orderId: string, sequence: number): boolean => {
    if (latestPluginEnableSequenceByOrderIdRef.current.get(orderId) !== sequence) {
      return false;
    }

    latestPluginEnableSequenceByOrderIdRef.current.delete(orderId);
    pendingPluginEnableStatesByOrderIdRef.current.delete(orderId);
    return true;
  };

  const waitForPendingOrderSaves = async (): Promise<boolean> => {
    const pendingSaves = [
      ...Array.from(pendingModOrderSavesRef.current),
      ...Array.from(pendingPluginOrderSavesRef.current)
    ];
    if (pendingSaves.length === 0) {
      return true;
    }

    setMessage('Saving order...');
    const results = await Promise.allSettled(pendingSaves);
    return results.every((result) => result.status === 'fulfilled');
  };

  const updateInstalledModEnabled = (modPath: string, isEnabled: boolean) => {
    setInstalledMods((current) =>
      current.map((mod) => (mod.id === modPath ? { ...mod, isEnabled } : mod))
    );
  };

  const updateAllInstalledModsEnabled = (isEnabled: boolean) => {
    setInstalledMods((current) => current.map((mod) => ({ ...mod, isEnabled })));
  };

  const setModEnabled = async (item: FluxoraModOrderItem, isEnabled: boolean) => {
    if (!selectedProject || !item.isMod || item.isEnabled === isEnabled) {
      return;
    }

    const project = selectedProject;
    const orderId = item.orderId;
    const previousEnabled = item.isEnabled;
    const sequence = modEnableSaveSequenceRef.current + 1;
    modEnableSaveSequenceRef.current = sequence;
    latestModEnableSequenceByOrderIdRef.current.set(orderId, sequence);

    setMessage(null);
    dispatchModsWorkspace({ type: 'item-enabled-set', orderId, isEnabled });
    updateInstalledModEnabled(item.id, isEnabled);

    try {
      const operationId = createRendererOperationId('mods_set_enabled');
      await window.fluxora.mods.setEnabled(project.projectDirectory, item.id, isEnabled, {
        operationId
      });
      if (latestModEnableSequenceByOrderIdRef.current.get(orderId) === sequence) {
        await loadModsWorkspace(project, backgroundReorderLoadOptions);
      }
      if (pluginCapabilities.bridgeAvailable && pluginCapabilities.projectSupported) {
        await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
      }
    } catch (error) {
      if (latestModEnableSequenceByOrderIdRef.current.get(orderId) === sequence) {
        dispatchModsWorkspace({ type: 'item-enabled-set', orderId, isEnabled: previousEnabled });
        updateInstalledModEnabled(item.id, previousEnabled);
        setMessage(`Could not ${isEnabled ? 'enable' : 'disable'} ${modItemTitle(item)}: ${errorMessage(error)}`);
      }
    } finally {
      if (latestModEnableSequenceByOrderIdRef.current.get(orderId) === sequence) {
        latestModEnableSequenceByOrderIdRef.current.delete(orderId);
      }
    }
  };

  const setAllModsEnabled = async (isEnabled: boolean) => {
    if (!selectedProject) {
      return;
    }

    const project = selectedProject;
    const previousItems = modsWorkspace.items;
    const previousInstalledMods = installedMods;
    const sequence = modBulkEnableSequenceRef.current + 1;
    modBulkEnableSequenceRef.current = sequence;

    setMessage(null);
    dispatchModsWorkspace({ type: 'all-items-enabled-set', isEnabled });
    updateAllInstalledModsEnabled(isEnabled);

    try {
      const operationId = createRendererOperationId('mods_set_all_enabled');
      await window.fluxora.mods.setAllEnabled(project.projectDirectory, isEnabled, {
        operationId
      });
      if (modBulkEnableSequenceRef.current === sequence) {
        await loadModsWorkspace(project, backgroundReorderLoadOptions);
      }
      if (
        modBulkEnableSequenceRef.current === sequence &&
        pluginCapabilities.bridgeAvailable &&
        pluginCapabilities.projectSupported
      ) {
        await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
      }
    } catch (error) {
      if (modBulkEnableSequenceRef.current === sequence) {
        dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
        setInstalledMods(previousInstalledMods);
        setMessage(`Could not ${isEnabled ? 'enable' : 'disable'} all mods: ${errorMessage(error)}`);
        await loadModsWorkspace(project, backgroundReorderLoadOptions);
      }
    }
  };

  const setAllPluginsEnabled = async (isEnabled: boolean) => {
    if (
      !selectedProject ||
      !pluginCapabilities.bridgeAvailable ||
      !pluginCapabilities.projectSupported
    ) {
      return;
    }

    const targetItems = pluginsWorkspace.items.filter(
      (candidate) =>
        candidate.isPlugin && !candidate.isLocked && candidate.isEnabled !== isEnabled
    );
    if (targetItems.length === 0) {
      return;
    }

    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const contextKey = pluginWorkspaceContextKey(project, profileName);
    const previousItems = pluginsWorkspace.items;
    const sequence = pluginEnableSaveSequenceRef.current + 1;
    pluginEnableSaveSequenceRef.current = sequence;
    targetItems.forEach((candidate) => {
      latestPluginEnableSequenceByOrderIdRef.current.set(candidate.orderId, sequence);
      pendingPluginEnableStatesByOrderIdRef.current.set(candidate.orderId, {
        contextKey,
        isEnabled,
        pending: true,
        sequence
      });
    });

    setMessage(null);
    dispatchPluginsWorkspace({ type: 'unlocked-items-enabled-set', isEnabled });

    try {
      const operationId = createRendererOperationId('plugins_set_all_enabled');
      let confirmedOrder: FluxoraPluginOrderItem[];
      if (pluginCapabilities.nativeBulkToggleSupported) {
        confirmedOrder = await window.fluxora.plugins.setAllEnabled(
          project.projectDirectory,
          project.templateId,
          profileName,
          isEnabled,
          { operationId }
        );
      } else {
        confirmedOrder = previousItems;
        for (const candidate of targetItems) {
          confirmedOrder = await window.fluxora.plugins.setEnabled(
            project.projectDirectory,
            project.templateId,
            profileName,
            candidate.name,
            isEnabled,
            { operationId }
          );
        }
      }

      targetItems.forEach((candidate) =>
        completeLatestPluginEnableSave(candidate.orderId, sequence)
      );
      dispatchPluginsWorkspace({
        type: 'items-loaded',
        items: applyPendingPluginEnableStates(confirmedOrder, contextKey, sequence)
      });
    } catch (error) {
      let shouldRevert = false;
      targetItems.forEach((candidate) => {
        if (revertLatestPluginEnableSave(candidate.orderId, sequence)) {
          shouldRevert = true;
        }
      });

      if (shouldRevert) {
        dispatchPluginsWorkspace({ type: 'items-loaded', items: previousItems });
        setMessage(`Could not ${isEnabled ? 'enable' : 'disable'} all plugins: ${errorMessage(error)}`);
        await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
      }
    }
  };

  const moveModOrderItemToIndex = async (
    item: FluxoraModOrderItem,
    targetIndex: number
  ) => {
    if (!selectedProject) {
      return;
    }

    const sourceIndex = modsWorkspace.items.findIndex((candidate) => candidate.orderId === item.orderId);
    if (sourceIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    const optimisticItems = reorderModOrderItems(modsWorkspace.items, item.orderId, targetIndex);
    if (!optimisticItems) {
      return;
    }

    const sequence = modOrderSaveSequenceRef.current + 1;
    modOrderSaveSequenceRef.current = sequence;
    const previousItems = modsWorkspace.items;
    const project = selectedProject;
    const profileName = modWorkspaceProfileName;

    setMessage(null);
    dispatchModsWorkspace({
      type: 'items-reordered',
      orderId: item.orderId,
      targetIndex
    });

    const save = (async () => {
      const operationId = createRendererOperationId('mods_reorder');
      try {
        const confirmedOrder = await window.fluxora.mods.moveOrderItem(
          project.projectDirectory,
          profileName,
          item.orderId,
          targetIndex,
          { operationId }
        );

        if (modOrderSaveSequenceRef.current === sequence) {
          dispatchModsWorkspace({ type: 'items-loaded', items: confirmedOrder });
        }
      } catch (error) {
        const message = errorMessage(error);
        setMessage(`Could not save mod order: ${message}`);
        if (modOrderSaveSequenceRef.current === sequence) {
          dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
          await loadModsWorkspace(project, backgroundReorderLoadOptions);
        }
        throw error;
      }
    })();

    trackModOrderSave(save);
  };

  const openModCreationDialog = (kind: ModCreationDialogKind) => {
    if (!selectedProject) {
      return;
    }

    setModMenuOrderId(null);
    setModsToolbarMenuPosition(null);
    setModCreationDialog({
      kind,
      name: '',
      validationMessage: null
    });
  };

  const updateModCreationDialogName = (name: string) => {
    const limitedName = name.slice(0, MOD_CREATION_NAME_MAX_LENGTH);
    setModCreationDialog((current) =>
      current ? { ...current, name: limitedName, validationMessage: null } : current
    );
  };

  const validateModSeparatorTitle = (title: string) => {
    if (!title) {
      return 'Введите название разделителя.';
    }

    if (title.length > MOD_CREATION_NAME_MAX_LENGTH) {
      return `Название должно быть не длиннее ${MOD_CREATION_NAME_MAX_LENGTH} символов.`;
    }

    return '';
  };

  const createModSeparator = async (title: string) => {
    if (!selectedProject) {
      return;
    }

    const targetIndex = modsWorkspace.items.length;
    await runModMutation('Creating separator', (operationId) =>
      window.fluxora.mods.createSeparator(
        selectedProject.projectDirectory,
        modWorkspaceProfileName,
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

    const project = selectedProject;
    const previousItems = modsWorkspace.items;
    const removedOrderIds = new Set([item.orderId]);
    const operationId = createRendererOperationId('mods_delete_separator');

    setMessage(null);
    dispatchModsWorkspace({
      type: 'items-loaded',
      items: removeModOrderItems(previousItems, removedOrderIds)
    });

    try {
      await window.fluxora.mods.deleteSeparator(
        project.projectDirectory,
        modWorkspaceProfileName,
        item.orderId,
        { operationId }
      );
      await loadModsWorkspace(project, backgroundReorderLoadOptions);
    } catch (error) {
      dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
      setMessage(`Could not delete separator: ${errorMessage(error)}`);
    }
  };

  const removeDeletedModItems = (items: FluxoraModOrderItem[]) => {
    const removedOrderIds = new Set(items.map((mod) => mod.orderId));
    const removedModIds = new Set(items.map((mod) => mod.id));

    dispatchModsWorkspace({
      type: 'items-loaded',
      items: removeModOrderItems(modsWorkspace.items, removedOrderIds)
    });
    setInstalledMods((current) => current.filter((mod) => !removedModIds.has(mod.id)));
  };

  const restoreDeletedModItems = (
    previousItems: FluxoraModOrderItem[],
    previousInstalledMods: FluxoraInstalledMod[]
  ) => {
    dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
    setInstalledMods(previousInstalledMods);
  };

  const refreshAfterModDeletion = async (project: FluxoraProject) => {
    await loadModsWorkspace(project, backgroundReorderLoadOptions);
    if (pluginCapabilities.bridgeAvailable && pluginCapabilities.projectSupported) {
      await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
    }
  };

  const createEmptyMod = async (modName: string) => {
    if (!selectedProject) {
      return;
    }

    await runModMutation('Creating empty mod', (operationId) =>
      window.fluxora.mods.createEmpty(selectedProject.projectDirectory, modName, {
        operationId
      })
    );
  };

  const submitModCreationDialog = async () => {
    if (!modCreationDialog) {
      return;
    }

    if (!selectedProject) {
      setModCreationDialog(null);
      return;
    }

    const name =
      modCreationDialog.kind === 'empty-mod'
        ? normalizeInstallModName(modCreationDialog.name)
        : modCreationDialog.name.trim();
    const validationMessage =
      modCreationDialog.kind === 'empty-mod'
        ? validateInstallModName(name)
        : validateModSeparatorTitle(name);

    if (validationMessage) {
      setModCreationDialog((current) =>
        current ? { ...current, validationMessage } : current
      );
      return;
    }

    setModCreationDialog(null);

    if (modCreationDialog.kind === 'empty-mod') {
      await createEmptyMod(name);
      return;
    }

    await createModSeparator(name);
  };

  const modDeletionItemsFor = (item: FluxoraModOrderItem): FluxoraModOrderItem[] => {
    if (!item.isMod) {
      return [];
    }

    if (!modsWorkspace.selectedOrderIds.has(item.orderId)) {
      return [item];
    }

    return selectedModDeletionItems.length > 1 ? selectedModDeletionItems : [item];
  };

  const requestDeleteInstalledMod = (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    const targets = modDeletionItemsFor(item);
    if (targets.length === 0) {
      return;
    }

    const deletedModTitle = modItemTitle(targets[0] ?? item);
    setDeletionConfirmation({
      kind: 'mod',
      itemName: deletedModTitle,
      itemCount: targets.length,
      onConfirm: () => deleteInstalledMods(targets)
    });
  };

  const deleteInstalledMod = async (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    const project = selectedProject;
    const previousItems = modsWorkspace.items;
    const previousInstalledMods = installedMods;
    const deletedModTitle = modItemTitle(item);

    const operationId = createRendererOperationId('mods_delete');
    setMessage(null);
    removeDeletedModItems([item]);

    try {
      await window.fluxora.mods.deleteInstalled(project.projectDirectory, item.id, {
        operationId
      });
      await refreshAfterModDeletion(project);
    } catch (error) {
      const nextMessage = errorMessage(error);
      restoreDeletedModItems(previousItems, previousInstalledMods);
      setMessage(`Could not delete ${deletedModTitle}: ${nextMessage}`);
    }
  };

  const deleteInstalledMods = async (items: FluxoraModOrderItem[]) => {
    const targets = items.filter((item) => item.isMod);
    if (!selectedProject || targets.length === 0) {
      return;
    }

    if (targets.length === 1) {
      await deleteInstalledMod(targets[0]!);
      return;
    }

    const project = selectedProject;
    const operationId = createRendererOperationId('mods_delete_bulk');
    const previousItems = modsWorkspace.items;
    const previousInstalledMods = installedMods;
    setMessage(null);
    removeDeletedModItems(targets);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const item = targets[index]!;
        await window.fluxora.mods.deleteInstalled(project.projectDirectory, item.id, {
          operationId
        });
      }

      await refreshAfterModDeletion(project);
    } catch (error) {
      const nextMessage = errorMessage(error);
      restoreDeletedModItems(previousItems, previousInstalledMods);
      setMessage(`Could not delete mods: ${nextMessage}`);
    }
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

  const openPluginInExplorer = async (item: FluxoraPluginOrderItem) => {
    if (!item.isPlugin) {
      return;
    }

    const path = item.path?.trim();

    if (!path) {
      setMessage(`Plugin location is not reported for ${pluginItemTitle(item)}.`);
      return;
    }

    const result = await window.fluxora.shell.showItemInFolder(path);
    if (!result.ok) {
      setMessage(result.message ?? 'Plugin location could not be opened.');
    }
  };

  const openModDetailsWindow = async (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    try {
      const bootstrapKey = createRendererOperationId('mod_details_bootstrap');
      writeModDetailsBootstrap({
        key: bootstrapKey,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        projectDirectory: selectedProject.projectDirectory,
        configPath: selectedProject.configPath,
        profileName: modWorkspaceProfileName,
        modPath: item.id,
        item,
        rootFileTree: fileTreeCache[''],
        createdAt: Date.now()
      });
      await window.fluxora.windowControls.openModDetails(
        selectedProject.configPath,
        item.id,
        modItemTitle(item),
        modWorkspaceProfileName,
        bootstrapKey
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const openOverwriteFolder = async () => {
    const path = selectedProject?.paths?.overwriteDirectory;
    if (!path) {
      setMessage('Overwrite folder is not reported for this build.');
      return;
    }

    const result = await window.fluxora.shell.openPath(path);
    if (!result.ok) {
      setMessage(result.message ?? 'Overwrite folder could not be opened.');
    }
  };

  const clearOverwriteFolder = async () => {
    if (!selectedProject) {
      return;
    }

    const path = selectedProject.paths?.overwriteDirectory;
    if (!path) {
      setMessage('Overwrite folder is not reported for this build.');
      return;
    }

    if (!window.confirm(`Очистить папку перезаписи "${path}"?`)) {
      return;
    }

    const operationId = createRendererOperationId('mods_clear_overwrite');
    overwriteClearOperationIdRef.current = operationId;
    setOverwriteClearSplash({
      operationId,
      buildName: selectedProject.name,
      progress: 6
    });
    setModsBusyLabel('Очищаем override');
    setMessage(null);

    try {
      await window.fluxora.mods.clearOverwrite(selectedProject.projectDirectory, {
        operationId
      });
      void loadEffectiveFileTree(selectedProject, selectedProjectProfileName, {
        force: true,
        requestKey: effectiveFileTreeRequestKey
      });
      setOverwriteClearSplash((current) =>
        current?.operationId === operationId ? { ...current, progress: 100 } : current
      );
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 380);
      });
      setOverwriteClearSplash((current) =>
        current?.operationId === operationId ? null : current
      );
    } catch (error) {
      setOverwriteClearSplash((current) =>
        current?.operationId === operationId ? null : current
      );
      setMessage(errorMessage(error));
    } finally {
      if (overwriteClearOperationIdRef.current === operationId) {
        overwriteClearOperationIdRef.current = null;
        setModsBusyLabel(null);
      }
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

  const openTextEditorForFile = async (entry: FluxoraModFileTreeEntry) => {
    if (
      !selectedProject ||
      !selectedModItem?.isMod ||
      entry.isDirectory ||
      !isTextEditorFileName(entry.name)
    ) {
      return;
    }

    try {
      await window.fluxora.windowControls.openTextEditor(
        selectedProject.configPath,
        selectedModItem.id,
        entry.relativePath,
        entry.name
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const openFilePreviewForFile = async (entry: FluxoraModFileTreeEntry) => {
    const previewKind = previewKindForFile(entry.name);
    if (
      !selectedProject ||
      !selectedModItem?.isMod ||
      entry.isDirectory ||
      previewKind === null
    ) {
      return;
    }

    try {
      await window.fluxora.windowControls.openFilePreview(
        selectedProject.configPath,
        selectedModItem.id,
        entry.relativePath,
        entry.name,
        modWorkspaceProfileName,
        previewKind.kind
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const loadModDetailsConflictTree = async (item: FluxoraModOrderItem | null = selectedModItem) => {
    const projectDirectory =
      selectedProject?.projectDirectory ?? initialModDetailsBootstrap?.projectDirectory ?? '';
    if (!projectDirectory || !item?.isMod) {
      return;
    }

    const operationId = createRendererOperationId('mods_conflict_tree');

    setModDetailsConflictScanState('loading');
    try {
      const page = await window.fluxora.mods.getModConflictTree(
        projectDirectory,
        item.id,
        undefined,
        200,
        { operationId }
      );
      setModDetailsConflictPage(page);
      setModDetailsConflictScanState('ready');
    } catch (error) {
      setModDetailsConflictScanState('error');
      setMessage(errorMessage(error));
    }
  };

  const loadPluginsWorkspace = async (
    project = selectedProject,
    options: WorkspaceLoadOptions = {}
  ) => {
    if (!canBeginWorkspaceStoreLoad(options)) {
      return false;
    }
    const loadSequence = beginWorkspaceStoreLoad('plugins');
    if (workspaceStoreBusyLoadSequenceRef.current.plugins !== null) {
      workspaceStoreBusyLoadSequenceRef.current.plugins = null;
      setPluginsBusyLabel(null);
    }
    const capabilities = pluginCapabilityView(project, bridgeStatus);
    if (!project || !bridgeStatus?.ready) {
      return false;
    }

    if (!capabilities.bridgeAvailable) {
      dispatchPluginsWorkspace({ type: 'items-loaded', items: [] });
      setDraggedPluginOrderId(null);
      setPluginDropTarget(null);
      return true;
    }

    if (!capabilities.projectSupported) {
      dispatchPluginsWorkspace({ type: 'items-loaded', items: [] });
      setDraggedPluginOrderId(null);
      setPluginDropTarget(null);
      return true;
    }

    const hasCurrentRows = pluginsWorkspace.items.length > 0;
    const showLoading = options.showLoading ?? !hasCurrentRows;
    const showBusy = options.showBusy ?? false;
    const resetScroll = options.resetScroll ?? true;
    const operationId = options.operationId ?? createRendererOperationId('plugins_load');
    const profileName = options.profileName ?? selectedProjectProfileName;
    const contextKey = pluginWorkspaceContextKey(project, profileName);
    const snapshotSequence = pluginEnableSaveSequenceRef.current;
    if (showLoading) {
      dispatchPluginsWorkspace({ type: 'load-started' });
    }
    if (showBusy) {
      workspaceStoreBusyLoadSequenceRef.current.plugins = loadSequence;
      setPluginsBusyLabel('Loading plugins');
      setMessage(null);
    }

    try {
      const listPlugins = options.persistedSnapshot
        ? window.fluxora.plugins.listPersisted
        : window.fluxora.plugins.list;
      const nextPlugins = await listPlugins(
        project.projectDirectory,
        project.templateId,
        profileName,
        { operationId }
      );
      if (!isCurrentWorkspaceStoreLoad('plugins', loadSequence)) {
        return false;
      }
      dispatchPluginsWorkspace({
        type: 'items-loaded',
        items: applyPendingPluginEnableStates(nextPlugins, contextKey, snapshotSequence)
      });
      if (resetScroll) {
        setPluginListScrollTop(0);
      }
      setDraggedPluginOrderId(null);
      setPluginDropTarget(null);
      return true;
    } catch (error) {
      if (!isCurrentWorkspaceStoreLoad('plugins', loadSequence)) {
        return false;
      }
      dispatchPluginsWorkspace({
        type: 'load-failed',
        message: errorMessage(error),
        silent: !showLoading
      });
      setMessage(errorMessage(error));
      return false;
    } finally {
      if (workspaceStoreBusyLoadSequenceRef.current.plugins === loadSequence) {
        workspaceStoreBusyLoadSequenceRef.current.plugins = null;
        setPluginsBusyLabel(null);
      }
    }
  };

  const runPluginMutation = async (
    busyText: string,
    action: (operationId: string) => Promise<unknown>,
    options: WorkspaceMutationOptions = {}
  ) => {
    if (!selectedProject || !pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported) {
      return;
    }

    const showBusy = options.showBusy ?? true;
    const operationId = createRendererOperationId('plugins_mutation');
    if (showBusy) {
      setPluginsBusyLabel(busyText);
      setMessage(null);
    }

    try {
      await action(operationId);
      await loadPluginsWorkspace(selectedProject, options.reload);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (showBusy) {
        setPluginsBusyLabel(null);
      }
    }
  };

  const setPluginEnabled = async (item: FluxoraPluginOrderItem, isEnabled: boolean) => {
    if (!selectedProject || !item.isPlugin || item.isLocked || item.isEnabled === isEnabled) {
      return;
    }

    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const contextKey = pluginWorkspaceContextKey(project, profileName);
    const orderId = item.orderId;
    const previousEnabled = item.isEnabled;
    const sequence = pluginEnableSaveSequenceRef.current + 1;
    pluginEnableSaveSequenceRef.current = sequence;
    latestPluginEnableSequenceByOrderIdRef.current.set(orderId, sequence);
    pendingPluginEnableStatesByOrderIdRef.current.set(orderId, {
      contextKey,
      isEnabled,
      pending: true,
      sequence
    });

    setMessage(null);
    dispatchPluginsWorkspace({ type: 'item-enabled-set', orderId, isEnabled });

    try {
      const operationId = createRendererOperationId('plugins_set_enabled');
      const confirmedOrder = await window.fluxora.plugins.setEnabled(
        project.projectDirectory,
        project.templateId,
        profileName,
        item.name,
        isEnabled,
        { operationId }
      );

      if (completeLatestPluginEnableSave(orderId, sequence)) {
        dispatchPluginsWorkspace({
          type: 'items-loaded',
          items: applyPendingPluginEnableStates(confirmedOrder, contextKey, sequence)
        });
      }
    } catch (error) {
      if (revertLatestPluginEnableSave(orderId, sequence)) {
        dispatchPluginsWorkspace({
          type: 'item-enabled-set',
          orderId,
          isEnabled: previousEnabled
        });
        setMessage(`Could not ${isEnabled ? 'enable' : 'disable'} ${pluginItemTitle(item)}: ${errorMessage(error)}`);
      }
    }
  };

  const movePluginOrderItemToIndex = async (
    item: FluxoraPluginOrderItem,
    targetIndex: number
  ) => {
    if (!selectedProject || !pluginCapabilities.loadOrderSupported) {
      return;
    }

    if (!canDragPluginOrderItem(pluginsWorkspace.items, item.orderId)) {
      return;
    }

    const optimisticItems = reorderPluginOrderItems(pluginsWorkspace.items, item.orderId, targetIndex);
    if (!optimisticItems) {
      return;
    }

    const sequence = pluginOrderSaveSequenceRef.current + 1;
    pluginOrderSaveSequenceRef.current = sequence;
    const previousItems = pluginsWorkspace.items;
    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const contextKey = pluginWorkspaceContextKey(project, profileName);
    const snapshotSequence = pluginEnableSaveSequenceRef.current;

    setMessage(null);
    dispatchPluginsWorkspace({
      type: 'items-reordered',
      orderId: item.orderId,
      targetIndex
    });

    const save = (async () => {
      const operationId = createRendererOperationId('plugins_reorder');
      try {
        const confirmedOrder = await window.fluxora.plugins.move(
          project.projectDirectory,
          project.templateId,
          profileName,
          item.orderId,
          targetIndex,
          { operationId }
        );

        if (pluginOrderSaveSequenceRef.current === sequence) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(confirmedOrder, contextKey, snapshotSequence)
          });
        }
      } catch (error) {
        const message = errorMessage(error);
        setMessage(`Could not save plugin order: ${message}`);
        if (pluginOrderSaveSequenceRef.current === sequence) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(previousItems, contextKey, snapshotSequence)
          });
          await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
        }
        throw error;
      }
    })();

    trackPluginOrderSave(save);
  };

  const movePluginOrderItem = async (item: FluxoraPluginOrderItem, direction: -1 | 1) => {
    const targetIndex = targetIndexForPluginMove(
      pluginsWorkspace.items,
      item.orderId,
      direction,
      pluginsWorkspace.collapsedSeparatorOrderIds
    );
    if (targetIndex === null) {
      return;
    }

    await movePluginOrderItemToIndex(item, targetIndex);
  };

  const clearRowReorderSession = () => {
    const session = rowReorderSessionRef.current;
    if (session?.frameId != null) {
      window.cancelAnimationFrame(session.frameId);
    }

    rowReorderSessionRef.current = null;
    setDraggedModOrderId(null);
    setModDropTarget(null);
    setDraggedPluginOrderId(null);
    setPluginDropTarget(null);
    document.body.classList.remove('row-reorder-active');
  };

  const setRowDropTarget = (
    kind: RowReorderKind,
    target: RowDropTargetState | null
  ) => {
    if (kind === 'mod') {
      setModDropTarget(target);
      return;
    }

    setPluginDropTarget(target);
  };

  const targetIndexForRowDrop = (
    kind: RowReorderKind,
    sourceOrderId: string,
    targetOrderId: string,
    placement: RowDropPlacement
  ): number | null =>
    kind === 'mod'
      ? targetIndexForDrop(
          modsWorkspace.items,
          sourceOrderId,
          targetOrderId,
          placement,
          modsWorkspace.collapsedSeparatorOrderIds
        )
      : targetIndexForPluginDrop(
          pluginsWorkspace.items,
          sourceOrderId,
          targetOrderId,
          placement,
          pluginsWorkspace.collapsedSeparatorOrderIds
        );

  const applyRowReorderAutoScroll = (session: RowReorderSession) => {
    const container = session.scrollContainer;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    let delta = 0;
    if (session.currentY < rect.top + rowReorderAutoScrollEdge) {
      const pressure = (rect.top + rowReorderAutoScrollEdge - session.currentY) / rowReorderAutoScrollEdge;
      delta = -Math.ceil(Math.min(1, pressure) * rowReorderAutoScrollMaxStep);
    } else if (session.currentY > rect.bottom - rowReorderAutoScrollEdge) {
      const pressure = (session.currentY - (rect.bottom - rowReorderAutoScrollEdge)) / rowReorderAutoScrollEdge;
      delta = Math.ceil(Math.min(1, pressure) * rowReorderAutoScrollMaxStep);
    }

    if (delta !== 0) {
      container.scrollTop += delta;
    }
  };

  const resolveRowDropTarget = (session: RowReorderSession) => {
    session.frameId = null;
    applyRowReorderAutoScroll(session);

    const element = document.elementFromPoint(session.currentX, session.currentY);
    const row =
      element instanceof Element
        ? element.closest<HTMLElement>(`[data-reorder-kind="${session.kind}"][data-order-id]`)
        : null;
    const targetOrderId = row?.dataset.orderId ?? null;
    const placement = row ? rowDropPlacementFromPointer(row, session.currentY) : null;
    const targetIndex =
      targetOrderId && placement
        ? targetIndexForRowDrop(session.kind, session.sourceOrderId, targetOrderId, placement)
        : null;
    const nextTarget =
      targetOrderId && placement && targetIndex !== null
        ? { orderId: targetOrderId, placement }
        : null;

    if (
      session.targetOrderId === (nextTarget?.orderId ?? null) &&
      session.placement === (nextTarget?.placement ?? null)
    ) {
      return;
    }

    session.targetOrderId = nextTarget?.orderId ?? null;
    session.placement = nextTarget?.placement ?? null;
    setRowDropTarget(session.kind, nextTarget);
  };

  const scheduleRowDropTargetResolve = (session: RowReorderSession) => {
    if (session.frameId !== null) {
      return;
    }

    session.frameId = window.requestAnimationFrame(() => resolveRowDropTarget(session));
  };

  const beginRowReorderDrag = (
    event: ReactPointerEvent<HTMLElement>,
    kind: RowReorderKind,
    sourceOrderId: string,
    canDrag: boolean
  ): boolean => {
    if (
      !canDrag ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isInteractiveRowDragTarget(event.target)
    ) {
      return false;
    }

    const scrollContainer = event.currentTarget.closest<HTMLElement>(
      kind === 'mod' ? '.mod-list__body' : '.mod-table__body'
    );
    if (rowReorderSessionRef.current) {
      clearRowReorderSession();
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rowReorderSessionRef.current = {
      kind,
      pointerId: event.pointerId,
      sourceOrderId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      active: false,
      frameId: null,
      targetOrderId: null,
      placement: null,
      scrollContainer
    };

    return true;
  };

  const updateRowReorderDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = rowReorderSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    session.currentX = event.clientX;
    session.currentY = event.clientY;

    if (!session.active) {
      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      if (Math.hypot(deltaX, deltaY) < rowReorderDragThreshold) {
        return;
      }

      session.active = true;
      document.body.classList.add('row-reorder-active');
      if (session.kind === 'mod') {
        setDraggedModOrderId(session.sourceOrderId);
      } else {
        setDraggedPluginOrderId(session.sourceOrderId);
      }
    }

    event.preventDefault();
    scheduleRowDropTargetResolve(session);
  };

  const endRowReorderDrag = (
    event: ReactPointerEvent<HTMLElement>
  ) => {
    const session = rowReorderSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (session.active && session.frameId != null) {
      window.cancelAnimationFrame(session.frameId);
      resolveRowDropTarget(session);
    }

    const targetOrderId = session.targetOrderId;
    const placement = session.placement;
    const sourceOrderId = session.sourceOrderId;
    const kind = session.kind;
    const wasActive = session.active;
    const targetIndex =
      targetOrderId && placement
        ? targetIndexForRowDrop(kind, sourceOrderId, targetOrderId, placement)
        : null;
    clearRowReorderSession();

    if (!wasActive) {
      return;
    }

    suppressNextRowClickRef.current = true;
    event.preventDefault();
    if (targetIndex === null) {
      return;
    }

    if (kind === 'mod') {
      const source = modsWorkspace.items.find((item) => item.orderId === sourceOrderId);
      if (source) {
        void moveModOrderItemToIndex(source, targetIndex);
      }
      return;
    }

    const source = pluginsWorkspace.items.find((item) => item.orderId === sourceOrderId);
    if (source) {
      void movePluginOrderItemToIndex(source, targetIndex);
    }
  };

  const cancelRowReorderDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const session = rowReorderSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    clearRowReorderSession();
  };

  const consumeSuppressedRowClick = () => {
    if (!suppressNextRowClickRef.current) {
      return false;
    }

    suppressNextRowClickRef.current = false;
    return true;
  };

  const isSelectionToggleModifier = (
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>
  ): boolean => event.ctrlKey || event.metaKey;

  const isSelectAllShortcut = (event: ReactKeyboardEvent<HTMLElement>): boolean =>
    isSelectionToggleModifier(event) &&
    (event.key.toLocaleLowerCase() === 'a' || event.code === 'KeyA');

  const handleModRowSelection = (
    event: ReactMouseEvent<HTMLElement>,
    item: FluxoraModOrderItem
  ) => {
    const canUseMultiSelection = selectableModOrderIds.includes(item.orderId);
    const usesToggle = isSelectionToggleModifier(event);

    if (event.shiftKey && canUseMultiSelection) {
      dispatchModsWorkspace({
        type: 'selection-range-selected',
        orderId: item.orderId,
        orderedOrderIds: selectableModOrderIds,
        additive: usesToggle
      });
    } else if (usesToggle && canUseMultiSelection) {
      dispatchModsWorkspace({
        type: 'selection-toggled',
        orderId: item.orderId,
        orderedOrderIds: selectableModOrderIds
      });
    } else {
      dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
    }

    setModMenuOrderId(null);
  };

  const handlePluginRowSelection = (
    event: ReactMouseEvent<HTMLElement>,
    item: FluxoraPluginOrderItem
  ) => {
    const usesToggle = isSelectionToggleModifier(event);

    if (event.shiftKey) {
      dispatchPluginsWorkspace({
        type: 'selection-range-selected',
        orderId: item.orderId,
        orderedOrderIds: selectablePluginOrderIds,
        additive: usesToggle
      });
    } else if (usesToggle) {
      dispatchPluginsWorkspace({
        type: 'selection-toggled',
        orderId: item.orderId,
        orderedOrderIds: selectablePluginOrderIds
      });
    } else {
      dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
    }

    setPluginMenuOrderId(null);
  };

  const handleModRowKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    item: FluxoraModOrderItem
  ) => {
    if (event.currentTarget !== event.target) {
      return;
    }

    if (isSelectAllShortcut(event) && selectableModOrderIds.length > 0) {
      event.preventDefault();
      dispatchModsWorkspace({
        type: 'all-selected',
        orderedOrderIds: selectableModOrderIds
      });
      setModMenuOrderId(null);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
      setModMenuOrderId(null);
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      if (!modsWorkspace.selectedOrderIds.has(item.orderId)) {
        dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
      }
      setModMenuPosition(
        rowContextMenuPositionFromAnchor(event.currentTarget.getBoundingClientRect())
      );
      setModMenuOrderId(item.orderId);
    }
  };

  const handlePluginRowKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    item: FluxoraPluginOrderItem
  ) => {
    if (event.currentTarget !== event.target) {
      return;
    }

    if (isSelectAllShortcut(event) && selectablePluginOrderIds.length > 0) {
      event.preventDefault();
      dispatchPluginsWorkspace({
        type: 'all-selected',
        orderedOrderIds: selectablePluginOrderIds
      });
      setPluginMenuOrderId(null);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
      setPluginMenuOrderId(null);
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      if (!pluginsWorkspace.selectedOrderIds.has(item.orderId)) {
        dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
      }
      setPluginMenuPosition(
        rowContextMenuPositionFromAnchor(event.currentTarget.getBoundingClientRect())
      );
      setPluginMenuOrderId(item.orderId);
    }
  };

  const handleDownloadRowSelection = (
    event: ReactMouseEvent<HTMLElement>,
    entry: FluxoraDownloadEntry
  ) => {
    const canUseMultiSelection = selectableDownloadIds.includes(entry.id);
    const usesToggle = isSelectionToggleModifier(event);

    if (event.shiftKey && canUseMultiSelection) {
      dispatchDownloadsWorkspace({
        type: 'selection-range-selected',
        id: entry.id,
        orderedIds: selectableDownloadIds,
        additive: usesToggle
      });
    } else if (usesToggle && canUseMultiSelection) {
      dispatchDownloadsWorkspace({
        type: 'selection-toggled',
        id: entry.id,
        orderedIds: selectableDownloadIds
      });
    } else {
      dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
    }

    setDownloadMenuId(null);
  };

  const handleDownloadRowKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    entry: FluxoraDownloadEntry
  ) => {
    if (event.currentTarget !== event.target) {
      return;
    }

    if (isSelectAllShortcut(event) && selectableDownloadIds.length > 0) {
      event.preventDefault();
      dispatchDownloadsWorkspace({
        type: 'all-selected',
        orderedIds: selectableDownloadIds
      });
      setDownloadMenuId(null);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
      setDownloadMenuId(null);
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      if (!downloadsWorkspace.selectedIds.has(entry.id)) {
        dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
      }
      setDownloadMenuPosition(
        rowContextMenuPositionFromAnchor(
          event.currentTarget.getBoundingClientRect(),
          downloadRowMenuEstimatedHeight(entry)
        )
      );
      setDownloadMenuId(entry.id);
    }
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

  const loadProfilesWorkspace = async (
    project = selectedProject,
    options: WorkspaceLoadOptions = {}
  ) => {
    if (!canBeginWorkspaceStoreLoad(options)) {
      return null;
    }
    const loadSequence = beginWorkspaceStoreLoad('profiles');
    if (workspaceStoreBusyLoadSequenceRef.current.profiles !== null) {
      workspaceStoreBusyLoadSequenceRef.current.profiles = null;
      setProfilesBusyLabel(null);
    }
    const capabilities = profilesCapabilityView(project, bridgeStatus);
    if (!project || !bridgeStatus?.ready) {
      return null;
    }

    if (!capabilities.bridgeAvailable) {
      dispatchProfilesWorkspace({
        type: 'items-loaded',
        items: [],
        defaultProfileName: projectDefaultProfileName(project)
      });
      return [];
    }

    const hasCurrentRows = profilesWorkspace.items.length > 0;
    const showBusy = options.showBusy ?? false;
    const showLoading = options.showLoading ?? !hasCurrentRows;
    const operationId = options.operationId ?? createRendererOperationId('profiles_load');
    dispatchProfilesWorkspace({ type: 'load-started', silent: !showLoading });
    if (showBusy) {
      workspaceStoreBusyLoadSequenceRef.current.profiles = loadSequence;
      setProfilesBusyLabel('Loading profiles');
      setMessage(null);
    }

    try {
      const profiles = await window.fluxora.profiles.list(
        project.projectDirectory,
        projectDefaultProfileName(project),
        { operationId }
      );
      if (!isCurrentWorkspaceStoreLoad('profiles', loadSequence)) {
        return null;
      }
      dispatchProfilesWorkspace({
        type: 'items-loaded',
        items: profiles,
        defaultProfileName: projectDefaultProfileName(project)
      });
      return profiles;
    } catch (error) {
      if (!isCurrentWorkspaceStoreLoad('profiles', loadSequence)) {
        return null;
      }
      dispatchProfilesWorkspace({
        type: 'load-failed',
        message: errorMessage(error),
        silent: !showLoading
      });
      setMessage(errorMessage(error));
      return null;
    } finally {
      if (workspaceStoreBusyLoadSequenceRef.current.profiles === loadSequence) {
        workspaceStoreBusyLoadSequenceRef.current.profiles = null;
        setProfilesBusyLabel(null);
      }
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

  const loadExecutablesWorkspace = async (
    project = selectedProject,
    options: WorkspaceLoadOptions = {}
  ) => {
    if (!canBeginWorkspaceStoreLoad(options)) {
      return null;
    }
    const loadSequence = beginWorkspaceStoreLoad('executables');
    if (workspaceStoreBusyLoadSequenceRef.current.executables !== null) {
      workspaceStoreBusyLoadSequenceRef.current.executables = null;
      setExecutablesBusyLabel(null);
    }
    const capabilities = executablesCapabilityView(project, bridgeStatus);
    if (!project || !bridgeStatus?.ready) {
      return null;
    }

    if (!capabilities.bridgeAvailable) {
      dispatchExecutablesWorkspace({ type: 'items-loaded', items: [] });
      cacheProjectExecutables(project, []);
      return [];
    }

    const hasCurrentRows = executablesWorkspace.items.length > 0;
    const showBusy = options.showBusy ?? false;
    const showLoading = options.showLoading ?? !hasCurrentRows;
    const operationId = options.operationId ?? createRendererOperationId('executables_load');
    dispatchExecutablesWorkspace({ type: 'load-started', silent: !showLoading });
    if (showBusy) {
      workspaceStoreBusyLoadSequenceRef.current.executables = loadSequence;
      setExecutablesBusyLabel('Loading executables');
      setMessage(null);
    }

    try {
      const executables = await window.fluxora.executables.list(project.configPath, {
        operationId
      });
      if (!isCurrentWorkspaceStoreLoad('executables', loadSequence)) {
        return null;
      }
      dispatchExecutablesWorkspace({ type: 'items-loaded', items: executables });
      cacheProjectExecutables(project, executables);
      return executables;
    } catch (error) {
      if (!isCurrentWorkspaceStoreLoad('executables', loadSequence)) {
        return null;
      }
      dispatchExecutablesWorkspace({
        type: 'load-failed',
        message: errorMessage(error),
        silent: !showLoading
      });
      setMessage(errorMessage(error));
      return null;
    } finally {
      if (workspaceStoreBusyLoadSequenceRef.current.executables === loadSequence) {
        workspaceStoreBusyLoadSequenceRef.current.executables = null;
        setExecutablesBusyLabel(null);
      }
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
    const launchStartedAtMs = performance.now();
    setExecutablesBusyLabel('Launching executable');
    setExecutableLaunchResult(null);
    setLaunchSplash({
      operationId,
      appName: selectedExecutableItem.displayName,
      buildName: selectedProject.name,
      detail: 'Процесс запускается',
      state: 'starting',
      subtitle: selectedProject.name,
      title: 'Процесс запускается'
    });
    setMessage(null);

    try {
      const result = await window.fluxora.executables.launch(
        selectedProject.configPath,
        selectedExecutableItem.id,
        selectedProjectProfileName,
        { operationId }
      );
      const processCreatedAtMs = performance.now();
      void window.fluxora.ui
        .log({
          level: 'info',
          category: 'Performance',
          message: `launch_renderer_process_created clickToProcessCreatedMs=${(
            processCreatedAtMs - launchStartedAtMs
          ).toFixed(2)}`,
          operationId
        })
        .catch(() => undefined);
      setExecutableLaunchResult(result);
      const processName =
        result.handoffDisplayName || result.displayName || selectedExecutableItem.displayName;
      const ready = await window.fluxora.processes.waitForLaunchReady(
        {
          processId: result.processId,
          processName,
          launchTrackingKind: result.launchTrackingKind,
          expectedChildProcessNames: result.expectedChildProcessNames,
          handoffTimeoutMs: result.handoffTimeoutMs,
          operationId
        },
        { operationId }
      );

      if (ready.state !== 'running') {
        const reason =
          ready.state === 'timeout'
            ? `Fluxora не обнаружила ${processName} до истечения времени запуска.`
            : `${processName} завершился до того, как Fluxora смогла отследить процесс.`;
        await loadModsWorkspace(selectedProject, {
          resetScroll: false,
          showBusy: false,
          showLoading: false
        });
        setMessage(reason);
        return;
      }

      const trackedProcessName = ready.processName || processName;
      void window.fluxora.ui
        .log({
          level: 'info',
          category: 'Performance',
          message: `launch_renderer_external_ready clickToReadyMs=${(
            performance.now() - launchStartedAtMs
          ).toFixed(2)}`,
          operationId
        })
        .catch(() => undefined);
      setLaunchSplash((current) =>
        current?.operationId === operationId
          ? {
              ...current,
              appName: trackedProcessName,
              detail: 'Процесс запущен',
              state: 'running',
              subtitle: 'Закройте процесс, чтобы продолжить работу в Mod Manager.',
              title: 'Процесс запущен'
            }
          : current
      );
      setMessage('Процесс запущен. Закройте процесс, чтобы продолжить работу в Mod Manager.');
      await window.fluxora.processes.waitForExit(ready.processId, { operationId });
      await loadModsWorkspace(selectedProject, {
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
      setMessage(`${trackedProcessName} закрыт. Можно продолжить работу в Mod Manager.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLaunchSplash((current) => (current?.operationId === operationId ? null : current));
      setExecutablesBusyLabel(null);
    }
  };

  const requestGrassCacheGeneration = () => {
    if (!selectedProject || !grassCacheAction.visible) {
      return;
    }

    if (!grassCacheAction.available) {
      setMessage(grassCacheAction.reason || 'NGIO grass cache generation is not available.');
      return;
    }

    setMessage(null);
    setGrassCacheConfirmationOpen(true);
  };

  const generateNgioGrassCache = async () => {
    if (!selectedProject || !grassCacheAction.visible || !grassCacheAction.available) {
      setGrassCacheConfirmationOpen(false);
      return;
    }

    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const operationId = createRendererOperationId('grass_cache_generate');
    setGrassCacheConfirmationOpen(false);
    beginOperationOverlay({
      operationId,
      kind: 'grass-cache',
      title: 'Генерация кэша травы',
      statusText: 'Подготавливаем No Grass In Objects',
      currentItem: project.name,
      percent: null
    });
    setMessage(null);

    try {
      const result = await window.fluxora.grassCache.generate(
        {
          configPath: project.configPath,
          profileName
        },
        { operationId }
      );
      const resultText = `Кэш травы создан: ${result.outputModName}`;
      finishOperationOverlay(operationId, resultText);
      setMessage(
        `${resultText}. Файлов: ${result.generatedFileCount}, запусков: ${result.launchCount}.`
      );
      await loadModsWorkspace(project, {
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
    } catch (error) {
      const text = errorMessage(error);
      failOperationOverlay(operationId, text);
      setMessage(text);
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

  const resolveExistingModNameForInstall = async (
    project: FluxoraProject,
    operationId: string,
    modName: string
  ): Promise<string | null> => {
    try {
      const mods = await window.fluxora.mods.listInstalled(project.projectDirectory, {
        operationId
      });
      setInstalledMods(mods);
      return findExistingInstalledModName(
        mods.map((mod) => mod.name).filter((name): name is string => Boolean(name)),
        modName
      );
    } catch {
      return findExistingInstalledModName(installedModNames, modName);
    }
  };

  const setInstallDialogPatch = (patch: Partial<InstallDialogState>) => {
    setInstallDialog((current) => (current ? { ...current, ...patch } : current));
  };

  const setInstallDialogPatchForOperation = (
    operationId: string,
    patch: Partial<InstallDialogState>
  ) => {
    setInstallDialog((current) =>
      current?.operationId === operationId ? { ...current, ...patch } : current
    );
  };

  const applyInstallAnalysisResult = (
    operationId: string,
    result: InstallAnalysisResult
  ) => {
    setInstallDialog((current) => {
      if (!current || current.operationId !== operationId) {
        return current;
      }

      if (result.kind === 'fomod') {
        const currentName = normalizeInstallModName(current.modName);
        const fallbackName = normalizeInstallModName(result.fallbackName);
        const fomodName = result.fomodInstaller.moduleName.trim();
        const shouldUseFomodName = fomodName && (!currentName || currentName === fallbackName);
        return {
          ...current,
          phase: 'fomod',
          isFomod: true,
          fomodInstaller: result.fomodInstaller,
          selectedFomodOptionIds: initialFomodSelection(result.fomodInstaller),
          fomodStepIndex: 0,
          activeFomodOptionId: null,
          layoutPreview: null,
          modName: shouldUseFomodName ? fomodName : current.modName,
          validationMessage: null,
          errorMessage: null
        };
      }

      const phase =
        current.phase === 'details' ||
        current.phase === 'installing' ||
        current.phase === 'conflict' ||
        current.phase === 'error'
          ? current.phase
          : 'options';
      return {
        ...current,
        phase,
        layoutPreview: result.layoutPreview,
        errorMessage: null
      };
    });
  };

  const watchInstallAnalysis = (
    operationId: string,
    promise: Promise<InstallAnalysisResult>
  ): Promise<InstallAnalysisResult> => {
    installAnalysisPromiseRef.current = promise;
    void promise
      .then((result) => {
        if (installAnalysisPromiseRef.current === promise) {
          applyInstallAnalysisResult(operationId, result);
        }
      })
      .catch((error) => {
        if (installAnalysisPromiseRef.current !== promise) {
          return;
        }

        const message = errorMessage(error);
        setInstallDialogPatchForOperation(operationId, {
          phase: 'error',
          errorMessage: message
        });
        setMessage(message);
      });

    return promise;
  };

  const analyzeInstallLayout = async (
    source: InstallSource,
    operationId: string,
    selectedFomodOptionIds: string[] = [],
    project: FluxoraProject | null = selectedProject
  ): Promise<FluxoraContentLayoutPreview> => {
    if (!project) {
      throw new Error('Open a build before installing mods.');
    }

    if (selectedFomodOptionIds.length > 0) {
      return window.fluxora.downloads.analyzeFomodContentLayout(
        {
          projectDirectory: project.projectDirectory,
          downloadPath: source.sourcePath,
          existingModMode: 0,
          selectedOptionIds: selectedFomodOptionIds
        },
        { operationId }
      );
    }

    return window.fluxora.downloads.analyzeContentLayout(
      {
        projectDirectory: project.projectDirectory,
        downloadPath: source.sourcePath,
        existingModMode: 0
      },
      { operationId }
    );
  };

  const startInstallFlow = async (
    source: InstallSource,
    placement: InstallModOrderPlacement | null = null
  ) => {
    const project = selectedProject;
    if (!project || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    const operationId = createRendererOperationId('install_flow');
    const fallbackName = defaultInstallModName(source.displayName, source.sourcePath);
    setDownloadMenuId(null);
    setMessage(null);
    setInstallDialog({
      phase: 'options',
      source,
      operationId,
      isFomod: false,
      fomodInstaller: null,
      selectedFomodOptionIds: [],
      fomodStepIndex: 0,
      activeFomodOptionId: null,
      layoutPreview: null,
      modName: fallbackName,
      modOrderPlacement: placement,
      existingModMode: 0,
      placementOverrides: {},
      draggedSourcePath: null,
      validationMessage: null,
      errorMessage: null
    });

    const analysisPromise = (async (): Promise<InstallAnalysisResult> => {
      await refreshInstalledModNamesForInstall(project, operationId);
      const fomodInstaller = await window.fluxora.downloads.analyzeFomod(
        project.projectDirectory,
        source.sourcePath,
        { operationId }
      );

      if (fomodInstaller.isFomod) {
        return {
          kind: 'fomod',
          fallbackName,
          fomodInstaller
        };
      }

      const layoutPreview = await analyzeInstallLayout(source, operationId, [], project);
      return {
        kind: 'layout',
        fallbackName,
        layoutPreview
      };
    })();
    watchInstallAnalysis(operationId, analysisPromise);
  };

  const loadDownloadsWorkspace = async (
    project = selectedProject,
    options: WorkspaceLoadOptions = {}
  ) => {
    if (!canBeginWorkspaceStoreLoad(options)) {
      return false;
    }
    const loadSequence = beginWorkspaceStoreLoad('downloads');
    if (workspaceStoreBusyLoadSequenceRef.current.downloads !== null) {
      workspaceStoreBusyLoadSequenceRef.current.downloads = null;
      setDownloadsBusyLabel(null);
    }
    const capabilities = downloadCapabilityView(project, bridgeStatus);
    if (!project || !bridgeStatus?.ready) {
      return false;
    }
    if (!capabilities.bridgeAvailable) {
      dispatchDownloadsWorkspace({ type: 'items-loaded', items: [] });
      return true;
    }

    const showBusy = options.showBusy ?? false;
    const hasCurrentRows = downloadsWorkspace.items.length > 0;
    const showLoading = options.showLoading ?? !hasCurrentRows;
    const resetScroll = options.resetScroll ?? true;
    const operationId = options.operationId ?? createRendererOperationId('downloads_load');
    dispatchDownloadsWorkspace({ type: 'load-started', silent: !showLoading });
    if (showBusy) {
      workspaceStoreBusyLoadSequenceRef.current.downloads = loadSequence;
      setDownloadsBusyLabel('Loading downloads');
      setMessage(null);
    }

    try {
      const nextDownloads = await window.fluxora.downloads.list(project.projectDirectory, {
        operationId
      });
      if (!isCurrentWorkspaceStoreLoad('downloads', loadSequence)) {
        return false;
      }
      dispatchDownloadsWorkspace({ type: 'items-loaded', items: nextDownloads });
      if (resetScroll) {
        setDownloadListScrollTop(0);
      }
      return true;
    } catch (error) {
      if (!isCurrentWorkspaceStoreLoad('downloads', loadSequence)) {
        return false;
      }
      const message = errorMessage(error);
      dispatchDownloadsWorkspace({ type: 'load-failed', message, silent: !showLoading });
      setMessage(message);
      return false;
    } finally {
      if (workspaceStoreBusyLoadSequenceRef.current.downloads === loadSequence) {
        workspaceStoreBusyLoadSequenceRef.current.downloads = null;
        setDownloadsBusyLabel(null);
      }
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
      await loadDownloadsWorkspace(selectedProject, {
        operationId,
        showBusy: false,
        showLoading: false
      });
      if (reloadMods) {
        await loadModsWorkspace(selectedProject);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const clearDownloadDropReset = () => {
    if (downloadDropResetRef.current !== null) {
      window.clearTimeout(downloadDropResetRef.current);
      downloadDropResetRef.current = null;
    }
  };

  const resetDownloadDropCue = () => {
    clearDownloadDropReset();
    downloadDropCueRef.current = 'idle';
    setDownloadDropCueState((current) => (current === 'idle' ? current : 'idle'));
  };

  const showDownloadDropCue = (cue: DownloadDropCue) => {
    clearDownloadDropReset();
    downloadDropCueRef.current = cue;
    setDownloadDropCueState((current) => (current === cue ? current : cue));
  };

  const scheduleDownloadDropIdle = (delayMs = 140) => {
    clearDownloadDropReset();
    downloadDropResetRef.current = window.setTimeout(() => {
      downloadDropCueRef.current = 'idle';
      setDownloadDropCueState((current) => (current === 'idle' ? current : 'idle'));
      downloadDropResetRef.current = null;
    }, delayMs);
  };

  const activateRightPane = (id: RightPaneId) => {
    clearRowReorderSession();
    resetDownloadDropCue();
    setActiveRightPane(id);
  };

  const isDownloadsDropPosition = (event: Exclude<FluxoraFileDropEvent, { type: 'leave' }>) => {
    const surface = downloadDropSurfaceRef.current;
    if (!surface || !selectedProject || !downloadCapabilities.bridgeAvailable) {
      return false;
    }

    return isFileDropPositionInsideRect(event.position, surface.getBoundingClientRect());
  };

  const importDroppedDownloadArchives = async (sourcePaths: readonly string[]) => {
    const project = selectedProject;
    const paths = normalizeDownloadDropPaths(sourcePaths);
    if (
      !project ||
      paths.length === 0 ||
      !downloadCapabilities.bridgeAvailable ||
      downloadsBusyLabel ||
      downloadDropCueRef.current === 'importing'
    ) {
      scheduleDownloadDropIdle();
      return;
    }

    showDownloadDropCue('importing');
    await runDownloadMutation(
      paths.length === 1 ? 'Importing dropped archive' : `Importing ${paths.length} dropped archives`,
      async (operationId) => {
        let lastImported: FluxoraDownloadEntry | null = null;
        for (const sourcePath of paths) {
          lastImported = await window.fluxora.downloads.importFile(
            project.projectDirectory,
            sourcePath,
            { operationId }
          );
        }

        if (lastImported) {
          dispatchDownloadsWorkspace({ type: 'selected', id: lastImported.id });
          setMessage(
            paths.length === 1
              ? `Imported ${downloadTitle(lastImported)}`
              : `Imported ${paths.length} archives`
          );
        }
      }
    );
    scheduleDownloadDropIdle(320);
  };

  const handleFluxoraFileDrop = (event: FluxoraFileDropEvent) => {
    if (!selectedProject || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    if (event.type === 'leave') {
      scheduleDownloadDropIdle();
      return;
    }

    const isInsideDownloads = isDownloadsDropPosition(event);
    if (event.type === 'enter' || event.type === 'over') {
      if (isInsideDownloads) {
        showDownloadDropCue('hover');
      } else {
        scheduleDownloadDropIdle();
      }
      return;
    }

    if (isInsideDownloads || downloadDropCueRef.current === 'hover') {
      void importDroppedDownloadArchives(event.paths);
      return;
    }

    scheduleDownloadDropIdle();
  };

  const handleDownloadsDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!selectedProject || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    showDownloadDropCue('hover');
  };

  const handleDownloadsDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!selectedProject || !downloadCapabilities.bridgeAvailable) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    showDownloadDropCue('hover');
  };

  const handleDownloadsDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    scheduleDownloadDropIdle();
  };

  const handleDownloadsDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void importDroppedDownloadArchives(downloadDropPathsFromDataTransfer(event.dataTransfer));
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

  const installDownload = async (
    entry: FluxoraDownloadEntry | null = selectedDownloadItem,
    placement: InstallModOrderPlacement | null = null
  ) => {
    if (!selectedProject || !entry) {
      return;
    }

    if (!entry.canInstall) {
      setMessage('This download is not ready to install yet.');
      return;
    }

    const source: InstallSource = {
      kind: 'download',
      sourcePath: downloadPath(entry),
      displayName: downloadTitle(entry),
      fileName: entry.fileName || fileNameFromPath(downloadPath(entry))
    };
    await startInstallFlow(source, placement);
  };

  const downloadInstallEntryFromDrag = (
    dataTransfer: DataTransfer
  ): FluxoraDownloadEntry | null => {
    const entryId =
      dataTransferText(dataTransfer, downloadInstallDragType) || draggedDownloadInstallId;
    return downloadsWorkspace.items.find((entry) => entry.id === entryId) ?? null;
  };

  const isDownloadInstallDrag = (dataTransfer: DataTransfer): boolean =>
    Boolean(draggedDownloadInstallId) ||
    Array.from(dataTransfer.types).includes(downloadInstallDragType);

  const clearDownloadInstallDrag = () => {
    setDraggedDownloadInstallId(null);
    setDownloadInstallDropTarget(null);
  };

  const handleDownloadInstallDragStart = (
    event: ReactDragEvent<HTMLDivElement>,
    entry: FluxoraDownloadEntry
  ) => {
    if (!entry.canInstall || Boolean(downloadsBusyLabel)) {
      event.preventDefault();
      return;
    }

    dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
    setDraggedDownloadInstallId(entry.id);
    setDownloadInstallDropTarget(null);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(downloadInstallDragType, entry.id);
  };

  const handleDownloadInstallDragEnd = () => {
    clearDownloadInstallDrag();
  };

  const modInstallPlacementForDrag = (
    event: ReactDragEvent<HTMLDivElement>,
    item: FluxoraModOrderItem
  ): InstallModOrderPlacement | null => {
    if (isModOverwriteItem(item)) {
      return null;
    }

    return {
      targetOrderId: item.orderId,
      placement: rowDropPlacementFromPointer(event.currentTarget, event.clientY)
    };
  };

  const handleModInstallDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    item: FluxoraModOrderItem
  ) => {
    if (!isDownloadInstallDrag(event.dataTransfer)) {
      return;
    }

    const placement = modInstallPlacementForDrag(event, item);
    if (!placement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDownloadInstallDropTarget({
      orderId: placement.targetOrderId,
      placement: placement.placement
    });
  };

  const handleModInstallDrop = async (
    event: ReactDragEvent<HTMLDivElement>,
    item: FluxoraModOrderItem
  ) => {
    if (!isDownloadInstallDrag(event.dataTransfer)) {
      return;
    }

    const entry = downloadInstallEntryFromDrag(event.dataTransfer);
    const placement = modInstallPlacementForDrag(event, item);
    event.preventDefault();
    event.stopPropagation();
    clearDownloadInstallDrag();
    if (entry && placement) {
      await installDownload(entry, placement);
    }
  };

  const handleModInstallSurfaceDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!isDownloadInstallDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDownloadInstallDropTarget(null);
  };

  const handleModInstallSurfaceDrop = async (event: ReactDragEvent<HTMLElement>) => {
    if (!isDownloadInstallDrag(event.dataTransfer)) {
      return;
    }

    const entry = downloadInstallEntryFromDrag(event.dataTransfer);
    event.preventDefault();
    clearDownloadInstallDrag();
    if (entry) {
      await installDownload(entry, null);
    }
  };

  const downloadDeletionEntriesFor = (entry: FluxoraDownloadEntry): FluxoraDownloadEntry[] => {
    if (!entry.canDelete) {
      return [];
    }

    if (!downloadsWorkspace.selectedIds.has(entry.id)) {
      return [entry];
    }

    return selectedDownloadDeletionEntries.length > 1 ? selectedDownloadDeletionEntries : [entry];
  };

  const requestDeleteDownload = (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canDelete) {
      return;
    }

    const targets = downloadDeletionEntriesFor(entry);
    if (targets.length === 0) {
      return;
    }

    const deletedDownloadTitle = downloadTitle(targets[0] ?? entry);
    setDeletionConfirmation({
      kind: 'download',
      itemName: deletedDownloadTitle,
      itemCount: targets.length,
      onConfirm: () => deleteDownloads(targets)
    });
  };

  const deleteDownload = async (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canDelete) {
      return;
    }

    const project = selectedProject;
    const deletedDownloadTitle = downloadTitle(entry);

    const operationId = createRendererOperationId('downloads_delete');
    beginOperationOverlay({
      operationId,
      kind: 'download-delete',
      title: 'Удаляем файл',
      statusText: 'Удаляем файл из загрузок',
      currentItem: deletedDownloadTitle,
      percent: 8
    });
    setDownloadsBusyLabel('Deleting download');
    setMessage(null);

    try {
      await window.fluxora.downloads.delete(project.projectDirectory, downloadPath(entry), {
        operationId
      });
      setOperationOverlay((current) =>
        current && current.operationId === operationId
          ? {
              ...current,
              statusText: 'Обновляем список загрузок',
              percent: Math.max(current.percent ?? 0, 84)
            }
          : current
      );
      await loadDownloadsWorkspace(project);
      closeOperationOverlay(operationId);
    } catch (error) {
      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    } finally {
      setDownloadsBusyLabel(null);
    }
  };

  const deleteDownloads = async (entries: FluxoraDownloadEntry[]) => {
    const targets = entries.filter((entry) => entry.canDelete);
    if (!selectedProject || targets.length === 0) {
      return;
    }

    if (targets.length === 1) {
      await deleteDownload(targets[0]!);
      return;
    }

    const project = selectedProject;
    const operationId = createRendererOperationId('downloads_delete_bulk');
    const targetLabel = deletionSubjectLabel('download', '', targets.length);
    beginOperationOverlay({
      operationId,
      kind: 'download-delete',
      title: 'Удаляем файлы',
      statusText: 'Удаляем файлы из загрузок',
      currentItem: targetLabel,
      percent: 8
    });
    setDownloadsBusyLabel('Deleting downloads');
    setMessage(null);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const entry = targets[index]!;
        const currentPercent = Math.min(82, 8 + Math.round((index / targets.length) * 72));
        setOperationOverlay((current) =>
          current && current.operationId === operationId
            ? {
                ...current,
                currentItem: downloadTitle(entry),
                statusText: `Удаляем файл ${index + 1} из ${targets.length}`,
                percent: Math.max(current.percent ?? 0, currentPercent)
              }
            : current
        );
        await window.fluxora.downloads.delete(project.projectDirectory, downloadPath(entry), {
          operationId
        });
      }

      setOperationOverlay((current) =>
        current && current.operationId === operationId
          ? {
              ...current,
              statusText: 'Обновляем список загрузок',
              currentItem: targetLabel,
              percent: Math.max(current.percent ?? 0, 84)
            }
          : current
      );
      await loadDownloadsWorkspace(project);
      closeOperationOverlay(operationId);
    } catch (error) {
      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    } finally {
      setDownloadsBusyLabel(null);
    }
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

  const registerNxmProtocol = async (
    options: {
      operationId?: string;
      showBusy?: boolean;
      showMessage?: boolean;
    } = {}
  ): Promise<FluxoraNxmProtocolResult | null> => {
    const operationId = options.operationId ?? createRendererOperationId('nxm_register');
    const showBusy = options.showBusy ?? true;
    const showMessage = options.showMessage ?? true;
    if (showBusy) {
      setDownloadsBusyLabel('Registering NXM');
    }
    if (showMessage) {
      setMessage(null);
    }

    try {
      const result = await window.fluxora.nxm.registerProtocol({ operationId });
      const nextStatus = await window.fluxora.bridge.getStatus({ operationId });
      setBridgeStatus(nextStatus);
      if (showMessage) {
        setMessage(result.message);
      }
      return result;
    } catch (error) {
      if (showMessage) {
        setMessage(errorMessage(error));
      }
      return null;
    } finally {
      if (showBusy) {
        setDownloadsBusyLabel(null);
      }
    }
  };

  const importInboundDownloadsForProject = async (
    project: FluxoraProject,
    event: Pick<FluxoraNxmInboundLinksCaptured, 'count' | 'operationId'>,
    options: {
      showBusy?: boolean;
    } = {}
  ) => {
    const operationId = event.operationId || createRendererOperationId('nxm_inbound_event');
    const showBusy = options.showBusy ?? false;
    if (showBusy) {
      setDownloadsBusyLabel('Importing NXM');
    }
    setMessage(null);

    try {
      const imported = await window.fluxora.nxm.importInboundDownloads(
        project.projectDirectory,
        { operationId }
      );
      const nextDownloads = await window.fluxora.downloads.list(project.projectDirectory, {
        operationId
      });
      dispatchDownloadsWorkspace({ type: 'items-loaded', items: nextDownloads });
      setMessage(
        imported.length === 0
          ? 'No inbound NXM links found.'
          : `Imported ${imported.length} NXM link(s).`
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (showBusy) {
        setDownloadsBusyLabel(null);
      }
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
    const selectedOptionIds = installFomodEvaluation.selectedOptionIds;
    const fallbackName =
      installDialog.fomodInstaller.moduleName.trim() ||
      defaultInstallModName(installDialog.source.displayName, installDialog.source.sourcePath);
    setInstallDialogPatch({
      phase: 'options',
      layoutPreview: null,
      selectedFomodOptionIds: selectedOptionIds,
      modName: installDialog.modName.trim() || fallbackName,
      validationMessage: null
    });

    const analysisPromise = analyzeInstallLayout(
      installDialog.source,
      operationId,
      selectedOptionIds,
      selectedProject
    ).then((layoutPreview): InstallAnalysisResult => ({
      kind: 'layout',
      fallbackName,
      layoutPreview
    }));
    watchInstallAnalysis(operationId, analysisPromise);
  };

  const waitForInstallLayoutPreview = async (
    currentDialog: InstallDialogState
  ): Promise<FluxoraContentLayoutPreview | null> => {
    if (currentDialog.layoutPreview) {
      return currentDialog.layoutPreview;
    }

    const analysisPromise = installAnalysisPromiseRef.current;
    if (!analysisPromise) {
      setInstallDialogPatch({
        validationMessage: 'Archive details are not ready yet.'
      });
      return null;
    }

    try {
      const result = await analysisPromise;
      if (result.kind === 'fomod') {
        applyInstallAnalysisResult(currentDialog.operationId, result);
        return null;
      }

      applyInstallAnalysisResult(currentDialog.operationId, result);
      return result.layoutPreview;
    } catch (error) {
      setInstallDialogPatch({
        phase: 'error',
        errorMessage: errorMessage(error)
      });
      return null;
    }
  };

  const applyOptimisticInstalledMod = (
    installed: FluxoraInstalledModSummary,
    placement: InstallModOrderPlacement | null
  ) => {
    const optimistic = optimisticModInstallState(
      installedMods,
      modsWorkspace.items,
      installed,
      placement
    );
    setInstalledMods(optimistic.installedMods);
    dispatchModsWorkspace({ type: 'items-loaded', items: optimistic.items });
    dispatchModsWorkspace({ type: 'selected', orderId: optimistic.installedOrderId });
  };

  const reconcileInstalledModAfterInstall = async (
    project: FluxoraProject,
    profileName: string,
    installed: FluxoraInstalledModSummary,
    placement: InstallModOrderPlacement | null,
    operationId: string
  ) => {
    try {
      const snapshot = await window.fluxora.mods.getPersistedWorkspace(
        project.projectDirectory,
        profileName,
        { operationId }
      );
      const reconciled = optimisticModInstallState(
        snapshot.installedMods,
        snapshot.modOrder,
        installed,
        placement
      );
      setInstalledMods(reconciled.installedMods);
      dispatchModsWorkspace({ type: 'items-loaded', items: reconciled.items });
      dispatchModsWorkspace({ type: 'selected', orderId: reconciled.installedOrderId });

      if (!placement || reconciled.installedOrderId.startsWith('pending-install:')) {
        return;
      }

      const targetIndex = targetIndexForDrop(
        snapshot.modOrder,
        reconciled.installedOrderId,
        placement.targetOrderId,
        placement.placement
      );
      if (targetIndex === null) {
        return;
      }

      const confirmedOrder = await window.fluxora.mods.moveOrderItem(
        project.projectDirectory,
        profileName,
        reconciled.installedOrderId,
        targetIndex,
        { operationId }
      );
      dispatchModsWorkspace({ type: 'items-loaded', items: confirmedOrder });
      dispatchModsWorkspace({ type: 'selected', orderId: reconciled.installedOrderId });
    } catch (error) {
      void window.fluxora.ui.log({
        level: 'warning',
        category: 'ModInstall',
        message: `Installed mod background reconciliation deferred: ${errorMessage(error)}`,
        operationId
      });
    }
  };

  const submitInstallOptions = async (selectedExistingModMode?: 1 | 2) => {
    if (!selectedProject || !installDialog) {
      return;
    }

    if (selectedExistingModMode) {
      setInstallDialogPatch({ existingModMode: selectedExistingModMode });
    }

    const modName = normalizeInstallModName(installDialog.modName);
    const nameValidation = validateInstallModName(modName);
    if (nameValidation) {
      setInstallDialogPatch({ validationMessage: nameValidation });
      return;
    }

    const layoutPreview = await waitForInstallLayoutPreview(installDialog);
    if (!layoutPreview) {
      return;
    }

    const placementOverrides = createPlacementOverrides(
      layoutPreview,
      installDialog.placementOverrides
    );
    if (!layoutPreview.canInstall && placementOverrides.length === 0) {
      setInstallDialogPatch({
        validationMessage: 'The archive is blocked by placement rules. Open Details and move files before installing.'
      });
      return;
    }

    if (!selectedExistingModMode) {
      const existingModNameForPrompt = await resolveExistingModNameForInstall(
        selectedProject,
        installDialog.operationId,
        modName
      );
      if (existingModNameForPrompt) {
        setInstallDialogPatch({
          phase: 'conflict',
          existingModMode: 0,
          validationMessage: null
        });
        return;
      }
    }

    const existingModNameForInstall = selectedExistingModMode
      ? installExistingModName ?? findExistingInstalledModName(installedModNames, modName) ?? modName
      : null;
    const existingModMode: FluxoraExistingModInstallMode = selectedExistingModMode ?? 0;

    if (existingModNameForInstall && existingModMode === 0) {
      setInstallDialogPatch({
        phase: 'conflict',
        validationMessage: null
      });
      return;
    }

    if (installSubmitInFlightRef.current === installDialog.operationId) {
      return;
    }
    installSubmitInFlightRef.current = installDialog.operationId;

    const placementOverridesJson =
      placementOverrides.length > 0 ? JSON.stringify(placementOverrides) : undefined;

    setInstallDialogPatch({
      phase: 'installing',
      validationMessage: null
    });
    setDownloadsBusyLabel(existingModNameForInstall ? 'Updating mod' : 'Installing mod');

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
      applyOptimisticInstalledMod(installed, installDialog.modOrderPlacement);
      setInstallDialog(null);
      void loadDownloadsWorkspace(selectedProject, {
        operationId: installDialog.operationId,
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
      void reconcileInstalledModAfterInstall(
        selectedProject,
        modWorkspaceProfileName,
        installed,
        installDialog.modOrderPlacement,
        installDialog.operationId
      );
    } catch (error) {
      setInstallDialogPatch({
        phase: 'error',
        errorMessage: errorMessage(error)
      });
      setMessage(errorMessage(error));
    } finally {
      if (installSubmitInFlightRef.current === installDialog.operationId) {
        installSubmitInFlightRef.current = null;
      }
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
          try {
            const nextNexusStatus = await window.fluxora.nexus.getAuthStatus({ operationId });
            if (isMounted) {
              rememberNexusStatus(nextNexusStatus);
            }
          } catch {
            if (isMounted) {
              setNexusStatus((currentStatus) => createCheckingNexusAuthStatus(currentStatus));
            }
          }
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
    const handleOnline = () => {
      const operationId = createRendererOperationId('nexus_online_retry');
      markNexusStatusChecking();
      setApiLimitsBusy(true);
      void Promise.all([
        window.fluxora.nexus.getAuthStatus({ operationId }),
        window.fluxora.apiLimits.list({ operationId })
      ]).then(
        ([nextNexusStatus, nextApiLimits]) => {
          rememberNexusStatus(nextNexusStatus);
          rememberApiLimitProviders(nextApiLimits.providers);
        },
        () => {
          markNexusStatusChecking();
        }
      ).finally(() => setApiLimitsBusy(false));
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (
      isSecondaryWindow ||
      !bridgeStatus?.ready ||
      !nexusVerifiedLinked ||
      nxmAutoRegistrationAttemptedRef.current
    ) {
      return;
    }

    const platform = appInfo?.platform ?? bridgeStatus.capabilities?.platform;
    if (platform !== 'win32') {
      return;
    }

    nxmAutoRegistrationAttemptedRef.current = true;
    const operationId = createRendererOperationId('nxm_auto_register');
    void (async () => {
      const result = await registerNxmProtocol({
        operationId,
        showBusy: false,
        showMessage: false
      });
      if (result && !result.registered) {
        setMessage(result.message);
      }
    })();
  }, [
    appInfo?.platform,
    bridgeStatus?.capabilities?.platform,
    bridgeStatus?.ready,
    isSecondaryWindow,
    nexusVerifiedLinked
  ]);

  useEffect(() => {
    if (isBuildSettingsWindow && buildSettingsProjectId) {
      setSelectedProjectId(buildSettingsProjectId);
    }

    if (isModDetailsWindow && modDetailsProjectId) {
      setSelectedProjectId(modDetailsProjectId);
    }

    if (isTextEditorWindow && textEditorProjectId) {
      setSelectedProjectId(textEditorProjectId);
    }

    if (isFilePreviewWindow && filePreviewProjectId) {
      setSelectedProjectId(filePreviewProjectId);
    }
  }, [
    buildSettingsProjectId,
    filePreviewProjectId,
    isBuildSettingsWindow,
    isFilePreviewWindow,
    isModDetailsWindow,
    isTextEditorWindow,
    modDetailsProjectId,
    textEditorProjectId
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.platform = chromePlatform;
  }, [chromePlatform]);

  useEffect(() => {
    activeAiRunRef.current?.handle?.dispose();
    activeAiRunRef.current = null;
    dispatchAiChat({
      type: 'restore-session',
      session: loadAiSession(window.localStorage, aiSessionScope)
    });
  }, [aiSessionScope]);

  useEffect(() => {
    saveAiSession(window.localStorage, aiChat.session);
  }, [aiChat.session]);

  useEffect(() => {
    saveAiChatSettings(window.localStorage, aiChatSettings);
  }, [aiChatSettings]);

  useEffect(() => {
    setAiChatSettings((current) => {
      const next = normalizeAiChatSettings(current, aiHostStatus);
      return next.modelId === current.modelId && next.routingPreset === current.routingPreset
        ? current
        : next;
    });
  }, [aiHostStatus]);

  useEffect(() => {
    if (!aiChat.isOpen || isSecondaryWindow) {
      return;
    }

    let isCurrent = true;
    const operationId = createRendererOperationId('ai_status');
    window.fluxora.ai.getStatus({ operationId }).then(
      (status) => {
        if (isCurrent) {
          setAiHostStatus(status);
        }
      },
      (error) => {
        if (!isCurrent) {
          return;
        }

        setAiHostStatus({
          ready: false,
          operationId,
          health: 'unavailable',
          providers: [],
          models: [],
          capabilities: {},
          error: {
            code: 'ai.host.unavailable',
            message: errorMessage(error),
            category: 'transport',
            retryable: true,
            capabilityId: null,
            details: {}
          }
        });
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [aiChat.isOpen, isSecondaryWindow]);

  useEffect(
    () => () => {
      activeAiRunRef.current?.handle?.dispose();
      activeAiRunRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (isSecondaryWindow) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 'g' &&
        !isEditableShortcutTarget(event.target)
      ) {
        event.preventDefault();
        dispatchAiChat({ type: 'toggle-open' });
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSecondaryWindow]);

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
    if (!modMenuOrderId) {
      setModMenuPosition(null);
    }
  }, [modMenuOrderId]);

  useEffect(() => {
    if (!pluginMenuOrderId) {
      setPluginMenuPosition(null);
    }
  }, [pluginMenuOrderId]);

  useEffect(() => {
    if (!downloadMenuId) {
      setDownloadMenuPosition(null);
    }
  }, [downloadMenuId]);

  useEffect(() => {
    if (!modMenuOrderId && !pluginMenuOrderId && !downloadMenuId && !modsToolbarMenuPosition) {
      return;
    }

    const closeRowContextMenus = () => {
      setModMenuOrderId(null);
      setPluginMenuOrderId(null);
      setDownloadMenuId(null);
      setModsToolbarMenuPosition(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[data-row-context-menu-surface="true"], [data-row-context-menu-trigger="true"]'
        )
      ) {
        return;
      }

      closeRowContextMenus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRowContextMenus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeRowContextMenus);
    window.addEventListener('scroll', closeRowContextMenus, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeRowContextMenus);
      window.removeEventListener('scroll', closeRowContextMenus, true);
    };
  }, [downloadMenuId, modMenuOrderId, modsToolbarMenuPosition, pluginMenuOrderId]);

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
      !bridgeStatus?.ready ||
      openingBuildOperationIdRef.current ||
      coordinatedWorkspaceLoadRef.current?.projectId === selectedProject.id
    ) {
      return;
    }

    void loadModsWorkspace(selectedProject);
  }, [
    activeRoute,
    bridgeStatus?.ready,
    selectedProject?.projectDirectory,
    modWorkspaceProfileName
  ]);

  useEffect(() => {
    if (!isModDetailsWindow || !modDetailsModId || modsWorkspace.loadState !== 'ready') {
      return;
    }

    const targetMod =
      modsWorkspace.items.find(
        (item) => item.isMod && modOrderItemMatchesLookup(item, modDetailsModId)
      ) ?? null;

    if (targetMod && modsWorkspace.selectedOrderId !== targetMod.orderId) {
      dispatchModsWorkspace({ type: 'selected', orderId: targetMod.orderId });
    }
  }, [
    isModDetailsWindow,
    modDetailsModId,
    modsWorkspace.items,
    modsWorkspace.loadState,
    modsWorkspace.selectedOrderId
  ]);

  useEffect(() => {
    if (!isModDetailsWindow || !selectedModItem?.isMod) {
      return;
    }

    setModDetailsSummary(selectedModItem);
  }, [isModDetailsWindow, selectedModItem?.id, selectedModItem?.orderId]);

  useEffect(() => {
    if (!isModDetailsWindow || !bridgeStatus?.ready || !modDetailsModId) {
      return;
    }

    const projectDirectory =
      selectedProject?.projectDirectory ?? initialModDetailsBootstrap?.projectDirectory ?? '';
    if (!projectDirectory) {
      return;
    }

    let isCurrent = true;
    const operationId = createRendererOperationId('mods_details_summary');
    void window.fluxora.mods
      .getModDetailsSummary(projectDirectory, selectedProjectProfileName, modDetailsModId, {
        operationId
      })
      .then(
        (summary) => {
          if (isCurrent) {
            setModDetailsSummary(summary);
          }
        },
        (error) => {
          if (isCurrent && !modDetailsSummary) {
            setMessage(errorMessage(error));
          }
        }
      );

    return () => {
      isCurrent = false;
    };
  }, [
    bridgeStatus?.ready,
    initialModDetailsBootstrap?.projectDirectory,
    isModDetailsWindow,
    modDetailsModId,
    selectedProject?.projectDirectory,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'plugins') ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      openingBuildOperationIdRef.current ||
      coordinatedWorkspaceLoadRef.current?.projectId === selectedProject.id
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
      !bridgeStatus?.ready ||
      openingBuildOperationIdRef.current ||
      coordinatedWorkspaceLoadRef.current?.projectId === selectedProject.id
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
    const downloadsDirectory = selectedProject?.paths?.downloadsDirectory;
    if (
      isSecondaryWindow ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      !downloadCapabilities.bridgeAvailable ||
      !downloadsDirectory
    ) {
      return undefined;
    }

    const operationId = createRendererOperationId('downloads_watch_folder');
    void window.fluxora.downloads
      .watchFolder(selectedProject.projectDirectory, downloadsDirectory, { operationId })
      .catch(() => undefined);

    return () => {
      void window.fluxora.downloads
        .unwatchFolder({ operationId: createRendererOperationId('downloads_unwatch_folder') })
        .catch(() => undefined);
    };
  }, [
    bridgeStatus?.ready,
    downloadCapabilities.bridgeAvailable,
    isSecondaryWindow,
    selectedProject?.paths?.downloadsDirectory,
    selectedProject?.projectDirectory
  ]);

  const ensureBuildContentWatch = useCallback(
    (
      project: FluxoraProject,
      profileName: string,
      operationId: string
    ): Promise<void> => {
      const modsDirectory = project.paths?.modsDirectory;
      const profilesDirectory = project.paths?.profilesDirectory;
      if (!modsDirectory || !profilesDirectory) {
        return Promise.reject(new Error('Build content folders are unavailable.'));
      }

      const key = buildContentWatchKeyForProject(project, profileName);
      if (key === null) {
        return Promise.reject(new Error('Build content folders are unavailable.'));
      }
      if (buildContentWatchKeyRef.current !== key) {
        // Exact workspace reuse is valid only while watcher coverage is
        // continuous. A project/profile/root transition creates an uncovered
        // interval for the previous key, even when that key is selected again
        // later (A -> B -> A), so require a fresh exact reconciliation.
        buildContentWatchGenerationRef.current += 1;
        exactWorkspaceWatchCoverageRef.current = null;
      }
      if (
        buildContentWatchKeyRef.current === key &&
        buildContentWatchPromiseRef.current
      ) {
        return buildContentWatchPromiseRef.current;
      }

      const request = window.fluxora.buildContent
        .watch(
          {
            projectDirectory: project.projectDirectory,
            modsDirectory,
            profilesDirectory,
            profileName,
            gameDirectory: project.paths?.gameDirectory
          },
          { operationId }
        )
        .then((result) => {
          if (!result.accepted) {
            throw new Error('Build content watcher setup was superseded.');
          }
        });
      buildContentWatchKeyRef.current = key;
      buildContentWatchPromiseRef.current = request;
      void request.catch(() => {
        if (buildContentWatchPromiseRef.current === request) {
          buildContentWatchKeyRef.current = null;
          buildContentWatchPromiseRef.current = null;
        }
      });
      return request;
    },
    []
  );

  useEffect(() => {
    if (
      isSecondaryWindow ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      loadedWorkspaceProjectId !== selectedProject.id
    ) {
      return undefined;
    }

    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const desiredWatchKey = buildContentWatchKeyForProject(project, profileName);
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    let requiresReconciliation =
      desiredWatchKey === null ||
      buildContentWatchKeyRef.current !== desiredWatchKey ||
      buildContentWatchPromiseRef.current === null;

    const reconcileAfterWatchInstall = async (
      watchKey: string,
      watchPromise: Promise<void>
    ): Promise<void> => {
      const liveScope = selectedWorkspaceScopeRef.current;
      if (
        cancelled ||
        liveScope.project?.projectDirectory !== project.projectDirectory ||
        liveScope.profileName !== profileName ||
        buildContentWatchKeyRef.current !== watchKey ||
        buildContentWatchPromiseRef.current !== watchPromise
      ) {
        return;
      }
      const scopeKey = buildContentScopeKey(project.projectDirectory);
      const contentRevision =
        buildContentObservedRevisionByScopeRef.current.get(scopeKey) ?? 0;
      const invalidatedRevision =
        buildContentInvalidatedRevisionByScopeRef.current.get(scopeKey) ?? 0;
      if (invalidatedRevision < contentRevision) {
        // The event coordinator will perform the exact read after its native
        // invalidation succeeds. Starting here would allow a stale cache read.
        return;
      }
      const watchGeneration = buildContentWatchGenerationRef.current;
      const modsReconciled = await loadModsWorkspace(project, {
        operationId: createRendererOperationId('build_content_watch_reconciled_mods'),
        profileName,
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
      if (
        !modsReconciled ||
        cancelled ||
        selectedWorkspaceScopeRef.current.project?.projectDirectory !== project.projectDirectory ||
        selectedWorkspaceScopeRef.current.profileName !== profileName ||
        buildContentWatchKeyRef.current !== watchKey ||
        buildContentWatchPromiseRef.current !== watchPromise ||
        buildContentWatchGenerationRef.current !== watchGeneration ||
        (buildContentObservedRevisionByScopeRef.current.get(scopeKey) ?? 0) !== contentRevision ||
        (buildContentInvalidatedRevisionByScopeRef.current.get(scopeKey) ?? 0) < contentRevision
      ) {
        return;
      }
      const pluginsReconciled = await loadPluginsWorkspace(project, {
        operationId: createRendererOperationId('build_content_watch_reconciled_plugins'),
        profileName,
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
      if (
        !pluginsReconciled ||
        cancelled ||
        selectedWorkspaceScopeRef.current.project?.projectDirectory !== project.projectDirectory ||
        selectedWorkspaceScopeRef.current.profileName !== profileName ||
        buildContentWatchKeyRef.current !== watchKey ||
        buildContentWatchPromiseRef.current !== watchPromise ||
        buildContentWatchGenerationRef.current !== watchGeneration ||
        (buildContentObservedRevisionByScopeRef.current.get(scopeKey) ?? 0) !== contentRevision ||
        (buildContentInvalidatedRevisionByScopeRef.current.get(scopeKey) ?? 0) < contentRevision
      ) {
        return;
      }
      exactWorkspaceWatchCoverageRef.current = {
        contentRevision,
        watchGeneration,
        watchKey
      };
    };

    const installWatch = (): void => {
      if (cancelled || desiredWatchKey === null) {
        return;
      }
      const watchPromise = ensureBuildContentWatch(
        project,
        profileName,
        createRendererOperationId('build_content_watch')
      );
      void watchPromise.then(
        async () => {
          if (cancelled) {
            return;
          }
          retryAttempt = 0;
          if (requiresReconciliation) {
            await reconcileAfterWatchInstall(desiredWatchKey, watchPromise);
          }
        },
        () => {
          if (cancelled) {
            return;
          }
          requiresReconciliation = true;
          const delay = Math.min(250 * 2 ** Math.min(retryAttempt, 5), 5_000);
          retryAttempt += 1;
          retryTimer = window.setTimeout(installWatch, delay);
        }
      );
    };

    installWatch();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    bridgeStatus?.ready,
    ensureBuildContentWatch,
    isSecondaryWindow,
    loadedWorkspaceProjectId,
    selectedProject,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    if (isSecondaryWindow) {
      buildContentRefreshCoordinator.stop();
      return undefined;
    }
    buildContentRefreshCoordinator.resume();
    return () => {
      buildContentRefreshCoordinator.stop();
      buildContentWatchKeyRef.current = null;
      buildContentWatchPromiseRef.current = null;
      buildContentWatchGenerationRef.current += 1;
      exactWorkspaceWatchCoverageRef.current = null;
      void window.fluxora.buildContent
        .unwatch({ operationId: createRendererOperationId('build_content_unwatch') })
        .catch(() => undefined);
    };
  }, [buildContentRefreshCoordinator, isSecondaryWindow]);

  useEffect(() => {
    if (isSecondaryWindow) {
      return undefined;
    }

    return window.fluxora.downloads.onFolderChanged((event) => {
      if (!selectedProject || event.projectDirectory !== selectedProject.projectDirectory) {
        return;
      }

      const operationId = createRendererOperationId('downloads_folder_changed');
      void loadDownloadsWorkspace(selectedProject, {
        operationId,
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
    });
  }, [
    isSecondaryWindow,
    selectedProject?.projectDirectory
  ]);

  useEffect(() => {
    if (isSecondaryWindow) {
      return undefined;
    }

    const unsubscribe = window.fluxora.buildContent.onChanged((event) => {
      const eventRevision = buildContentEventRevisionRef.current + 1;
      buildContentEventRevisionRef.current = eventRevision;
      const eventScopeKey = buildContentScopeKey(event.projectDirectory);
      buildContentObservedRevisionByScopeRef.current.set(eventScopeKey, eventRevision);
      exactWorkspaceWatchCoverageRef.current = null;
      const eventProjectAtReceipt =
        selectedProject?.projectDirectory === event.projectDirectory ? selectedProject : null;
      let currentEventReconciled = false;
      if (eventProjectAtReceipt) {
        effectiveFileTreeCacheRef.current = {};
        effectiveFileTreeFailedRequestKeyRef.current = null;
        setEffectiveFileTreeError(null);
        setEffectiveFileTreeLoadingChildren({});
        effectiveFileTreeLoadingChildrenRef.current.clear();
      }
      const refreshEffectiveFileTree =
        Boolean(eventProjectAtReceipt) &&
        (activeRoute === 'build' || activeRoute === 'workspace') &&
        Boolean(activeRightPane === 'data' || effectiveFileTreeSnapshotRef.current);
      const sequenceGap = buildContentEventSequences.record(
        event.projectDirectory,
        event.sequence
      );
      const changedModPaths = sequenceGap
        ? [event.modsDirectory]
        : topLevelChangedModPaths(
            event.modsDirectory,
            event.changes
              .filter((change) => change.area === 'mods')
              .map((change) => change.path)
          );
      pendingBuildContentModPaths.add(event.projectDirectory, changedModPaths, eventRevision);
      void buildContentRefreshCoordinator
        .schedule(async () => {
          // The native route also clears plugin discovery caches. Failed and
          // unprocessed batches are restored so a transient bridge error cannot
          // silently lose cache-correctness work.
          const { failedScopes } = await drainPendingPathsWithRetry(
            pendingBuildContentModPaths,
            async (pending) => {
              await window.fluxora.mods.invalidateFileCaches(pending.scope, pending.paths, {
                operationId: createRendererOperationId('mods_invalidate_file_caches')
              });
              const pendingScopeKey = buildContentScopeKey(pending.scope);
              const previousRevision =
                buildContentInvalidatedRevisionByScopeRef.current.get(pendingScopeKey) ?? 0;
              buildContentInvalidatedRevisionByScopeRef.current.set(
                pendingScopeKey,
                Math.max(previousRevision, pending.revision)
              );
            }
          );
          const eventScopeFailed = failedScopes.some(
            (scope) => buildContentScopeKey(scope) === eventScopeKey
          );
          const liveScope = selectedWorkspaceScopeRef.current;
          const reconciliationProject =
            liveScope.project?.projectDirectory === event.projectDirectory
              ? liveScope.project
              : null;
          const reconciliationProfileName = liveScope.profileName;
          const eventWatchKey = reconciliationProject
            ? buildContentWatchKeyForProject(
                reconciliationProject,
                reconciliationProfileName
              )
            : null;
          const watchPromise = buildContentWatchPromiseRef.current;
          if (
            currentEventReconciled ||
            !reconciliationProject ||
            eventWatchKey === null ||
            buildContentWatchKeyRef.current !== eventWatchKey ||
            watchPromise === null
          ) {
            if (failedScopes.length > 0) {
              throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
            }
            return;
          }
          try {
            await watchPromise;
          } catch {
            if (failedScopes.length > 0) {
              throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
            }
            return;
          }
          const watchedScope = selectedWorkspaceScopeRef.current;
          if (
            watchedScope.project?.projectDirectory !== event.projectDirectory ||
            watchedScope.profileName !== reconciliationProfileName ||
            buildContentWatchPromiseRef.current !== watchPromise ||
            buildContentWatchKeyRef.current !== eventWatchKey
          ) {
            if (failedScopes.length > 0) {
              throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
            }
            return;
          }
          const reconciliationRevision =
            buildContentObservedRevisionByScopeRef.current.get(eventScopeKey) ?? 0;
          const invalidatedRevision =
            buildContentInvalidatedRevisionByScopeRef.current.get(eventScopeKey) ?? 0;
          const reconciliationWatchGeneration = buildContentWatchGenerationRef.current;
          if (
            currentEventReconciled ||
            selectedProjectDirectoryRef.current !== event.projectDirectory ||
            buildContentWatchKeyRef.current !== eventWatchKey
          ) {
            if (failedScopes.length > 0) {
              throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
            }
            return;
          }
          if (eventScopeFailed) {
            throw new Error('Build content invalidation remains pending for the active project.');
          }
          if (invalidatedRevision < reconciliationRevision) {
            throw new Error('Build content invalidation has not reached the active project revision.');
          }
          // Rebuild mod_files/conflict state before any consumer (especially the
          // effective tree) can observe the deliberately invalidated cache.
          const modsReconciled = await loadModsWorkspace(reconciliationProject, {
            operationId: createRendererOperationId('build_content_mods_changed'),
            resetScroll: false,
            showBusy: false,
            showLoading: false,
            profileName: reconciliationProfileName
          });
          if (
            selectedProjectDirectoryRef.current !== event.projectDirectory ||
            selectedWorkspaceScopeRef.current.profileName !== reconciliationProfileName ||
            buildContentWatchPromiseRef.current !== watchPromise ||
            buildContentWatchGenerationRef.current !== reconciliationWatchGeneration ||
            (buildContentObservedRevisionByScopeRef.current.get(eventScopeKey) ?? 0) !==
              reconciliationRevision ||
            (buildContentInvalidatedRevisionByScopeRef.current.get(eventScopeKey) ?? 0) <
              reconciliationRevision ||
            buildContentWatchKeyRef.current !== eventWatchKey
          ) {
            if (failedScopes.length > 0) {
              throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
            }
            return;
          }
          if (!modsReconciled) {
            throw new Error('Exact mod reconciliation failed for the active project.');
          }
          const refreshes: Promise<unknown>[] = [
            loadPluginsWorkspace(reconciliationProject, {
              operationId: createRendererOperationId('build_content_plugins_changed'),
              resetScroll: false,
              showBusy: false,
              showLoading: false,
              profileName: reconciliationProfileName
            })
          ];
          if (refreshEffectiveFileTree) {
            refreshes.push(
              loadEffectiveFileTree(reconciliationProject, reconciliationProfileName, {
                force: true,
                requestKey: effectiveFileTreeRequestKey
              })
            );
          }
          const [pluginsReconciled] = await Promise.all(refreshes);
          if (
            selectedProjectDirectoryRef.current !== event.projectDirectory ||
            selectedWorkspaceScopeRef.current.profileName !== reconciliationProfileName ||
            buildContentWatchPromiseRef.current !== watchPromise ||
            buildContentWatchGenerationRef.current !== reconciliationWatchGeneration ||
            (buildContentObservedRevisionByScopeRef.current.get(eventScopeKey) ?? 0) !==
              reconciliationRevision ||
            (buildContentInvalidatedRevisionByScopeRef.current.get(eventScopeKey) ?? 0) <
              reconciliationRevision ||
            buildContentWatchKeyRef.current !== eventWatchKey
          ) {
            if (failedScopes.length > 0) {
              throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
            }
            return;
          }
          if (!pluginsReconciled) {
            throw new Error('Exact plugin reconciliation failed for the active project.');
          }
          exactWorkspaceWatchCoverageRef.current = {
            contentRevision: reconciliationRevision,
            watchGeneration: reconciliationWatchGeneration,
            watchKey: eventWatchKey
          };
          currentEventReconciled = true;
          if (failedScopes.length > 0) {
            throw new Error(`Build content invalidation remains pending for ${failedScopes.length} scope(s).`);
          }
        })
        .catch(() => undefined);
    });
    return unsubscribe;
  }, [
    activeRightPane,
    activeRoute,
    buildContentEventSequences,
    buildContentRefreshCoordinator,
    effectiveFileTreeRequestKey,
    isSecondaryWindow,
    pendingBuildContentModPaths,
    selectedProject,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    const downloadsVisible =
      activeRoute === 'downloads' || (activeRoute === 'build' && activeRightPane === 'downloads');
    if (
      isSecondaryWindow ||
      !downloadsVisible ||
      !selectedProject ||
      !downloadCapabilities.bridgeAvailable
    ) {
      if (downloadDropCueRef.current !== 'idle') {
        resetDownloadDropCue();
      }
      return undefined;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;
    void window.fluxora.fileDrop
      .onDragDrop((event) => handleFluxoraFileDrop(event))
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
      resetDownloadDropCue();
    };
  }, [
    activeRightPane,
    activeRoute,
    downloadCapabilities.bridgeAvailable,
    isSecondaryWindow,
    selectedProject?.projectDirectory
  ]);

  useEffect(() => {
    const downloadsVisible =
      activeRoute === 'downloads' || (activeRoute === 'build' && activeRightPane === 'downloads');
    if (
      isSecondaryWindow ||
      !downloadsVisible ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      !downloadCapabilities.bridgeAvailable ||
      !hasActiveDownload(downloadsWorkspace.items)
    ) {
      return undefined;
    }

    const refreshDownloadProgress = () => {
      if (downloadProgressRefreshInFlightRef.current) {
        return;
      }

      downloadProgressRefreshInFlightRef.current = true;
      void loadDownloadsWorkspace(selectedProject, {
        operationId: createRendererOperationId('downloads_progress_refresh'),
        resetScroll: false,
        showBusy: false,
        showLoading: false
      }).finally(() => {
        downloadProgressRefreshInFlightRef.current = false;
      });
    };

    const timer = window.setInterval(
      refreshDownloadProgress,
      DOWNLOAD_PROGRESS_REFRESH_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [
    activeRightPane,
    activeRoute,
    bridgeStatus?.ready,
    downloadCapabilities.bridgeAvailable,
    downloadsWorkspace.items,
    isSecondaryWindow,
    selectedProject
  ]);

  useEffect(() => {
    if (
      isSecondaryWindow ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      !downloadCapabilities.bridgeAvailable
    ) {
      return;
    }

    const pendingEvent = pendingInboundNxmEventRef.current;
    if (!pendingEvent) {
      return;
    }

    pendingInboundNxmEventRef.current = null;
    void importInboundDownloadsForProject(selectedProject, pendingEvent);
  }, [
    bridgeStatus?.ready,
    downloadCapabilities.bridgeAvailable,
    isSecondaryWindow,
    selectedProject?.projectDirectory
  ]);

  useEffect(() => {
    if (isSecondaryWindow) {
      return undefined;
    }

    return window.fluxora.nxm.onInboundLinksCaptured((event) => {
      const queuedText =
        event.count === 1
          ? 'NXM link captured. Open a build to import it.'
          : `${event.count} NXM links captured. Open a build to import them.`;
      if (!selectedProject || !bridgeStatus?.ready || !downloadCapabilities.bridgeAvailable) {
        pendingInboundNxmEventRef.current = event;
        setMessage(queuedText);
        return;
      }

      pendingInboundNxmEventRef.current = null;
      void importInboundDownloadsForProject(selectedProject, event, {
        showBusy: activeRoute === 'build' || activeRoute === 'downloads'
      });
    });
  }, [
    activeRoute,
    bridgeStatus?.ready,
    downloadCapabilities.bridgeAvailable,
    isSecondaryWindow,
    selectedProject
  ]);

  useEffect(() => {
    if (
      (activeRoute !== 'build' && activeRoute !== 'profiles') ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      openingBuildOperationIdRef.current ||
      coordinatedWorkspaceLoadRef.current?.projectId === selectedProject.id
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
      !bridgeStatus?.ready ||
      openingBuildOperationIdRef.current ||
      coordinatedWorkspaceLoadRef.current?.projectId === selectedProject.id
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
    if (isSecondaryWindow) {
      return;
    }

    return window.fluxora.transfer.onMo2Handoff((handoff) => {
      void startMo2TransferFromHandoff(handoff);
    });
  }, [isSecondaryWindow, transferRunningOperationId]);

  useEffect(() => {
    if (isSecondaryWindow) {
      return;
    }

    return window.fluxora.buildSettings.onPathsSaved((project) => {
      setProjects((current) => upsertProject(current, project));
      setMessage(`Build paths saved for ${project.name}.`);
    });
  }, [isSecondaryWindow]);

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
    return window.fluxora.operations.onProgress((progress) => {
      setOperationOverlay((current) =>
        current && current.isRunning && current.operationId === progress.operationId
          ? {
              ...current,
              statusText:
                progress.statusMessage ||
                progress.currentStep ||
                progress.phase ||
                current.statusText,
              currentItem: progress.currentItem || current.currentItem,
              percent: Math.max(0, Math.min(100, progress.overallPercent)),
              providers: progress.providers ?? current.providers
            }
          : current
      );
    });
  }, []);

  useEffect(() => {
    const pendingRestore = pendingBuildPathEditorRestoreRef.current;
    if (pendingRestore?.selectedProjectId === selectedProjectId) {
      const { snapshot } = pendingRestore;
      pendingBuildPathEditorRestoreRef.current = null;
      buildPathDraftDirtyRef.current = snapshot.isDirty;
      setBuildPathDraft({ ...snapshot.buildPathDraft });
      setBuildPathExecutables([...snapshot.buildPathExecutables]);
      setBuildPathsError(snapshot.buildPathsError);
      setFluxPackSummary(snapshot.fluxPackSummary);
      setFluxPackInstallResult(snapshot.fluxPackInstallResult);
      setIsBuildPathsOpen(snapshot.isBuildPathsOpen);
      setGrassCacheConfirmationOpen(snapshot.grassCacheConfirmationOpen);
      return;
    }

    pendingBuildPathEditorRestoreRef.current = null;
    buildPathDraftDirtyRef.current = false;
    setBuildPathDraft(emptyBuildPathDraft(selectedProject));
    setBuildPathExecutables(selectedProject?.executables ?? []);
    setBuildPathsError(null);
    setFluxPackSummary(null);
    setFluxPackInstallResult(null);
    setIsBuildPathsOpen(false);
    setGrassCacheConfirmationOpen(false);
  }, [selectedProject?.configPath, selectedProjectId]);

  useEffect(() => {
    setExecutableDraft(selectedExecutableItem ? { ...selectedExecutableItem } : null);
    setExecutableDeleteArmedId(null);
  }, [selectedExecutableItem?.id]);

  useEffect(() => {
    const fileTreeItem =
      selectedModItem?.isMod
        ? selectedModItem
        : isModDetailsWindow && modDetailsSummary?.isMod
          ? modDetailsSummary
          : null;
    setFileTreeCache(
      isModDetailsWindow &&
        initialModDetailsBootstrap?.rootFileTree &&
        fileTreeItem?.id === initialModDetailsBootstrap.modPath
        ? { '': initialModDetailsBootstrap.rootFileTree }
        : {}
    );
    setExpandedFileTree({});
    setModDetailsConflictScanState('idle');
    setModDetailsConflictPage(null);

    if ((activeRoute !== 'build' && activeRoute !== 'mods') || !fileTreeItem?.isMod) {
      setFileTreeState('idle');
      return;
    }

    void loadModFileTree('', fileTreeItem);
  }, [
    activeRoute,
    initialModDetailsBootstrap?.modPath,
    initialModDetailsBootstrap?.rootFileTree,
    isModDetailsWindow,
    modDetailsSummary?.id,
    modDetailsSummary?.orderId,
    selectedModItem?.orderId,
    selectedModItem?.id
  ]);

  useEffect(() => {
    const buildWorkspaceVisible = activeRoute === 'build' || activeRoute === 'workspace';
    const dataTreeVisible = buildWorkspaceVisible && activeRightPane === 'data';
    const canRefreshExistingTree = effectiveFileTreeSnapshotRef.current !== null;
    if (!selectedProject || !bridgeStatus?.ready || !buildWorkspaceVisible) {
      if (!selectedProject) {
        effectiveFileTreeSnapshotRef.current = null;
        setEffectiveFileTreeSnapshot(null);
        setEffectiveFileTreeState('idle');
        setEffectiveFileTreeError(null);
        setEffectiveFileTreeLoadingChildren({});
        effectiveFileTreeLoadingChildrenRef.current.clear();
        effectiveFileTreeInFlightRequestKeyRef.current = null;
        effectiveFileTreeLoadedRequestKeyRef.current = null;
        effectiveFileTreeFailedRequestKeyRef.current = null;
        effectiveFileTreeRequestSequenceRef.current += 1;
      }
      return;
    }

    if (!dataTreeVisible && !canRefreshExistingTree) {
      return;
    }

    void loadEffectiveFileTree(selectedProject, selectedProjectProfileName, {
      requestKey: effectiveFileTreeRequestKey
    });
  }, [
    activeRightPane,
    activeRoute,
    bridgeStatus?.ready,
    buildPathRevisionKey,
    effectiveFileTreeRequestKey,
    modOrderRevisionKey,
    selectedProject,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    const conflictItem =
      selectedModItem?.isMod
        ? selectedModItem
        : isModDetailsWindow && modDetailsSummary?.isMod
          ? modDetailsSummary
          : null;
    if (
      !isModDetailsWindow ||
      modDetailsTab !== 'conflicts' ||
      modDetailsConflictScanState !== 'idle' ||
      !conflictItem?.isMod
    ) {
      return;
    }

    void loadModDetailsConflictTree(conflictItem);
  }, [
    isModDetailsWindow,
    modDetailsConflictScanState,
    modDetailsTab,
    modDetailsSummary?.id,
    modDetailsSummary?.orderId,
    selectedModItem?.orderId,
    selectedModItem?.id
  ]);

  const changeRoute = (route: RouteId) => {
    if (route === 'home' && openingBuildOperationIdRef.current) {
      const operationId = openingBuildOperationIdRef.current;
      openingBuildCancelRequestsRef.current.add(operationId);
      const previousView = openingBuildPreviousViewRef.current;
      if (previousView) {
        setSelectedProjectId(previousView.selectedProjectId);
      }
      // Keep the operation lock until the in-flight loaders have settled and
      // the previous workspace has been restored in openProjectByConfig().
      setLoadedWorkspaceProjectId(null);
      setOpeningBuildSplash(null);
      setMessage('Открытие сборки отменено.');
    }

    if (isTransferRunning && route !== 'home') {
      setIsTransferPageOpen(true);
      setActiveRoute('home');
      setMessage('Перенос MO2 уже идет. Дождитесь завершения или отмените его на странице переноса.');
      return;
    }

    clearRowReorderSession();
    resetDownloadDropCue();
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
      const orderSaved = await waitForPendingOrderSaves();
      if (!orderSaved) {
        setMessage('Order is still not saved. Fix the error before closing Fluxora.');
        return;
      }

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

  const closeOperationOverlay = (operationId: string) => {
    setOperationOverlay((current) =>
      current && current.operationId === operationId ? null : current
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

  const showOpeningBuildPreviousView = () => {
    const previousView = openingBuildPreviousViewRef.current;
    if (!previousView) {
      return;
    }

    pendingBuildPathEditorRestoreRef.current = {
      selectedProjectId: previousView.selectedProjectId,
      snapshot: previousView.buildPathEditor
    };
    buildPathDraftDirtyRef.current = previousView.buildPathEditor.isDirty;
    setBuildPathDraft({ ...previousView.buildPathEditor.buildPathDraft });
    setBuildPathExecutables([...previousView.buildPathEditor.buildPathExecutables]);
    setBuildPathsError(previousView.buildPathEditor.buildPathsError);
    setFluxPackSummary(previousView.buildPathEditor.fluxPackSummary);
    setFluxPackInstallResult(previousView.buildPathEditor.fluxPackInstallResult);
    setIsBuildPathsOpen(previousView.buildPathEditor.isBuildPathsOpen);
    setGrassCacheConfirmationOpen(previousView.buildPathEditor.grassCacheConfirmationOpen);
    dispatchProfilesWorkspace({ type: 'selected', name: previousView.profileName });
    dispatchExecutablesWorkspace({
      type: 'selected',
      id: previousView.selectedExecutableId
    });
    setSelectedProjectId(previousView.selectedProjectId);
    setActiveRoute(previousView.route);
    // An in-flight load may already have replaced only some workspace stores.
    // Keep runtime metrics detached until the previous workspace is reloaded.
    setLoadedWorkspaceProjectId(null);
  };

  const setOpeningBuildProgress = (
    operationId: string,
    progress: number,
    buildName?: string
  ) => {
    setOpeningBuildSplash((current) =>
      current?.operationId === operationId
        ? {
            ...current,
            buildName: buildName ?? current.buildName,
            progress: Math.max(current.progress, progress)
          }
        : current
    );
  };

  const loadBuildWorkspaceData = async (
    project: FluxoraProject,
    options: WorkspaceLoadOptions = {},
    includeDownloads = true
  ) => {
    const loadSequence = coordinatedWorkspaceLoadSequenceRef.current + 1;
    coordinatedWorkspaceLoadSequenceRef.current = loadSequence;
    coordinatedWorkspaceLoadRef.current = { projectId: project.id, sequence: loadSequence };
    const profileName = options.profileName ?? selectedProjectProfileName;
    const loadOptions: WorkspaceLoadOptions = {
      ...options,
      coordinatedSequence: loadSequence,
      profileName
    };

    try {
      const [modsLoaded, pluginsLoaded, downloadsLoaded, profiles, executables] = await Promise.all([
        loadModsWorkspace(project, loadOptions),
        loadPluginsWorkspace(project, loadOptions),
        includeDownloads ? loadDownloadsWorkspace(project, loadOptions) : Promise.resolve(true),
        loadProfilesWorkspace(project, loadOptions),
        loadExecutablesWorkspace(project, loadOptions)
      ]);
      if (
        !modsLoaded ||
        !pluginsLoaded ||
        !downloadsLoaded ||
        profiles === null ||
        executables === null
      ) {
        throw new Error('The build workspace could not be loaded completely.');
      }
    } finally {
      if (coordinatedWorkspaceLoadRef.current?.sequence === loadSequence) {
        coordinatedWorkspaceLoadRef.current = null;
      }
    }
  };

  const restoreOpeningBuildPreviousView = async () => {
    const previousView = openingBuildPreviousViewRef.current;
    if (!previousView) {
      return;
    }

    showOpeningBuildPreviousView();
    const previousProject = previousView.loadedWorkspaceProjectId
      ? projects.find((project) => project.id === previousView.loadedWorkspaceProjectId)
      : null;

    if (previousProject) {
      try {
        await loadBuildWorkspaceData(previousProject, {
          operationId: createRendererOperationId('projects_open_restore'),
          profileName: previousView.profileName,
          resetScroll: true,
          showBusy: false,
          showLoading: true
        });
        setLoadedWorkspaceProjectId(previousProject.id);
      } catch {
        // The catalog remains usable; persisted project metrics are safer than
        // attributing a partially restored workspace to the wrong build.
        setLoadedWorkspaceProjectId(null);
      }
    }

    openingBuildPreviousViewRef.current = null;
  };

  const openProjectByConfig = async (configPath: string) => {
    if (
      !bridgeStatus?.ready ||
      isTransferRunning ||
      isOpeningBuildLocked ||
      openingBuildOperationIdRef.current
    ) {
      return;
    }

    const operationId = createRendererOperationId('projects_open');
    const openTiming = createProjectOpenTiming(operationId);
    const pendingProject = projects.find((project) => project.configPath === configPath);

    if (pendingProject && pendingProject.id !== loadedWorkspaceProjectId) {
      setLoadedWorkspaceProjectId(null);
    }

    openingBuildOperationIdRef.current = operationId;
    setIsOpeningBuildLocked(true);
    const previousWorkspaceProject = loadedWorkspaceProjectId
      ? projects.find((project) => project.id === loadedWorkspaceProjectId)
      : null;
    openingBuildPreviousViewRef.current = {
      buildPathEditor: {
        buildPathDraft: { ...buildPathDraft },
        buildPathExecutables: [...buildPathExecutables],
        buildPathsError,
        fluxPackInstallResult,
        fluxPackSummary,
        grassCacheConfirmationOpen,
        isBuildPathsOpen,
        isDirty: buildPathDraftDirtyRef.current
      },
      profileName:
        profilesWorkspace.selectedName ||
        (previousWorkspaceProject
          ? projectDefaultProfileName(previousWorkspaceProject)
          : selectedProjectProfileName),
      route: activeRoute,
      selectedExecutableId: executablesWorkspace.selectedId,
      selectedProjectId,
      loadedWorkspaceProjectId
    };

    let shouldRestorePreviousView = false;

    setOpeningBuildSplash({
      operationId,
      buildName: pendingProject?.name ?? 'Сборка',
      progress: 4
    });
    setMessage(null);

    if (pendingProject) {
      setSelectedProjectId(pendingProject.id);
      changeRoute('build');
    }

    try {
      const { project: opened } = await openProjectConfig(configPath, operationId);
      openTiming.markProjectConfigLoaded();
      if (openingBuildCancelRequestsRef.current.has(operationId)) {
        shouldRestorePreviousView = true;
        return;
      }

      setProjects((current) => upsertProject(current, opened));
      setSelectedProjectId(opened.id);
      if (!pendingProject) {
        changeRoute('build');
      }
      const openingProfileName = projectDefaultProfileName(opened);
      dispatchProfilesWorkspace({ type: 'selected', name: openingProfileName });
      setOpeningBuildProgress(operationId, 42, opened.name);
      // Establish watcher coverage before the disk-generation scan begins so a
      // change racing the initial workspace load is queued for reconciliation.
      await ensureBuildContentWatch(
        opened,
        openingProfileName,
        createRendererOperationId('build_content_watch_before_workspace')
      );
      await loadBuildWorkspaceData(opened, {
        operationId,
        profileName: openingProfileName,
        persistedSnapshot: true,
        resetScroll: true,
        showBusy: false,
        showLoading: true
      }, false);
      openTiming.markWorkspaceDataLoaded();
      if (openingBuildCancelRequestsRef.current.has(operationId)) {
        shouldRestorePreviousView = true;
        return;
      }

      pendingProjectOpenTimingRef.current = {
        projectId: opened.id,
        project: opened,
        timing: openTiming
      };
      setLoadedWorkspaceProjectId(opened.id);
      setProjectOpenCommitSequence((current) => current + 1);
      setOpeningBuildProgress(operationId, 100, opened.name);
      openingBuildPreviousViewRef.current = null;
      setMessage(`Opened ${opened.name}`);
    } catch (error) {
      shouldRestorePreviousView = true;
      if (!openingBuildCancelRequestsRef.current.has(operationId)) {
        setMessage(errorMessage(error));
      }
    } finally {
      if (shouldRestorePreviousView) {
        await restoreOpeningBuildPreviousView();
      }
      openingBuildCancelRequestsRef.current.delete(operationId);
      if (openingBuildOperationIdRef.current === operationId) {
        openingBuildOperationIdRef.current = null;
        setIsOpeningBuildLocked(false);
      }
      setOpeningBuildSplash((current) => (current?.operationId === operationId ? null : current));
    }
  };

  const cancelOpeningBuild = () => {
    const operationId = openingBuildSplash?.operationId ?? openingBuildOperationIdRef.current;
    if (!operationId) {
      return;
    }

    openingBuildCancelRequestsRef.current.add(operationId);
    setOpeningBuildSplash(null);
    showOpeningBuildPreviousView();
    setMessage('Открытие сборки отменено.');
  };

  useEffect(() => {
    if (!openingBuildSplash) {
      return undefined;
    }

    const operationId = openingBuildSplash.operationId;
    const timer = window.setInterval(() => {
      setOpeningBuildSplash((current) => {
        if (!current || current.operationId !== operationId || current.progress >= 94) {
          return current;
        }

        const remaining = 94 - current.progress;
        const step = Math.max(0.8, Math.min(5.5, remaining * 0.12));
        return {
          ...current,
          progress: Math.min(94, current.progress + step)
        };
      });
    }, 420);

    return () => window.clearInterval(timer);
  }, [openingBuildSplash?.operationId]);

  useEffect(() => {
    if (!overwriteClearSplash) {
      return undefined;
    }

    const operationId = overwriteClearSplash.operationId;
    const timer = window.setInterval(() => {
      setOverwriteClearSplash((current) => {
        if (!current || current.operationId !== operationId || current.progress >= 94) {
          return current;
        }

        const remaining = 94 - current.progress;
        const step = Math.max(0.8, Math.min(5.5, remaining * 0.12));
        return {
          ...current,
          progress: Math.min(94, current.progress + step)
        };
      });
    }, 420);

    return () => window.clearInterval(timer);
  }, [overwriteClearSplash?.operationId]);

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
      setLoadedWorkspaceProjectId((current) => (current === project.id ? renamed.id : current));
      setMessage(`Renamed to ${renamed.name}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyLabel(null);
    }
  };

  const requestDeleteProject = (project: FluxoraProject) => {
    setDeletionConfirmation({
      kind: 'build',
      itemName: project.name,
      onConfirm: () => deleteProject(project)
    });
  };

  const deleteProject = async (project: FluxoraProject) => {
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
      closeOperationOverlay(operationId);
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

  const toggleEffectiveFileTreeDirectory = async (entry: FluxoraEffectiveFileTreeEntry) => {
    if (!entry.isDirectory || !entry.hasChildren) {
      return;
    }

    const isExpanded = Boolean(expandedEffectiveFileTree[entry.relativePath]);
    setExpandedEffectiveFileTree((current) => ({
      ...current,
      [entry.relativePath]: !isExpanded
    }));

    if (!isExpanded) {
      await loadEffectiveFileTreeChildren(entry);
    }
  };

  const openEffectiveFileTreeEntry = async (entry: FluxoraEffectiveFileTreeEntry) => {
    if (!entry.sourcePath) {
      await toggleEffectiveFileTreeDirectory(entry);
      return;
    }

    const result = await window.fluxora.shell.openPath(entry.sourcePath);
    if (!result.ok) {
      setMessage(result.message ?? `${effectiveVirtualPathLabel(entry)} could not be opened.`);
    }
  };

  const loadBuildPathSettings = async (project = selectedProject) => {
    if (!project || !bridgeStatus?.ready) {
      return;
    }

    const operationId = createRendererOperationId('build_paths_get');
    setBuildPathsError(null);
    setMessage(null);
    setIsBuildPathsOpen(true);

    try {
      const [settings, executables] = await Promise.all([
        window.fluxora.buildPaths.get(project.configPath, { operationId }),
        window.fluxora.executables.list(project.configPath, { operationId })
      ]);
      if (!buildPathDraftDirtyRef.current) {
        setBuildPathDraft(draftFromBuildPathSettings(project, settings, executables));
        setBuildPathExecutables(executables);
      }
    } catch (error) {
      const nextMessage = errorMessage(error);
      if (!buildPathDraftDirtyRef.current) {
        setBuildPathDraft(emptyBuildPathDraft(project));
      }
      setBuildPathsError(nextMessage);
      setMessage(nextMessage);
    } finally {
      setBuildPathsBusyLabel(null);
    }
  };

  const openBuildPathSettings = async () => {
    if (!selectedProject) {
      return;
    }

    if (!isBuildSettingsWindow) {
      try {
        writeBuildSettingsBootstrap({
          key: selectedProject.configPath,
          draft:
            buildPathDraft.projectDirectory === selectedProject.projectDirectory
              ? buildPathDraft
              : emptyBuildPathDraft(selectedProject),
          executables:
            buildPathExecutables.length > 0
              ? buildPathExecutables
              : (selectedProject.executables ?? []),
          project: selectedProject
        });
        await window.fluxora.windowControls.openBuildSettings(
          selectedProject.configPath,
          selectedProject.name
        );
      } catch (error) {
        setMessage(errorMessage(error));
      }
      return;
    }

    await loadBuildPathSettings(selectedProject);
  };

  const closeBuildPathSettings = async () => {
    if (isBuildSettingsWindow) {
      try {
        await window.fluxora.windowControls.close();
      } catch (error) {
        setMessage(errorMessage(error));
      }
      return;
    }

    setIsBuildPathsOpen(false);
  };

  const updateBuildPathDraft = (patch: Partial<BuildPathDraft>) => {
    buildPathDraftDirtyRef.current = true;
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
      buildPathDraftDirtyRef.current = false;
      setMessage('Build paths saved.');
      if (isBuildSettingsWindow) {
        await window.fluxora.buildSettings.notifyPathsSaved(nextProject);
        await window.fluxora.windowControls.close();
      } else {
        setIsBuildPathsOpen(false);
      }
    } catch (error) {
      const nextMessage = errorMessage(error);
      setBuildPathsError(nextMessage);
      setMessage(nextMessage);
    } finally {
      setBuildPathsBusyLabel(null);
    }
  };

  useEffect(() => {
    if (!isBuildSettingsWindow || !selectedProject || !bridgeStatus?.ready) {
      return;
    }

    if (buildSettingsLoadedProjectRef.current === selectedProject.configPath) {
      return;
    }

    buildSettingsLoadedProjectRef.current = selectedProject.configPath;
    void loadBuildPathSettings(selectedProject);
  }, [bridgeStatus?.ready, isBuildSettingsWindow, selectedProject?.configPath]);

  const defaultFluxPackPath = (project: FluxoraProject): string =>
    `${project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'FluxoraBuild'}.fluxpack`;

  const packageFluxPack = async () => {
    if (!selectedProject) {
      return;
    }

    const saveResult = await window.fluxora.dialogs.saveFluxPack(
      defaultFluxPackPath(selectedProject),
      'Сохранить FluxPack'
    );
    if (saveResult.canceled || !saveResult.path) {
      return;
    }

    setFluxPackExportPath(saveResult.path);
  };

  const confirmFluxPackExport = async ({
    packageType,
    includeGeneratedAssets
  }: FluxPackExportOptions) => {
    if (!selectedProject || !fluxPackExportPath) {
      return;
    }

    const outputPath = fluxPackExportPath;
    setFluxPackPackageType(packageType);
    setFluxPackExportPath(null);
    const operationId = createRendererOperationId('fluxpack_export');
    beginOperationOverlay({
      operationId,
      kind: 'fluxpack-export',
      title: 'Упаковываем сборку',
      statusText: 'Изучаем сборку',
      currentItem: selectedProject.name,
      percent: 0
    });
    setMessage(null);

    try {
      const summary = await window.fluxora.fluxPack.export(
        {
          configPath: selectedProject.configPath,
          outputPath,
          includeGeneratedAssets,
          packageType
        },
        { operationId }
      );
      setFluxPackSummary(summary);
      setFluxPackInstallResult(null);
      activateRightPane('build');
      setMessage(`Сборка упакована: ${summary.outputPath}`);
      finishOperationOverlay(operationId, `Сборка ${summary.buildName || selectedProject.name} упакована`);
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
      activateRightPane('build');
      setMessage(`FluxPack ready: ${summary.buildName}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyLabel(null);
    }
  };

  const executeFluxPackInstall = async (
    execution: FluxPackInstallExecution,
    manualSourceArchives: FluxoraFluxPackManualSourceArchive[] = []
  ) => {
    const {
      existingConfigPath,
      fluxPackPath,
      installRootDirectory,
      summary,
      targetProject
    } = execution;
    const isDeltaUpdate = Boolean(existingConfigPath);
    const operationId = createRendererOperationId('fluxpack_install');
    beginOperationOverlay({
      operationId,
      kind: 'fluxpack-install',
      title: isDeltaUpdate ? 'Обновляем сборку' : 'Устанавливаем сборку',
      statusText: isDeltaUpdate ? 'Сопоставляем Delta' : 'Подготавливаем установку',
      currentItem: targetProject?.name || summary.buildName || fluxPackPath,
      percent: 0
    });
    setMessage(null);

    try {
      const result = await window.fluxora.fluxPack.install(
        {
          fluxPackPath,
          installRootDirectory,
          ...(existingConfigPath ? { existingConfigPath } : {}),
          ...(manualSourceArchives.length > 0 ? { manualSourceArchives } : {})
        },
        { operationId }
      );
      setFluxPackSummary(result.summary);
      setFluxPackInstallResult(result);
      activateRightPane('build');
      const { project: opened } = await openProjectConfig(result.configPath, operationId);
      setLoadedWorkspaceProjectId(null);
      setProjects((current) => upsertProject(current, opened));
      setSelectedProjectId(opened.id);
      changeRoute('build');
      const openingProfileName = projectDefaultProfileName(opened);
      dispatchProfilesWorkspace({ type: 'selected', name: openingProfileName });
      let workspaceLoadError: unknown = null;
      try {
        await loadBuildWorkspaceData(opened, {
          operationId,
          profileName: openingProfileName,
          resetScroll: true,
          showBusy: false,
          showLoading: true
        });
      } catch (error) {
        workspaceLoadError = error;
      }

      if (workspaceLoadError) {
        setMessage(
          `${result.updatedExistingProject ? 'Сборка обновлена' : 'FluxPack установлен'}, но рабочее пространство не загрузилось: ${errorMessage(workspaceLoadError)}`
        );
        finishOperationOverlay(
          operationId,
          `${result.updatedExistingProject ? 'Обновлена' : 'Установлена'} сборка ${result.buildName || opened.name}`
        );
        await loadCatalog();
        return;
      }

      setLoadedWorkspaceProjectId(opened.id);
      setMessage(
        result.updatedExistingProject
          ? `Сборка обновлена: ${result.buildName || opened.name}. Переиспользовано: ${result.reusedSourceCount} мод., ${result.reusedDownloadCount} архив., ${result.reusedFileCount} файл.`
          : `FluxPack установлен: ${result.buildName || opened.name}`
      );
      finishOperationOverlay(
        operationId,
        `${result.updatedExistingProject ? 'Обновлена' : 'Установлена'} сборка ${result.buildName || opened.name}`
      );
      await loadCatalog();
    } catch (error) {
      const nextMessage = errorMessage(error);
      setMessage(nextMessage);
      failOperationOverlay(operationId, nextMessage);
    }
  };

  const runFluxPackInstall = async (
    fluxPackPath: string,
    summary: FluxoraFluxPackSummary,
    targetProject: FluxoraProject | null
  ) => {
    const installTarget = resolveFluxPackInstallTarget(
      targetProject,
      catalog.defaultInstallRootDirectory
    );
    let installRootDirectory = installTarget.installRootDirectory;
    if (installTarget.requiresRootSelection) {
      const rootResult = await window.fluxora.dialogs.pickFolder(
        'Выберите папку для сборки',
        installRootDirectory || undefined
      );
      if (rootResult.canceled || !rootResult.path) {
        return;
      }
      installRootDirectory = rootResult.path;
    }

    const execution: FluxPackInstallExecution = {
      fluxPackPath,
      installRootDirectory,
      summary,
      targetProject,
      ...(installTarget.existingConfigPath
        ? { existingConfigPath: installTarget.existingConfigPath }
        : {})
    };
    const planOperationId = createRendererOperationId('fluxpack_plan_install');
    setBusyLabel('Проверяем локальные файлы');
    setMessage(null);

    try {
      const plan = await window.fluxora.fluxPack.planInstall(
        {
          fluxPackPath,
          ...(execution.existingConfigPath
            ? { existingConfigPath: execution.existingConfigPath }
            : {})
        },
        { operationId: planOperationId }
      );
      const unavailableSources = plan.sources.filter(
        (source) => source.acquisitionMode === 'unavailable'
      );
      if (unavailableSources.length > 0) {
        setMessage(
          `Нельзя продолжить установку: для ${unavailableSources.length} мод. пока нет поддерживаемого источника.`
        );
        return;
      }

      const manualSources = plan.sources.filter((source) => source.requiresManualDownload);
      if (manualSources.length > 0) {
        setFluxPackManualDownload({
          execution: { ...execution, summary: plan.summary },
          selectedArchives: {},
          sources: manualSources
        });
        return;
      }

      setBusyLabel(null);
      await executeFluxPackInstall({ ...execution, summary: plan.summary });
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

    const inspectOperationId = createRendererOperationId('fluxpack_inspect_install');
    setBusyLabel('Проверяем FluxPack');
    setMessage(null);
    try {
      const summary = await window.fluxora.fluxPack.inspect(pickResult.path, {
        operationId: inspectOperationId
      });
      setFluxPackSummary(summary);
      setFluxPackInstallResult(null);
      const conflict = findFluxPackNameConflict(projects, summary.buildName, selectedProject?.id);
      if (conflict) {
        setFluxPackInstallConflict({
          fluxPackPath: pickResult.path,
          project: conflict,
          summary
        });
        return;
      }

      await runFluxPackInstall(pickResult.path, summary, null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyLabel(null);
    }
  };

  const openFluxPackManualDownload = async (source: FluxoraFluxPackSourceInstallPlan) => {
    if (!source.manualDownloadUrl) {
      setMessage(`Для ${source.displayName} не удалось определить страницу загрузки.`);
      return;
    }

    try {
      await window.fluxora.links.openExternal(source.manualDownloadUrl);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const pickFluxPackManualArchive = async (source: FluxoraFluxPackSourceInstallPlan) => {
    try {
      const picked = await window.fluxora.dialogs.pickArchive();
      if (picked.canceled || !picked.path) {
        return;
      }
      const archivePath = picked.path;
      setFluxPackManualDownload((current) =>
        current
          ? {
              ...current,
              selectedArchives: {
                ...current.selectedArchives,
                [source.sourceId]: archivePath
              }
            }
          : current
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const confirmFluxPackManualInstall = async () => {
    const pending = fluxPackManualDownload;
    if (!pending) {
      return;
    }

    const manualSourceArchives = pending.sources.flatMap((source) => {
      const path = pending.selectedArchives[source.sourceId];
      return path ? [{ sourceId: source.sourceId, path }] : [];
    });
    if (manualSourceArchives.length !== pending.sources.length) {
      setMessage('Сначала выберите загруженный архив для каждого мода.');
      return;
    }

    setFluxPackManualDownload(null);
    await executeFluxPackInstall(pending.execution, manualSourceArchives);
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

    const currentOperationSupportsCancellation =
      operationOverlay.kind === 'grass-cache' || operationCancellationSupported;

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

      if (!operationOverlay.isRunning || !currentOperationSupportsCancellation) {
        return;
      }
    } else if (!operationOverlay.isRunning || !currentOperationSupportsCancellation) {
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

      setLoadedWorkspaceProjectId(null);
      setProjects((current) => upsertProject(current, created));
      setSelectedProjectId(created.id);
      setIsCreateOpen(false);
      changeRoute('build');
      const openingProfileName = projectDefaultProfileName(created);
      dispatchProfilesWorkspace({ type: 'selected', name: openingProfileName });
      let workspaceLoadError: unknown = null;
      try {
        await loadBuildWorkspaceData(created, {
          operationId,
          profileName: openingProfileName,
          resetScroll: true,
          showBusy: false,
          showLoading: true
        });
      } catch (error) {
        workspaceLoadError = error;
      }

      if (createCancelRequestsRef.current.has(operationId)) {
        await cleanupCreatedBuild(created, operationId);
        return;
      }

      if (workspaceLoadError) {
        setMessage(`Build created, but its workspace could not be loaded: ${errorMessage(workspaceLoadError)}`);
        closeOperationOverlay(operationId);
        return;
      }

      setLoadedWorkspaceProjectId(created.id);
      closeOperationOverlay(operationId);
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
    setMessage(null);
    setApiLimitsBusy(true);

    try {
      const [nextStatus, nextNexusStatus, nextApiLimits] = await Promise.all([
        window.fluxora.bridge.getStatus({ operationId }),
        window.fluxora.nexus.getAuthStatus({ operationId }),
        window.fluxora.apiLimits.list({ operationId })
      ]);
      const nextThemeMode = normalizeThemeMode(nextStatus.theme);
      setBridgeStatus({
        ...nextStatus,
        theme: nextThemeMode,
        operationId
      });
      setThemeMode(nextThemeMode);
      rememberNexusStatus(nextNexusStatus);
      rememberApiLimitProviders(nextApiLimits.providers);
    } catch (error) {
      markNexusStatusChecking();
      setMessage(errorMessage(error));
    } finally {
      setApiLimitsBusy(false);
    }
  };

  const toggleNexusConnection = async () => {
    if (nexusBusy || !nexusCanToggle(nexusStatus, settingsCapabilities.nexusAvailable)) {
      return;
    }

    const shouldDisconnect = nexusIsVerifiedLinked(nexusStatus);
    const operationId = createRendererOperationId(shouldDisconnect ? 'nexus_disconnect' : 'nexus_connect');
    setNexusBusy(true);
    setApiLimitsBusy(true);
    setMessage(null);

    try {
      const status = shouldDisconnect
        ? await window.fluxora.nexus.disconnect({ operationId })
        : await window.fluxora.nexus.connect({ operationId });
      const nextApiLimits = await window.fluxora.apiLimits.list({ operationId });
      rememberNexusStatus(status);
      rememberApiLimitProviders(nextApiLimits.providers);
      setMessage(status.message || (status.isLinked ? 'Nexus Mods connected.' : 'Nexus Mods disconnected.'));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setNexusBusy(false);
      setApiLimitsBusy(false);
    }
  };

  const pickTransferFolder = async (title: string, defaultPath: string): Promise<string | null> => {
    const result = await window.fluxora.dialogs.pickFolder(title, defaultPath);
    return !result.canceled && result.path ? result.path : null;
  };

  const resetTransferPlanningState = () => {
    transferAnalysisRequestRef.current = null;
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
    setTransferStep(transferSourceDirectory.trim() ? 'destination' : 'source');
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

  const refreshBuildWorkspace = async (project: FluxoraProject, operationId: string) => {
    await loadBuildWorkspaceData(project, {
      operationId,
      profileName: selectedProjectProfileName,
      resetScroll: false,
      showBusy: false,
      showLoading: false
    });
  };

  const refreshCurrentView = async () => {
    if (refreshInFlightRef.current || openingBuildOperationIdRef.current) {
      return;
    }

    const refreshOperationId = createRendererOperationId('renderer_refresh');
    refreshInFlightRef.current = true;
    setProjectMenuId(null);
    setProjectMenuPosition(null);
    setMessage(null);

    try {
      if (!bridgeStatus?.ready) {
        if (!bridgeStatus) {
          return;
        }

        const nextBridgeStatus = await window.fluxora.bridge.getStatus({
          operationId: refreshOperationId
        });
        const nextThemeMode = normalizeThemeMode(nextBridgeStatus.theme);
        setBridgeStatus({
          ...nextBridgeStatus,
          theme: nextThemeMode,
          operationId: refreshOperationId
        });
        setThemeMode(nextThemeMode);

        if (nextBridgeStatus.ready) {
          await loadCatalog({ preferredProjectId: selectedProjectId });
          return;
        }

        setCatalogState('blocked');
        return;
      }

      if (isTransferPageOpen) {
        if (!isTransferRunning) {
          await loadTransferDestinationDrives();
        }
        return;
      }

      if (isBuildSettingsWindow) {
        if (selectedProject) {
          buildSettingsLoadedProjectRef.current = null;
          await loadBuildPathSettings(selectedProject);
        }
        return;
      }

      if (activeRoute === 'home') {
        await loadCatalog({ preferredProjectId: selectedProjectId });
        return;
      }

      if (activeRoute === 'build' || activeRoute === 'workspace') {
        if (selectedProject) {
          await refreshBuildWorkspace(selectedProject, refreshOperationId);
        }
        return;
      }

      if (activeRoute === 'mods') {
        await loadModsWorkspace(selectedProject, {
          operationId: refreshOperationId,
          resetScroll: false,
          showBusy: false
        });
        return;
      }

      if (activeRoute === 'plugins') {
        await loadPluginsWorkspace(selectedProject, {
          operationId: refreshOperationId,
          resetScroll: false,
          showBusy: false
        });
        return;
      }

      if (activeRoute === 'downloads') {
        await loadDownloadsWorkspace(selectedProject, {
          operationId: refreshOperationId,
          resetScroll: false,
          showBusy: false,
          showLoading: false
        });
        return;
      }

      if (activeRoute === 'profiles') {
        await loadProfilesWorkspace(selectedProject, {
          operationId: refreshOperationId,
          showBusy: false
        });
        return;
      }

      if (activeRoute === 'executables') {
        await loadExecutablesWorkspace(selectedProject, {
          operationId: refreshOperationId,
          showBusy: false
        });
        return;
      }

      if (activeRoute === 'settings') {
        await loadSettingsWorkspace();
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  refreshCurrentViewRef.current = refreshCurrentView;

  useEffect(() => {
    return installRendererRefreshShortcut(document, () => refreshCurrentViewRef.current());
  }, []);

  useEffect(() => {
    if (isSecondaryWindow) {
      return;
    }

    return window.fluxora.transfer.onMo2Open(() => {
      openMo2TransferSetup();
    });
  }, [
    isSecondaryWindow,
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
      setTransferStep('destination');
    }
  };

  const selectTransferDestinationDrive = async (drive: FluxoraTransferDriveOption) => {
    const sourceDirectory = transferSourceDirectory.trim();
    setTransferDestinationRootDirectory(drive.rootPath);
    resetTransferPlanningState();
    setTransferStep(sourceDirectory ? 'destination' : 'source');
  };

  const analyzeMo2Transfer = async (
    rawSourceDirectory = transferSourceDirectory,
    rawDestinationRootDirectory = transferDestinationRootDirectory,
    nextStep: TransferStepId = 'review'
  ) => {
    const sourceDirectory = rawSourceDirectory.trim();
    const destinationRootDirectory = rawDestinationRootDirectory.trim();
    if (!sourceDirectory || !destinationRootDirectory) {
      setTransferError('Выберите папку сборки и отдельный диск или папку назначения.');
      return null;
    }

    const requestKey = `${sourceDirectory}\n${destinationRootDirectory}`;
    const existingRequest = transferAnalysisRequestRef.current;
    if (existingRequest?.key === requestKey) {
      return existingRequest.promise;
    }

    const operationId = createRendererOperationId('transfer_analyze_mo2');
    setSettingsBusyLabel('Проверяем перенос');
    setTransferError(null);
    setTransferResult(null);
    setTransferStep(nextStep);

    const request = (async () => {
      try {
        const analysis = await window.fluxora.transfer.analyzeMo2(
          sourceDirectory,
          destinationRootDirectory,
          undefined,
          { operationId }
        );
        const normalizedAnalysis = normalizeMo2TransferAnalysis(
          analysis,
          destinationRootDirectory
        );
        setTransferAnalysis(normalizedAnalysis);
        setMessage(normalizedAnalysis.statusMessage || 'Проверка переноса завершена.');
        return normalizedAnalysis;
      } catch (error) {
        const nextMessage = errorMessage(error);
        setTransferAnalysis(null);
        setTransferError(nextMessage);
        setMessage(nextMessage);
        return null;
      } finally {
        if (transferAnalysisRequestRef.current?.key === requestKey) {
          transferAnalysisRequestRef.current = null;
        }
        setSettingsBusyLabel(null);
      }
    })();

    transferAnalysisRequestRef.current = { key: requestKey, promise: request };
    return request;
  };

  useEffect(() => {
    const sourceDirectory = transferSourceDirectory.trim();
    const destinationRootDirectory = transferDestinationRootDirectory.trim();
    const shouldAutoAnalyze =
      isTransferPageOpen &&
      !isSecondaryWindow &&
      transferStep === 'review' &&
      !isTransferRunning &&
      !settingsBusyLabel &&
      bridgeStatus?.ready &&
      settingsCapabilities.transferAvailable &&
      sourceDirectory &&
      destinationRootDirectory &&
      !transferAnalysis &&
      !transferError &&
      !transferProgress &&
      !transferResult;

    if (shouldAutoAnalyze) {
      void analyzeMo2Transfer(sourceDirectory, destinationRootDirectory, 'review');
    }
  }, [
    bridgeStatus?.ready,
    isSecondaryWindow,
    isTransferPageOpen,
    isTransferRunning,
    settingsBusyLabel,
    settingsCapabilities.transferAvailable,
    transferAnalysis,
    transferDestinationRootDirectory,
    transferError,
    transferProgress,
    transferResult,
    transferSourceDirectory,
    transferStep
  ]);

  const startMo2TransferFromHandoff = async (handoff: FluxoraMo2TransferHandoff) => {
    if (transferRunningOperationId) {
      setMessage('MO2 import is already running in Fluxora.');
      return;
    }

    const handoffAnalysis =
      handoff.request.replaceExisting || !handoff.analysis
        ? null
        : normalizeMo2TransferAnalysis(
            handoff.analysis,
            handoff.request.destinationRootDirectory
          );
    setTransferSourceDirectory(handoff.request.sourceDirectory);
    setTransferDestinationRootDirectory(handoff.request.destinationRootDirectory);
    setTransferAnalysis(handoffAnalysis);
    setTransferError(null);
    setTransferResult(null);
    setTransferProgress(null);
    setTransferCancelRequested(false);
    setTransferStep('review');
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

    const normalizedAnalysis = normalizeMo2TransferAnalysis(analysis, destinationRootDirectory);

    if (!normalizedAnalysis.canImport || !normalizedAnalysis.hasEnoughSpace) {
      setTransferError(
        normalizedAnalysis.warningMessage ||
          normalizedAnalysis.statusMessage ||
          'Перенос пока недоступен.'
      );
      return;
    }

    const importDestinationRootDirectory =
      normalizedAnalysis.destinationRootDirectory ||
      normalizeMo2TransferDestinationRoot(destinationRootDirectory);
    const importRequest = createMo2TransferImportRequest(
      sourceDirectory,
      importDestinationRootDirectory
    );

    if (isSettingsWindow && !options.skipMainHandoff) {
      try {
        await window.fluxora.transfer.startMo2InMain({
          request: importRequest,
          analysis: normalizedAnalysis
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
    setTransferDestinationRootDirectory(importDestinationRootDirectory);
    setTransferAnalysis(normalizedAnalysis);
    setTransferRunningOperationId(operationId);
    setTransferCancelRequested(false);
    setTransferProgress({
      operationId,
      phase: 'preparing',
      currentStep: 'Подготовка переноса',
      currentItem: normalizedAnalysis.projectName,
      overallPercent: 0,
      copyPercent: 0,
      databasePercent: 0,
      copiedBytes: 0,
      totalBytes: normalizedAnalysis.totalBytes
    });
    setTransferError(null);
    setTransferResult(null);
    setSettingsBusyLabel('Переносим сборку');
    setTransferStep('review');

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
      await loadCatalog({
        mergeProject: imported,
        preferredProjectId: imported.id,
        keepMergedProjectOnError: true
      });
      setMessage(`Перенос завершен: ${imported.name}`);
      setIsTransferPageOpen(false);
      changeRoute('home');
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

    const projectActionDisabled =
      isOpeningBuildLocked ||
      isTransferRunning ||
      Boolean(busyLabel) ||
      Boolean(operationOverlay?.isRunning);

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
          disabled={projectActionDisabled}
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
          disabled={projectActionDisabled}
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
          disabled={projectActionDisabled}
          type="button"
          role="menuitem"
          onClick={() => {
            setProjectMenuId(null);
            requestDeleteProject(project);
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
        bridgeErrorMessage={bridgeStatus?.error?.message ?? undefined}
        catalogPath={catalog.buildConfigsDirectory}
        catalogState={catalogState}
        filteredProjects={filteredProjects}
        isInstallFluxPackDisabled={
          !bridgeStatus?.ready ||
          Boolean(busyLabel) ||
          Boolean(operationOverlay?.isRunning) ||
          fluxPackInstallConflict !== null ||
          fluxPackManualDownload !== null
        }
        isNewBuildDisabled={
          !bridgeStatus?.ready ||
          isTransferRunning ||
          isOpeningBuildLocked ||
          openingBuildSplash !== null
        }
        isProjectInteractionDisabled={isOpeningBuildLocked || isTransferRunning}
        onInstallFluxPack={() => void installFluxPack()}
        onNewBuild={startCreate}
        onOpenProject={(project) => void openProjectByConfig(project.configPath)}
        onOpenProjectDirectory={(project) => void openProjectDirectory(project)}
        onProjectMenuToggle={(project, anchor) => {
          if (isOpeningBuildLocked || isTransferRunning) {
            return;
          }

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

  const renderModRowMenu = (item: FluxoraModOrderItem) => {
    if (modMenuOrderId !== item.orderId || !modMenuPosition) {
      return null;
    }

    const hasMultipleSelectedModRows = modsWorkspace.selectedOrderIds.size > 1;

    if (isModOverwriteItem(item)) {
      return createPortal(
        <div
          className="mod-row-menu mod-row-menu--context"
          role="menu"
          aria-label={`${modItemTitle(item)} actions`}
          data-row-context-menu-surface="true"
          style={{
            left: modMenuPosition.left,
            top: modMenuPosition.top,
            maxHeight: modMenuPosition.maxHeight
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="mod-row-menu__danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setModMenuOrderId(null);
              void clearOverwriteFolder();
            }}
          >
            <MenuIcon source={menuTrashIcon} />
            <span>Очистить папку перезаписи</span>
          </button>
          {!hasMultipleSelectedModRows ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setModMenuOrderId(null);
                void openOverwriteFolder();
              }}
            >
              <MenuIcon source={menuFolderOpenIcon} />
              <span>Открыть в проводнике</span>
            </button>
          ) : null}
        </div>,
        document.body
      );
    }

    const isCollapsed =
      item.isSeparator && modsWorkspace.collapsedSeparatorOrderIds.has(item.orderId);
    const modDeleteTargets = modDeletionItemsFor(item);
    const hasMultipleSelectedModDeletions = modDeleteTargets.length > 1;
    const modSeparatorOrderIds = item.isSeparator
      ? modsWorkspace.items.filter((candidate) => candidate.isSeparator).map((candidate) => candidate.orderId)
      : [];
    const hasCollapsedModSeparators = modSeparatorOrderIds.some((orderId) =>
      modsWorkspace.collapsedSeparatorOrderIds.has(orderId)
    );
    const hasExpandedModSeparators = modSeparatorOrderIds.some(
      (orderId) => !modsWorkspace.collapsedSeparatorOrderIds.has(orderId)
    );

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label={`${modItemTitle(item)} actions`}
        data-row-context-menu-surface="true"
        style={{
          left: modMenuPosition.left,
          top: modMenuPosition.top,
          maxHeight: modMenuPosition.maxHeight
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {item.isMod ? (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setModMenuOrderId(null);
                void setModEnabled(item, !item.isEnabled);
              }}
            >
              <MenuIcon source={item.isEnabled ? menuToggleLeftIcon : menuToggleRightIcon} />
              <span>{item.isEnabled ? 'Disable' : 'Enable'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(modsBusyLabel)}
              onClick={() => {
                setModMenuOrderId(null);
                void setAllModsEnabled(true);
              }}
            >
              <MenuIcon source={menuCircleCheckIcon} />
              <span>Включить все моды</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(modsBusyLabel)}
              onClick={() => {
                setModMenuOrderId(null);
                void setAllModsEnabled(false);
              }}
            >
              <MenuIcon source={menuCircleXIcon} />
              <span>Выключить все моды</span>
            </button>
          </>
        ) : null}
        {item.isSeparator ? (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                dispatchModsWorkspace({
                  type: 'separator-collapse-toggled',
                  orderId: item.orderId
                });
                setModMenuOrderId(null);
              }}
            >
              <MenuIcon source={isCollapsed ? menuChevronDownIcon : menuChevronUpIcon} />
              <span>{isCollapsed ? 'Expand separator' : 'Collapse separator'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasExpandedModSeparators}
              onClick={() => {
                dispatchModsWorkspace({ type: 'all-separators-collapse-set', isCollapsed: true });
                setModMenuOrderId(null);
              }}
            >
              <MenuIcon source={menuChevronUpIcon} />
              <span>Свернуть все</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasCollapsedModSeparators}
              onClick={() => {
                dispatchModsWorkspace({ type: 'all-separators-collapse-set', isCollapsed: false });
                setModMenuOrderId(null);
              }}
            >
              <MenuIcon source={menuChevronDownIcon} />
              <span>Развернуть все</span>
            </button>
          </>
        ) : null}
        {item.isMod && !hasMultipleSelectedModRows ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setModMenuOrderId(null);
              void openInstalledMod(item);
            }}
          >
            <MenuIcon source={menuFolderOpenIcon} />
            <span>Open folder</span>
          </button>
        ) : null}
        {item.isSeparator ? (
          <button
            className="mod-row-menu__danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setModMenuOrderId(null);
              void deleteModSeparator(item);
            }}
          >
            <MenuIcon source={menuTrashIcon} />
            <span>Delete separator</span>
          </button>
        ) : (
          <button
            className="mod-row-menu__danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setModMenuOrderId(null);
              requestDeleteInstalledMod(item);
            }}
          >
            <MenuIcon source={menuTrashIcon} />
            <span>{hasMultipleSelectedModDeletions ? 'Delete mods' : 'Delete mod'}</span>
          </button>
        )}
      </div>,
      document.body
    );
  };

  const renderModsToolbarMenu = () => {
    if (!modsToolbarMenuPosition) {
      return null;
    }

    const packageBuildDisabled =
      !selectedProject ||
      !buildHeaderCapabilities.packageAvailable ||
      Boolean(operationOverlay?.isRunning);
    const checkUpdatesDisabled =
      !selectedProject ||
      !buildHeaderCapabilities.refreshAvailable ||
      Boolean(modsBusyLabel) ||
      Boolean(operationOverlay?.isRunning);
    const installFluxPackDisabled = !bridgeStatus?.ready || Boolean(operationOverlay?.isRunning);
    const modCreationDisabled =
      !selectedProject ||
      !bridgeStatus?.ready ||
      Boolean(modsBusyLabel) ||
      Boolean(operationOverlay?.isRunning);

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label="Действия со сборкой"
        data-row-context-menu-surface="true"
        style={{
          left: modsToolbarMenuPosition.left,
          top: modsToolbarMenuPosition.top,
          maxHeight: modsToolbarMenuPosition.maxHeight
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          title="Создать разделитель внизу списка модов"
          disabled={modCreationDisabled}
          onClick={() => openModCreationDialog('separator')}
        >
          <MenuIcon source={menuLayersIcon} />
          <span>Создать разделитель</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title="Создать пустой мод"
          disabled={modCreationDisabled}
          onClick={() => openModCreationDialog('empty-mod')}
        >
          <MenuIcon source={menuPlusIcon} />
          <span>Создать пустой мод</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title={buildHeaderCapabilities.refreshReason || 'Проверить обновления модов'}
          disabled={checkUpdatesDisabled}
          onClick={() => {
            setModsToolbarMenuPosition(null);
            void checkModUpdates();
          }}
        >
          <MenuIcon source={menuCircleCheckIcon} />
          <span>Проверить обновления</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title={buildHeaderCapabilities.packageReason || 'Экспортировать сборку в FluxPack'}
          disabled={packageBuildDisabled}
          onClick={() => {
            setModsToolbarMenuPosition(null);
            void packageFluxPack();
          }}
        >
          <MenuIcon source={menuPackagePlusIcon} />
          <span>Упаковать</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title="Установить сборку из файла FluxPack"
          disabled={installFluxPackDisabled}
          onClick={() => {
            setModsToolbarMenuPosition(null);
            void installFluxPack();
          }}
        >
          <MenuIcon source={menuHardDriveDownloadIcon} />
          <span>Установить</span>
        </button>
      </div>,
      document.body
    );
  };

  const skeletonWidth = (index: number, offset = 0) =>
    loadingSkeletonWidths[(index + offset) % loadingSkeletonWidths.length] ?? '64%';

  const renderModLoadingRows = () => (
    <div
      className="mod-list mod-list--table mod-list--loading"
      role="table"
      aria-label="Loading mods"
    >
      <span className="sr-only" role="status">
        Loading mods
      </span>
      <div className="mod-list__head" role="row">
        <span className="mod-list__head-name" role="columnheader">
          Название
        </span>
        <span role="columnheader">Версия</span>
        <span role="columnheader">Latest</span>
        <span role="columnheader">Статус</span>
      </div>
      <div className="mod-list__body mod-list__body--loading" role="rowgroup">
        {modLoadingSkeletonRows.map((index) => (
          <div
            aria-hidden="true"
            className="mod-list-row mod-list-row--skeleton"
            key={`mod-skeleton-${index}`}
            role="row"
          >
            <div className="mod-list-row__identity" role="cell">
              <span className="workspace-skeleton workspace-skeleton--toggle" />
              <div className="mod-list-row__title">
                <span
                  className="workspace-skeleton workspace-skeleton--title"
                  style={{ width: skeletonWidth(index) }}
                />
                <span
                  className="workspace-skeleton workspace-skeleton--meta"
                  style={{ width: skeletonWidth(index, 2) }}
                />
              </div>
            </div>
            <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
            <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
            <span className="workspace-skeleton workspace-skeleton--status" role="cell" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderModRows = () => {
    if (modsWorkspace.loadState === 'loading' && modsWorkspace.items.length === 0) {
      return renderModLoadingRows();
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

    if (displayedModItems.length === 0) {
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
            const isSelected = modsWorkspace.selectedOrderIds.has(item.orderId);
            const isMenuOpen = item.orderId === modMenuOrderId;
            const isOverwrite = isModOverwriteItem(item);
            const isNested = isModNestedUnderSeparator(modsWorkspace.items, item.orderId);
            const isCollapsed =
              item.isSeparator && modsWorkspace.collapsedSeparatorOrderIds.has(item.orderId);
            const status = modTableStatusView(item);
            const conflictHighlight = modRowConflictHighlight(
              modsWorkspace.items,
              item,
              selectedModItem
            );
            const conflictMarkerStates = item.isSeparator
              ? modConflictMarkerStatesForHighlight(conflictHighlight)
              : modConflictMarkerStates(item);
            const visibleConflictHighlight =
              item.isSeparator ? (isCollapsed ? conflictHighlight : 'none') : conflictHighlight;
            const visibleConflictMarkerStates =
              item.isSeparator ? (isCollapsed ? conflictMarkerStates : []) : conflictMarkerStates;
            const separatorModCount = item.isSeparator
              ? modSeparatorChildCount(modsWorkspace.items, item.orderId)
              : 0;
            const isDragging = draggedModOrderId === item.orderId;
            const isOrderDropTarget =
              modDropTarget?.orderId === item.orderId && draggedModOrderId !== item.orderId;
            const isInstallDropTarget =
              downloadInstallDropTarget?.orderId === item.orderId && !isOverwrite;
            const isDropTarget = isOrderDropTarget || isInstallDropTarget;
            const dropPlacement = isInstallDropTarget
              ? downloadInstallDropTarget?.placement
              : modDropTarget?.placement;
            const canDragModRow = !modsBusyLabel && !isOverwrite;

            return (
              <div
                className={`mod-list-row${item.isSeparator ? ' mod-list-row--separator' : ''}${isOverwrite ? ' mod-list-row--overwrite' : ''}`}
                role="row"
                tabIndex={0}
                draggable={false}
                data-reorder-kind="mod"
                data-order-id={item.orderId}
                data-selected={isSelected}
                data-separator={item.isSeparator}
                data-overwrite={isOverwrite}
                data-in-separator={isNested}
                data-collapsed={isCollapsed}
                data-conflict-highlight={visibleConflictHighlight}
                data-conflict-status={visibleConflictMarkerStates.join(' ')}
                data-dragging={isDragging}
                data-drop-target={isDropTarget}
                data-drop-placement={isDropTarget ? dropPlacement : undefined}
                data-install-drop-target={isInstallDropTarget}
                data-reorder-disabled={!canDragModRow}
                data-menu-open={isMenuOpen}
                key={item.orderId}
                aria-label={`${modItemTitle(item)} ${isOverwrite ? 'overwrite folder' : item.isSeparator ? 'separator' : 'mod'}${visibleConflictMarkerStates.length > 0 ? ` ${modConflictMarkerTitle(visibleConflictMarkerStates)}` : ''}`}
                aria-expanded={item.isSeparator ? !isCollapsed : undefined}
                aria-selected={isSelected}
                onClick={(event) => {
                  if (consumeSuppressedRowClick()) {
                    return;
                  }

                  event.currentTarget.focus({ preventScroll: true });
                  handleModRowSelection(event, item);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!modsWorkspace.selectedOrderIds.has(item.orderId)) {
                    dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  }
                  setModMenuPosition(
                    rowContextMenuPositionFromPointer(event.clientX, event.clientY)
                  );
                  setModMenuOrderId(item.orderId);
                }}
                onDoubleClick={(event) => {
                  if (isInteractiveRowDragTarget(event.target)) {
                    return;
                  }

                  void openModDetailsWindow(item);
                }}
                onDragOver={(event) => handleModInstallDragOver(event, item)}
                onDrop={(event) => void handleModInstallDrop(event, item)}
                onPointerDown={(event) => {
                  if (!beginRowReorderDrag(event, 'mod', item.orderId, canDragModRow)) {
                    return;
                  }

                  dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  setModMenuOrderId(null);
                }}
                onPointerMove={updateRowReorderDrag}
                onPointerUp={endRowReorderDrag}
                onPointerCancel={cancelRowReorderDrag}
                onKeyDown={(event) => {
                  handleModRowKeyDown(event, item);
                }}
              >
                {isDropTarget ? (
                  <span className="row-drop-target-chip" aria-hidden="true">
                    {isInstallDropTarget ? 'Установить сюда' : 'Сюда'}
                  </span>
                ) : null}
                {isOverwrite ? (
                  <>
                    <div className="mod-overwrite-cell" role="cell">
                      <span className="mod-overwrite-icon" aria-hidden="true">
                        <FolderOpen size={16} />
                      </span>
                      <div className="mod-overwrite-title">
                        <strong>{modItemTitle(item)}</strong>
                        <span>{item.id || 'overwrite'}</span>
                      </div>
                      <span className="mod-overwrite-state-cell" data-status="local">
                        <StatusDot
                          label="Overwrite output folder"
                          size={20}
                          state="none"
                          title="Generated files are written here after mods"
                        />
                      </span>
                    </div>
                    {isMenuOpen ? renderModRowMenu(item) : null}
                  </>
                ) : item.isSeparator ? (
                  <>
                    <div className="mod-separator-cell" role="cell">
                      <button
                        className="separator-toggle-button mod-separator-toggle-button"
                        type="button"
                        title={isCollapsed ? 'Expand separator' : 'Collapse separator'}
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${modItemTitle(item)}`}
                        aria-expanded={!isCollapsed}
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatchModsWorkspace({
                            type: 'separator-collapse-toggled',
                            orderId: item.orderId
                          });
                          setModMenuOrderId(null);
                        }}
                      >
                        {isCollapsed ? (
                          <ChevronRight size={18} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={18} aria-hidden="true" />
                        )}
                      </button>
                      <strong className="mod-separator-title">{modItemTitle(item)}</strong>
                    </div>
                    <span className="mod-list-row__status mod-separator-status" role="cell">
                      <span className="mod-separator-count">
                        {separatorModCount} {separatorModCount === 1 ? 'mod' : 'mods'}
                      </span>
                      <ModConflictMarkers
                        className="mod-separator-conflicts"
                        states={visibleConflictMarkerStates}
                      />
                    </span>
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
                      <span
                        className="mod-overwrite-state-cell"
                        data-status={status.tone}
                        title={status.overwrite.title}
                      >
                        <StatusDot
                          className="mod-conflict-dot"
                          label={status.overwrite.title}
                          size={20}
                          state={status.overwrite.state}
                          title={status.overwrite.title}
                        />
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
        {modConflictScrollbarMarkers.length > 0 ? (
          <div className="mod-conflict-scrollbar" aria-hidden="true">
            {modConflictScrollbarMarkers.map((marker) => (
              <span
                data-state={marker.state}
                key={marker.key}
                style={
                  {
                    '--conflict-marker-top': marker.top,
                    '--conflict-marker-offset': marker.offset
                  } as ModConflictMarkerStyle
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderFileTreeEntries = (relativeDirectory = '', depth = 0): ReactElement[] => {
    const entries = fileTreeCache[relativeDirectory] ?? [];
    return entries.flatMap((entry) => {
      const isExpanded = Boolean(expandedFileTree[entry.relativePath]);
      const isLoading = fileTreeLoadingPath === entry.relativePath;
      const previewKind = entry.isDirectory ? null : previewKindForFile(entry.name);
      const canEditFile = !entry.isDirectory && isTextEditorFileName(entry.name);
      const canPreviewFile = !entry.isDirectory && previewKind !== null;
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
          {entry.isDirectory && entry.hasChildren ? (
            <button
              className="file-tree-file-link file-tree-file-link--folder"
              type="button"
              onClick={() => void toggleFileTreeDirectory(entry)}
              title={isExpanded ? `Close ${entry.name}` : `Open ${entry.name}`}
            >
              {entry.name}
            </button>
          ) : entry.isDirectory || (!canEditFile && !canPreviewFile) ? (
            <span>{entry.name}</span>
          ) : canPreviewFile ? (
            <button
              className="file-tree-file-link file-tree-file-link--preview"
              data-preview-kind={previewKind.kind}
              type="button"
              onClick={() => void openFilePreviewForFile(entry)}
              title={`Open ${entry.name}`}
            >
              {entry.name}
            </button>
          ) : (
            <button
              className="file-tree-file-link"
              type="button"
              onClick={() => void openTextEditorForFile(entry)}
              title={`Open ${entry.name}`}
            >
              {entry.name}
            </button>
          )}
          <span className="file-tree-row__meta">
            <strong>{isLoading ? 'Loading' : formatFileSize(entry.size)}</strong>
            {canEditFile ? (
              <button
                className="icon-button file-tree-row__action"
                type="button"
                title={`Edit ${entry.name}`}
                aria-label={`Edit ${entry.name}`}
                onClick={() => void openTextEditorForFile(entry)}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            ) : canPreviewFile ? (
              <button
                className="icon-button file-tree-row__action"
                type="button"
                title={`Open ${entry.name}`}
                aria-label={`Open ${entry.name}`}
                onClick={() => void openFilePreviewForFile(entry)}
              >
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            ) : null}
          </span>
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
          <dd>{selectedModItem?.isMod ? selectedModItem.version || 'local' : isModOverwriteItem(selectedModItem) ? 'overwrite' : 'separator'}</dd>
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

  const renderModDetailsConflictList = (
    entries: FluxoraModFileTreeEntry[],
    emptyText: string
  ) => {
    if (entries.length === 0) {
      return <span className="mod-details-empty">{emptyText}</span>;
    }

    return (
      <div className="mod-details-conflict-list">
        {entries.map((entry) => (
          <div className="mod-details-conflict-row" key={`${entry.conflictState}:${entry.relativePath}`}>
            <span title={entry.relativePath}>{entry.relativePath}</span>
            <small title={entry.conflictOwners.join(' · ')}>
              {entry.conflictOwners.length > 0 ? entry.conflictOwners.join(' · ') : entry.conflictState}
            </small>
          </div>
        ))}
      </div>
    );
  };

  const renderModDetailsWindow = () => {
    const modItem =
      selectedModItem?.isMod
        ? selectedModItem
        : modDetailsSummary?.isMod
          ? modDetailsSummary
          : null;
    const modReady = modItem !== null;
    const modTitle = modItem ? modItemTitle(modItem) : modDetailsInitialName || 'Mod';
    const overwrite = modItem ? modOverwriteView(modItem) : null;
    const fileCount = modItem ? modItem.fileCount : 0;
    const overwritesCount = modItem ? modItem.overwritingFileCount : 0;
    const overwrittenCount = modItem ? modItem.overwrittenFileCount : 0;
    const projectTitle = selectedProject?.name ?? initialModDetailsBootstrap?.projectName ?? 'Build';

    return (
      <section className="mod-details-window" aria-label="Mod details">
        <header className="mod-details-header">
          <div className="mod-details-title">
            <span>{projectTitle}</span>
            <h2>{modTitle}</h2>
          </div>
          <dl className="mod-details-facts" aria-label="Mod summary">
            <div>
              <dt>Files</dt>
              <dd>{modReady ? fileCount : '...'}</dd>
            </div>
            <div>
              <dt>Overwrites</dt>
              <dd>{modReady ? overwritesCount : '...'}</dd>
            </div>
            <div>
              <dt>Overwritten</dt>
              <dd>{modReady ? overwrittenCount : '...'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{overwrite?.label || modStatusText(modItem)}</dd>
            </div>
          </dl>
        </header>

        <div className="mod-details-tabs" role="tablist" aria-label="Mod details sections">
          {modDetailsTabs.map((tab) => (
            <button
              aria-selected={modDetailsTab === tab.id}
              data-active={modDetailsTab === tab.id}
              key={tab.id}
              onClick={() => setModDetailsTab(tab.id)}
              role="tab"
              type="button"
            >
              <AssetIcon source={tab.icon} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <section
          className="mod-details-panel"
          role="tabpanel"
          aria-label={modDetailsTab === 'files' ? 'Файлы' : 'Конфликты'}
        >
          {modDetailsTab === 'files' ? (
            <div className="file-tree mod-details-file-tree" role="tree" aria-label="Mod file tree">
              {!modReady ? (
                <span className="file-tree-empty">Mod unavailable.</span>
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
          ) : (
            <div className="mod-details-conflicts">
              <section aria-label="Перезаписывает">
                <header>
                  <strong>Перезаписывает:</strong>
                  <span>{overwritesCount}</span>
                </header>
                {modDetailsConflictScanState === 'loading' ? (
                  <span className="mod-details-empty">Scanning files</span>
                ) : modDetailsConflictScanState === 'error' ? (
                  <span className="mod-details-empty">Conflicts unavailable.</span>
                ) : (
                  renderModDetailsConflictList(
                    modDetailsConflictEntries.overwrites,
                    'No overwritten files loaded.'
                  )
                )}
              </section>
              <section aria-label="Перезаписывается">
                <header>
                  <strong>Перезаписывается:</strong>
                  <span>{overwrittenCount}</span>
                </header>
                {modDetailsConflictScanState === 'loading' ? (
                  <span className="mod-details-empty">Scanning files</span>
                ) : modDetailsConflictScanState === 'error' ? (
                  <span className="mod-details-empty">Conflicts unavailable.</span>
                ) : (
                  renderModDetailsConflictList(
                    modDetailsConflictEntries.overwritten,
                    'No overwriting files loaded.'
                  )
                )}
              </section>
            </div>
          )}
        </section>
      </section>
    );
  };

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
        <section
          className="work-surface mods-surface"
          data-download-install-active={Boolean(draggedDownloadInstallId)}
          onDragOver={handleModInstallSurfaceDragOver}
          onDrop={(event) => void handleModInstallSurfaceDrop(event)}
        >
          <div className="surface-header">
            <div>
              <p className="eyebrow">Mods</p>
              <h2>{selectedProject.name}</h2>
            </div>
          </div>
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

  const renderPluginRowMenu = (item: FluxoraPluginOrderItem) => {
    if (pluginMenuOrderId !== item.orderId || !pluginMenuPosition) {
      return null;
    }

    const hasMultipleSelectedPluginRows = pluginsWorkspace.selectedOrderIds.size > 1;
    const isCollapsed =
      item.isSeparator && pluginsWorkspace.collapsedSeparatorOrderIds.has(item.orderId);
    const pluginSeparatorOrderIds = item.isSeparator
      ? pluginsWorkspace.items.filter((candidate) => candidate.isSeparator).map((candidate) => candidate.orderId)
      : [];
    const hasCollapsedPluginSeparators = pluginSeparatorOrderIds.some((orderId) =>
      pluginsWorkspace.collapsedSeparatorOrderIds.has(orderId)
    );
    const hasExpandedPluginSeparators = pluginSeparatorOrderIds.some(
      (orderId) => !pluginsWorkspace.collapsedSeparatorOrderIds.has(orderId)
    );

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label={`${pluginItemTitle(item)} actions`}
        data-row-context-menu-surface="true"
        style={{
          left: pluginMenuPosition.left,
          top: pluginMenuPosition.top,
          maxHeight: pluginMenuPosition.maxHeight
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {item.isPlugin ? (
          <>
            {!hasMultipleSelectedPluginRows ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPluginMenuOrderId(null);
                  void openPluginInExplorer(item);
                }}
              >
                <MenuIcon source={menuFolderOpenIcon} />
                <span>Открыть в проводнике</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(pluginsBusyLabel) || !pluginCapabilities.bulkToggleSupported}
              onClick={() => {
                setPluginMenuOrderId(null);
                void setAllPluginsEnabled(true);
              }}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>Включить все плагины</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(pluginsBusyLabel) || !pluginCapabilities.bulkToggleSupported}
              onClick={() => {
                setPluginMenuOrderId(null);
                void setAllPluginsEnabled(false);
              }}
            >
              <XCircle size={14} aria-hidden="true" />
              <span>Выключить все плагины</span>
            </button>
          </>
        ) : null}
        {item.isSeparator ? (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                dispatchPluginsWorkspace({
                  type: 'separator-collapse-toggled',
                  orderId: item.orderId
                });
                setPluginMenuOrderId(null);
              }}
            >
              <MenuIcon source={isCollapsed ? menuChevronDownIcon : menuChevronUpIcon} />
              <span>{isCollapsed ? 'Expand separator' : 'Collapse separator'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasExpandedPluginSeparators}
              onClick={() => {
                dispatchPluginsWorkspace({ type: 'all-separators-collapse-set', isCollapsed: true });
                setPluginMenuOrderId(null);
              }}
            >
              <MenuIcon source={menuChevronUpIcon} />
              <span>Свернуть все</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasCollapsedPluginSeparators}
              onClick={() => {
                dispatchPluginsWorkspace({ type: 'all-separators-collapse-set', isCollapsed: false });
                setPluginMenuOrderId(null);
              }}
            >
              <MenuIcon source={menuChevronDownIcon} />
              <span>Развернуть все</span>
            </button>
          </>
        ) : null}
        {item.isSeparator ? (
          <button
            className="mod-row-menu__danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setPluginMenuOrderId(null);
              void deletePluginSeparator(item);
            }}
          >
            <MenuIcon source={menuTrashIcon} />
            <span>Delete separator</span>
          </button>
        ) : null}
      </div>,
      document.body
    );
  };

  const renderPluginLoadingRows = () => (
    <div
      className="mod-table plugin-table plugin-table--loading"
      role="table"
      aria-label="Loading plugins"
    >
      <span className="sr-only" role="status">
        Loading plugins
      </span>
      <div className="mod-row plugin-row mod-row--head" role="row">
        <span role="columnheader">Order</span>
        <span role="columnheader">Plugin</span>
        <span role="columnheader">Source</span>
        <span role="columnheader">Статус</span>
      </div>
      <div className="mod-table__body mod-table__body--loading">
        {pluginLoadingSkeletonRows.map((index) => (
          <div
            aria-hidden="true"
            className="mod-row plugin-row plugin-row--skeleton"
            key={`plugin-skeleton-${index}`}
            role="row"
          >
            <span className="plugin-hex-index" role="cell">
              <span className="workspace-skeleton workspace-skeleton--hex" />
            </span>
            <div className="mod-row__main plugin-row__main" role="cell">
              <span className="workspace-skeleton workspace-skeleton--toggle" />
              <div className="plugin-row__title">
                <span
                  className="workspace-skeleton workspace-skeleton--title"
                  style={{ width: skeletonWidth(index, 1) }}
                />
                <span
                  className="workspace-skeleton workspace-skeleton--meta"
                  style={{ width: skeletonWidth(index, 3) }}
                />
              </div>
            </div>
            <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
            <span className="workspace-skeleton workspace-skeleton--status" role="cell" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderPluginRows = () => {
    if (pluginsWorkspace.loadState === 'loading' && pluginsWorkspace.items.length === 0) {
      return renderPluginLoadingRows();
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
          <span role="columnheader">Source</span>
          <span role="columnheader">Статус</span>
        </div>
        <div
          className="mod-table__body"
          onScroll={(event) => setPluginListScrollTop(event.currentTarget.scrollTop)}
        >
          {visiblePluginWindow.topSpacer > 0 ? (
            <div style={{ height: visiblePluginWindow.topSpacer }} aria-hidden="true" />
          ) : null}
          {visiblePluginWindow.items.map((item) => {
            const isSelected = pluginsWorkspace.selectedOrderIds.has(item.orderId);
            const isMenuOpen = item.orderId === pluginMenuOrderId;
            const isNested = isPluginNestedUnderSeparator(pluginsWorkspace.items, item.orderId);
            const isCollapsed =
              item.isSeparator && pluginsWorkspace.collapsedSeparatorOrderIds.has(item.orderId);
            const hidesSeparatorChildren = isCollapsed;
            const separatorPluginCount = item.isSeparator
              ? pluginSeparatorChildCount(pluginsWorkspace.items, item.orderId)
              : 0;
            const isDragging = draggedPluginOrderId === item.orderId;
            const isDropTarget =
              pluginDropTarget?.orderId === item.orderId && draggedPluginOrderId !== item.orderId;
            const canDragPluginRow =
              pluginCapabilities.loadOrderSupported &&
              !pluginsBusyLabel &&
              canDragPluginOrderItem(pluginsWorkspace.items, item.orderId);
            const missingMasterSummary = item.isSeparator
              ? hidesSeparatorChildren
                ? pluginSeparatorMissingMasterSummary(
                    pluginsWorkspace.items,
                    item.orderId,
                    pluginMissingMasterStatusLimit,
                    pluginMissingMasterContext
                  )
                : pluginMissingMasterSummary(null, pluginMissingMasterStatusLimit)
              : pluginMissingMasterSummary(
                  item,
                  pluginMissingMasterStatusLimit,
                  pluginMissingMasterContext
                );
            const hasMissingMasters =
              showPluginMissingMastersStatus && missingMasterSummary.totalCount > 0;
            const missingMasterLabel = item.isSeparator
              ? `Отсутствуют мастер-файлы в разделителе ${pluginItemTitle(item)}: ${missingMasterSummary.visibleMasters.join(', ')}${
                  missingMasterSummary.hiddenCount > 0
                    ? `, и ещё ${missingMasterSummary.hiddenCount}`
                    : ''
                }`
              : undefined;

            return (
              <div
                className="mod-row plugin-row"
                role="row"
                tabIndex={0}
                draggable={false}
                data-reorder-kind="plugin"
                data-order-id={item.orderId}
                data-selected={isSelected}
                data-separator={item.isSeparator}
                data-in-separator={isNested}
                data-collapsed={isCollapsed}
                data-locked={item.isLocked}
                data-missing-masters={hasMissingMasters}
                data-dragging={isDragging}
                data-drop-target={isDropTarget}
                data-drop-placement={isDropTarget ? pluginDropTarget?.placement : undefined}
                data-reorder-disabled={!canDragPluginRow}
                data-menu-open={isMenuOpen}
                key={item.orderId}
                aria-label={`${pluginItemTitle(item)} ${item.isSeparator ? 'separator' : 'plugin'}${
                  hasMissingMasters ? ' missing masters' : ''
                }`}
                aria-expanded={item.isSeparator ? !isCollapsed : undefined}
                aria-selected={isSelected}
                onClick={(event) => {
                  if (consumeSuppressedRowClick()) {
                    return;
                  }

                  event.currentTarget.focus({ preventScroll: true });
                  handlePluginRowSelection(event, item);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!pluginsWorkspace.selectedOrderIds.has(item.orderId)) {
                    dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                  }
                  setPluginMenuPosition(
                    rowContextMenuPositionFromPointer(event.clientX, event.clientY)
                  );
                  setPluginMenuOrderId(item.orderId);
                }}
                onPointerDown={(event) => {
                  if (!beginRowReorderDrag(event, 'plugin', item.orderId, canDragPluginRow)) {
                    return;
                  }

                  dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                  setPluginMenuOrderId(null);
                }}
                onPointerMove={updateRowReorderDrag}
                onPointerUp={endRowReorderDrag}
                onPointerCancel={cancelRowReorderDrag}
                onKeyDown={(event) => {
                  handlePluginRowKeyDown(event, item);
                }}
              >
                {isDropTarget ? (
                  <span className="row-drop-target-chip" aria-hidden="true">
                    Сюда
                  </span>
                ) : null}
                <span className="plugin-hex-index" role="cell">
                  {item.isSeparator ? (
                    <button
                      className="separator-toggle-button"
                      type="button"
                      title={isCollapsed ? 'Expand separator' : 'Collapse separator'}
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${pluginItemTitle(item)}`}
                      aria-expanded={!isCollapsed}
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatchPluginsWorkspace({
                          type: 'separator-collapse-toggled',
                          orderId: item.orderId
                        });
                        setPluginMenuOrderId(null);
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRight size={15} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={15} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    pluginHexIndex(item)
                  )}
                </span>
                <div
                  className={item.isPlugin ? 'mod-row__main plugin-row__main' : 'mod-row__main'}
                  role="cell"
                >
                  {item.isPlugin ? (
                    <label
                      className="mod-enable-checkbox plugin-enable-checkbox"
                      title={item.isEnabled ? 'Disable plugin' : 'Enable plugin'}
                      onClick={(event) => event.stopPropagation()}
                    >
                        <input
                          type="checkbox"
                          checked={item.isEnabled}
                          disabled={item.isLocked || Boolean(pluginsBusyLabel)}
                          aria-label={
                            item.isEnabled
                              ? `Disable ${pluginItemTitle(item)}`
                            : `Enable ${pluginItemTitle(item)}`
                        }
                        title={item.isEnabled ? 'Disable plugin' : 'Enable plugin'}
                        onChange={(event) => void setPluginEnabled(item, event.currentTarget.checked)}
                      />
                      <span aria-hidden="true" />
                    </label>
                  ) : null}
                  <div className="plugin-row__title">
                    <strong>{pluginItemTitle(item)}</strong>
                    <span>
                      {item.isSeparator
                        ? `${separatorPluginCount} ${
                            separatorPluginCount === 1 ? 'plugin' : 'plugins'
                          }`
                        : pluginSourceLabel(item)}
                    </span>
                  </div>
                </div>
                <span role="cell">{item.isSeparator ? '' : item.sourceMod || 'game data'}</span>
                <span className="plugin-status-cell" role="cell">
                  {hasMissingMasters ? (
                    <MissingMastersStatus
                      enabled={showPluginMissingMastersStatus}
                      label={missingMasterLabel}
                      plugin={item}
                      summary={missingMasterSummary}
                    />
                  ) : null}
                </span>
                {isMenuOpen ? renderPluginRowMenu(item) : null}
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
          </div>
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

  const renderDownloadRowMenu = (entry: FluxoraDownloadEntry) => {
    if (downloadMenuId !== entry.id || !downloadMenuPosition) {
      return null;
    }

    const downloadDeleteTargets = downloadDeletionEntriesFor(entry);
    const hasMultipleSelectedDownloadDeletions = downloadDeleteTargets.length > 1;

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label={`${downloadTitle(entry)} actions`}
        data-row-context-menu-surface="true"
        style={{
          left: downloadMenuPosition.left,
          top: downloadMenuPosition.top,
          maxHeight: downloadMenuPosition.maxHeight
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          disabled={!entry.canInstall || Boolean(downloadsBusyLabel)}
          onClick={() => {
            setDownloadMenuId(null);
            void installDownload(entry);
          }}
        >
          <MenuIcon source={menuPackagePlusIcon} />
          Install
        </button>
        {entry.isDownloading ? (
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(downloadsBusyLabel)}
            onClick={() => {
              setDownloadMenuId(null);
              void cancelDownload(entry);
            }}
          >
            <MenuIcon source={menuCircleXIcon} />
            Cancel
          </button>
        ) : null}
        {entry.canResume ? (
          <button
            type="button"
            role="menuitem"
            disabled={Boolean(downloadsBusyLabel)}
            onClick={() => {
              setDownloadMenuId(null);
              void resumeDownload(entry);
            }}
          >
            <MenuIcon source={menuPlayIcon} />
            Resume
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setDownloadMenuId(null);
            void openDownloadInShell(entry);
          }}
        >
          <MenuIcon source={menuFolderOpenIcon} />
          Show in folder
        </button>
        <button
          className="mod-row-menu__danger"
          type="button"
          role="menuitem"
          disabled={downloadDeleteTargets.length === 0 || Boolean(downloadsBusyLabel)}
          onClick={() => {
            setDownloadMenuId(null);
            requestDeleteDownload(entry);
          }}
        >
          <MenuIcon source={menuTrashIcon} />
          {hasMultipleSelectedDownloadDeletions ? 'Delete files' : 'Delete'}
        </button>
      </div>,
      document.body
    );
  };

  const renderDownloadSkeletonRows = () => (
    <div
      className="mod-table download-table download-table--skeleton"
      role="table"
      aria-label="Downloads"
      aria-busy="true"
    >
      <div className="mod-row download-row mod-row--head" role="row">
        <span role="columnheader">File</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Source</span>
      </div>
      <div className="mod-table__body" role="rowgroup">
        {downloadSkeletonRows.map((row) => (
          <div className="mod-row download-row download-row--skeleton" role="row" key={row.id}>
            <div className="mod-row__main" role="cell">
              <span
                className="download-skeleton download-skeleton--title"
                style={{ width: `${row.titleWidth}%` }}
              />
            </div>
            <div className="download-progress download-progress--skeleton" role="cell">
              <div
                className="download-progress__bar download-progress__bar--skeleton"
                aria-hidden="true"
              >
                <span style={{ width: `${row.barWidth}%` }} />
              </div>
              <span
                className="download-skeleton download-skeleton--progress-text"
                style={{ width: `${row.progressWidth}%` }}
              />
            </div>
            <span role="cell">
              <span
                className="download-skeleton download-skeleton--size"
                style={{ width: `${row.sizeWidth}%` }}
              />
            </span>
            <span role="cell">
              <span
                className="download-skeleton download-skeleton--source"
                style={{ width: `${row.sourceWidth}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDownloadDropSurface = (content: ReactElement) => {
    const statusText =
      downloadDropCue === 'importing'
        ? 'Adding archive to Downloads'
        : downloadDropCue === 'hover'
          ? 'Drop archive to add it to Downloads'
          : '';

    return (
      <div
        className="download-drop-surface"
        data-drop-state={downloadDropCue}
        ref={downloadDropSurfaceRef}
        onDragEnter={handleDownloadsDragEnter}
        onDragLeave={handleDownloadsDragLeave}
        onDragOver={handleDownloadsDragOver}
        onDrop={handleDownloadsDrop}
      >
        {content}
        {downloadDropCue !== 'idle' ? (
          <div className="download-drop-cue" aria-hidden="true">
            <div className="download-drop-cue__content">
              <UploadCloud size={22} aria-hidden="true" />
              <div>
                <strong>{downloadDropCue === 'importing' ? 'Adding archive' : 'Drop archive'}</strong>
                <span>Downloads</span>
              </div>
            </div>
          </div>
        ) : null}
        <span className="sr-only" role="status" aria-live="polite">
          {statusText}
        </span>
      </div>
    );
  };

  const renderDownloadRows = () => {
    if (downloadsWorkspace.loadState === 'loading') {
      return renderDownloadSkeletonRows();
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
          <span role="columnheader">Status</span>
          <span role="columnheader">Size</span>
          <span role="columnheader">Source</span>
        </div>
        <div
          className="mod-table__body"
          onScroll={(event) => setDownloadListScrollTop(event.currentTarget.scrollTop)}
        >
          {visibleDownloadWindow.topSpacer > 0 ? (
            <div style={{ height: visibleDownloadWindow.topSpacer }} aria-hidden="true" />
          ) : null}
          {visibleDownloadWindow.items.map((entry) => {
            const isSelected = downloadsWorkspace.selectedIds.has(entry.id);
            const isMenuOpen = entry.id === downloadMenuId;
            const status = downloadStatusView(entry);

            return (
              <div
                className="mod-row download-row"
                role="row"
                tabIndex={0}
                draggable={entry.canInstall && !downloadsBusyLabel}
                data-selected={isSelected}
                data-ready={entry.canInstall}
                data-dragging={draggedDownloadInstallId === entry.id}
                data-menu-open={isMenuOpen}
                key={entry.id}
                aria-selected={isSelected}
                onClick={(event) => {
                  handleDownloadRowSelection(event, entry);
                }}
                onDoubleClick={() => {
                  dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  if (entry.canInstall) {
                    void installDownload(entry);
                  }
                }}
                onDragStart={(event) => handleDownloadInstallDragStart(event, entry)}
                onDragEnd={handleDownloadInstallDragEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!downloadsWorkspace.selectedIds.has(entry.id)) {
                    dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  }
                  setDownloadMenuPosition(
                    rowContextMenuPositionFromPointer(
                      event.clientX,
                      event.clientY,
                      downloadRowMenuEstimatedHeight(entry)
                    )
                  );
                  setDownloadMenuId(entry.id);
                }}
                onKeyDown={(event) => {
                  handleDownloadRowKeyDown(event, entry);
                }}
              >
                <div className="mod-row__main" role="cell">
                  <strong title={downloadRawTitle(entry)}>{downloadTitle(entry)}</strong>
                </div>
                <div className="download-progress" role="cell" data-status={status.tone}>
                  {status.showProgress ? (
                    <div className="download-progress__bar" aria-hidden="true">
                      <span style={{ width: `${entry.hasKnownProgress ? status.progressValue : 0}%` }} />
                    </div>
                  ) : null}
                  <small>{status.text}</small>
                </div>
                <span role="cell">{entry.sizeText || '-'}</span>
                <span role="cell">{entry.source || 'local'}</span>
                {isMenuOpen ? renderDownloadRowMenu(entry) : null}
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

  const renderEffectiveFileTreeRow = ({ entry, level }: EffectiveFileTreeRow) => {
    const isExpanded = Boolean(expandedEffectiveFileTree[entry.relativePath]);
    const sourceLabel = effectiveFileTreeSourceLabel(entry);
    const canOpen = Boolean(entry.sourcePath);
    const rowName = entry.name || 'Game Root';

    return (
      <div
        className="right-pane-data-row"
        data-kind={entry.isDirectory ? 'directory' : 'file'}
        data-source-kind={entry.sourceKind}
        key={entry.relativePath || 'root'}
        role="treeitem"
        aria-expanded={entry.isDirectory && entry.hasChildren ? isExpanded : undefined}
        aria-level={level}
        style={{ paddingLeft: `${6 + (level - 1) * 16}px` }}
        onDoubleClick={() => {
          if (entry.isDirectory && entry.hasChildren) {
            void toggleEffectiveFileTreeDirectory(entry);
            return;
          }
          if (canOpen) {
            void openEffectiveFileTreeEntry(entry);
          }
        }}
      >
        <button
          className="icon-button right-pane-data-row__toggle"
          type="button"
          title={isExpanded ? 'Collapse' : 'Expand'}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${rowName}`}
          disabled={!entry.isDirectory || !entry.hasChildren}
          onClick={() => void toggleEffectiveFileTreeDirectory(entry)}
        >
          {isExpanded ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
        </button>
        {entry.isDirectory ? (
          <FolderOpen size={15} aria-hidden="true" />
        ) : (
          <File size={15} aria-hidden="true" />
        )}
        <span className="right-pane-data-row__label" title={effectiveVirtualPathLabel(entry)}>
          {rowName}
        </span>
        <code title={entry.virtualPath}>{effectiveVirtualPathLabel(entry)}</code>
        <span className="right-pane-data-row__source" title={sourceLabel}>
          {sourceLabel}
        </span>
        {canOpen ? (
          <span className="right-pane-data-row__actions">
            <button
              className="icon-button"
              type="button"
              title={`Open ${effectiveVirtualPathLabel(entry)}`}
              aria-label={`Open ${effectiveVirtualPathLabel(entry)}`}
              onClick={() => void openEffectiveFileTreeEntry(entry)}
            >
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          </span>
        ) : (
          <span className="right-pane-data-row__actions" aria-hidden="true" />
        )}
      </div>
    );
  };

  const renderEffectiveFileTreeSkeletonRows = () => (
    <>
      <span className="sr-only" role="status">
        Loading data
      </span>
      {effectiveFileTreeSkeletonRows.map((index) => (
        <div
          aria-hidden="true"
          className="right-pane-data-row right-pane-data-row--skeleton"
          key={`effective-tree-skeleton-${index}`}
          role="treeitem"
          style={{ paddingLeft: `${6 + (index % 4) * 16}px` }}
        >
          <span className="workspace-skeleton workspace-skeleton--toggle" />
          <span className="workspace-skeleton workspace-skeleton--toggle" />
          <span
            className="workspace-skeleton workspace-skeleton--title"
            style={{ width: skeletonWidth(index) }}
          />
          <span
            className="workspace-skeleton workspace-skeleton--cell"
            style={{ width: skeletonWidth(index, 2) }}
          />
          <span
            className="workspace-skeleton workspace-skeleton--badge"
            style={{ width: skeletonWidth(index, 3) }}
          />
          <span className="workspace-skeleton workspace-skeleton--action" />
        </div>
      ))}
    </>
  );

  const renderDataRightPane = () => {
    const showInitialSkeleton =
      (effectiveFileTreeState === 'idle' || effectiveFileTreeState === 'refreshing') &&
      effectiveFileTreeRows.length === 0;
    const showUnavailable = effectiveFileTreeState === 'error';
    const showEmpty =
      effectiveFileTreeState === 'ready' &&
      effectiveFileTreeSnapshot !== null &&
      effectiveFileTreeRows.length === 0;

    return (
      <div
        key="data"
        className="right-pane-content right-pane-content--data"
        role="tabpanel"
        aria-label="Данные"
      >
        <div
          className="right-pane-data-tree file-tree"
          role="tree"
          aria-label="Effective game root"
          aria-busy={showInitialSkeleton || effectiveFileTreeState === 'refreshing'}
          data-state={effectiveFileTreeState}
          onScroll={(event) => setEffectiveFileTreeScrollTop(event.currentTarget.scrollTop)}
        >
          {showInitialSkeleton ? (
            renderEffectiveFileTreeSkeletonRows()
          ) : showUnavailable ? (
            <div className="file-tree-empty file-tree-empty--actionable">
              <span>{effectiveFileTreeError || 'Данные недоступны.'}</span>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  void loadEffectiveFileTree(selectedProject, selectedProjectProfileName, {
                    force: true,
                    requestKey: effectiveFileTreeRequestKey
                  })
                }
              >
                Повторить
              </button>
            </div>
          ) : showEmpty ? (
            <span className="file-tree-empty">Нет файлов в дереве.</span>
          ) : (
            <>
              {visibleEffectiveFileTreeWindow.topSpacer > 0 ? (
                <div style={{ height: visibleEffectiveFileTreeWindow.topSpacer }} aria-hidden="true" />
              ) : null}
              {visibleEffectiveFileTreeWindow.items.map(renderEffectiveFileTreeRow)}
              {visibleEffectiveFileTreeWindow.bottomSpacer > 0 ? (
                <div style={{ height: visibleEffectiveFileTreeWindow.bottomSpacer }} aria-hidden="true" />
              ) : null}
            </>
          )}
        </div>
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
        key="build"
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

  const renderPluginsRightPane = () => (
    <div
      key="plugins"
      className="right-pane-content right-pane-content--plugins"
      role="tabpanel"
      aria-label="Плагины"
    >
      <div className="plugins-pane-toolbar">
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
        {showPluginMissingMastersStatus ? (
          <button
            className="plugins-info-trigger"
            type="button"
            aria-label="Skyrim plugin slot information"
            aria-describedby="skyrim-plugin-info-popover"
          >
            <AssetIcon source={infoCircleIcon} />
            <span
              className="plugins-info-popover"
              id="skyrim-plugin-info-popover"
              role="tooltip"
            >
              <span className="plugins-info-popover__row">
                <span>Кол-во плагинов (включенных)</span>
                <strong>{enabledPluginSlotCounts.enabled}</strong>
              </span>
              <span className="plugins-info-popover__row">
                <span>Кол-во лёгких плагинов</span>
                <strong>{enabledPluginSlotCounts.light} / 4096</strong>
              </span>
              <span className="plugins-info-popover__row">
                <span>Кол-во тяжёлых плагинов</span>
                <strong>{enabledPluginSlotCounts.heavy} / 256</strong>
              </span>
            </span>
          </button>
        ) : null}
      </div>
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
    </div>
  );

  const renderDownloadsRightPane = () => (
    <div
      key="downloads"
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
          onClick={() =>
            void loadDownloadsWorkspace(selectedProject, {
              showLoading: false
            })
          }
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
      {downloadsBusyLabel && downloadsWorkspace.loadState !== 'loading' ? (
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
        renderDownloadDropSurface(renderDownloadRows())
      )}
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
      onArchiveTreeScrollTopChange={setArchiveTreeScrollTop}
      onClose={() => setInstallDialog(null)}
      onContinueFromFomod={() => void continueFromFomod()}
      onMoveFomodStep={(direction) => void moveInstallFomodStep(direction)}
      onPatch={setInstallDialogPatch}
      onResolveExistingMod={(mode) => void submitInstallOptions(mode)}
      onSubmitInstallOptions={() => void submitInstallOptions()}
    />
  );

  const renderModCreationDialog = () => (
    <ModCreationDialog
      state={modCreationDialog}
      onCancel={() => setModCreationDialog(null)}
      onNameChange={updateModCreationDialogName}
      onSubmit={() => void submitModCreationDialog()}
    />
  );

  const closeDeletionConfirmation = () => setDeletionConfirmation(null);

  const confirmDeletion = async () => {
    const request = deletionConfirmation;
    if (!request) {
      return;
    }

    setDeletionConfirmation(null);

    try {
      await request.onConfirm();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const renderDeletionConfirmation = () =>
    deletionConfirmation ? (
      <DeletionConfirmationDialog
        itemCount={deletionConfirmation.itemCount}
        itemName={deletionConfirmation.itemName}
        kind={deletionConfirmation.kind}
        onCancel={closeDeletionConfirmation}
        onConfirm={() => void confirmDeletion()}
      />
    ) : null;

  const renderFluxPackExportDialog = () =>
    fluxPackExportPath && selectedProject ? (
      <FluxPackExportDialog
        buildName={selectedProject.name}
        defaultPackageType={fluxPackPackageType}
        onCancel={() => setFluxPackExportPath(null)}
        onConfirm={(options) => void confirmFluxPackExport(options)}
        outputPath={fluxPackExportPath}
      />
    ) : null;

  const renderFluxPackInstallConflictDialog = () =>
    fluxPackInstallConflict ? (
      <FluxPackInstallConflictDialog
        buildName={fluxPackInstallConflict.summary.buildName}
        onCancel={() => setFluxPackInstallConflict(null)}
        onCreateNew={() => {
          const pending = fluxPackInstallConflict;
          setFluxPackInstallConflict(null);
          void runFluxPackInstall(pending.fluxPackPath, pending.summary, null);
        }}
        onUpdateExisting={() => {
          const pending = fluxPackInstallConflict;
          setFluxPackInstallConflict(null);
          void runFluxPackInstall(pending.fluxPackPath, pending.summary, pending.project);
        }}
      />
    ) : null;

  const renderFluxPackManualDownloadsDialog = () =>
    fluxPackManualDownload ? (
      <FluxPackManualDownloadsDialog
        buildName={fluxPackManualDownload.execution.summary.buildName}
        onCancel={() => setFluxPackManualDownload(null)}
        onDownload={(source) => void openFluxPackManualDownload(source)}
        onInstall={() => void confirmFluxPackManualInstall()}
        onPickArchive={(source) => void pickFluxPackManualArchive(source)}
        selectedArchives={fluxPackManualDownload.selectedArchives}
        sources={fluxPackManualDownload.sources}
      />
    ) : null;

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
                onClick={() =>
                  void loadDownloadsWorkspace(selectedProject, {
                    showLoading: false
                  })
                }
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
          {downloadsBusyLabel && downloadsWorkspace.loadState !== 'loading' ? (
            <div className="mod-busy-strip" role="status">
              <RefreshCw size={15} aria-hidden="true" />
              <span>{downloadsBusyLabel}</span>
            </div>
          ) : null}
          {renderDownloadDropSurface(renderDownloadRows())}
        </section>
      </section>
    );
  };

  const renderProfileRows = () => {
    if (profilesWorkspace.loadState === 'loading' && profilesWorkspace.items.length === 0) {
      return (
        <div
          className="mod-table profile-table profile-table--loading"
          role="table"
          aria-label="Profiles"
          aria-busy="true"
        >
          <div className="mod-row profile-row mod-row--head" role="row">
            <span role="columnheader">Profile</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">State</span>
            <span role="columnheader">Actions</span>
          </div>
          <div className="mod-table__body" role="rowgroup">
            {modLoadingSkeletonRows.slice(0, 4).map((index) => (
              <div
                className="mod-row profile-row profile-row--skeleton"
                role="row"
                aria-hidden="true"
                key={`profile-skeleton-${index}`}
              >
                <div className="mod-row__main" role="cell">
                  <span
                    className="workspace-skeleton workspace-skeleton--title"
                    style={{ width: skeletonWidth(index) }}
                  />
                  <span
                    className="workspace-skeleton workspace-skeleton--meta"
                    style={{ width: skeletonWidth(index, 1) }}
                  />
                </div>
                <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
                <span className="workspace-skeleton workspace-skeleton--status" role="cell" />
                <span className="workspace-skeleton workspace-skeleton--action" role="cell" />
              </div>
            ))}
          </div>
        </div>
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
    if (executablesWorkspace.loadState === 'loading' && executablesWorkspace.items.length === 0) {
      return (
        <div
          className="mod-table executable-table executable-table--loading"
          role="table"
          aria-label="Executables"
          aria-busy="true"
        >
          <div className="mod-row executable-row mod-row--head" role="row">
            <span role="columnheader">Executable</span>
            <span role="columnheader">Path</span>
            <span role="columnheader">Arguments</span>
            <span role="columnheader">Working directory</span>
            <span role="columnheader">Actions</span>
          </div>
          <div className="mod-table__body" role="rowgroup">
            {modLoadingSkeletonRows.slice(0, 4).map((index) => (
              <div
                className="mod-row executable-row executable-row--skeleton"
                role="row"
                aria-hidden="true"
                key={`executable-skeleton-${index}`}
              >
                <div className="mod-row__main" role="cell">
                  <span
                    className="workspace-skeleton workspace-skeleton--title"
                    style={{ width: skeletonWidth(index) }}
                  />
                  <span
                    className="workspace-skeleton workspace-skeleton--meta"
                    style={{ width: skeletonWidth(index, 2) }}
                  />
                </div>
                <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
                <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
                <span className="workspace-skeleton workspace-skeleton--cell" role="cell" />
                <span className="workspace-skeleton workspace-skeleton--action" role="cell" />
              </div>
            ))}
          </div>
        </div>
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
      onClose={() => void closeBuildPathSettings()}
      onSave={() => void saveBuildPathSettings()}
    />
  );
  const renderBuildSettingsWorkspace = () => (
    <BuildSettingsWorkspace
      busyLabel={buildPathsBusyLabel}
      draft={buildPathDraft}
      error={buildPathsError}
      projectName={selectedProject?.name ?? (buildSettingsInitialName || 'Build')}
      onBrowseDirectory={(title, field) => void browseBuildPathDirectory(title, field)}
      onBrowseGameExecutable={() => void browseBuildGameExecutable()}
      onChange={updateBuildPathDraft}
      onClose={() => void closeBuildPathSettings()}
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
              {fluxPackInstallResult.updatedExistingProject
                ? fluxPackInstallResult.hasWarnings
                  ? 'Delta-обновление завершено с предупреждениями'
                  : 'Delta-обновление завершено'
                : fluxPackInstallResult.hasWarnings
                  ? 'Установка завершена с предупреждениями'
                  : 'Установка завершена'}
            </strong>
            <span>
              {fluxPackInstallResult.updatedExistingProject
                ? `Переиспользовано: ${fluxPackInstallResult.reusedSourceCount} мод., ${fluxPackInstallResult.reusedDownloadCount} архив., ${fluxPackInstallResult.reusedFileCount} файл. Заменено файлов: ${fluxPackInstallResult.materializedFileCount}.`
                : `Установлено источников: ${fluxPackInstallResult.installedSourceCount}. Применено конфигураций: ${fluxPackInstallResult.appliedConfigCount}.`}
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderGrassCacheConfirmation = () => {
    if (!grassCacheConfirmationOpen || !selectedProject) {
      return null;
    }

    const outputName = `${selectedProject.name} · Grass Cache`;
    return (
      <div
        className="grass-cache-confirmation"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setGrassCacheConfirmationOpen(false);
          }
        }}
      >
        <section
          aria-labelledby="grass-cache-confirmation-title"
          aria-modal="true"
          className="grass-cache-dialog"
          role="dialog"
        >
          <div className="grass-cache-dialog__copy">
            <span>NGIO</span>
            <h2 id="grass-cache-confirmation-title">Генерация кэша травы</h2>
            <p>Сейчас начнётся генерация кэша травы для No Grass In Objects.</p>
            <strong>{outputName}</strong>
          </div>
          <div className="grass-cache-dialog__actions">
            <Button
              onClick={() => setGrassCacheConfirmationOpen(false)}
              size="sm"
              variant="secondary"
            >
              Отмена
            </Button>
            <Button onClick={() => void generateNgioGrassCache()} size="sm">
              Начать
            </Button>
          </div>
        </section>
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
      state={launchSplash?.state ?? 'starting'}
      subtitle={launchSplash?.subtitle}
      title={launchSplash?.title}
    />
  );

  const renderOpeningBuildSplash = () => (
    <LoadingSplash
      buildName={openingBuildSplash?.buildName}
      cancelLabel="Отмена"
      cancelTitle="Отменить открытие сборки"
      detail="Opening build progress"
      messages={openingBuildMessages}
      onCancel={() => cancelOpeningBuild()}
      open={Boolean(openingBuildSplash)}
      progress={openingBuildSplash?.progress ?? 0}
      subtitle={openingBuildSplash?.buildName}
    />
  );

  const renderOverwriteClearSplash = () => (
    <LoadingSplash
      aria-label="Очистка override"
      buildName={overwriteClearSplash?.buildName}
      detail="Прогресс очистки override"
      messages={overwriteClearMessages}
      open={Boolean(overwriteClearSplash)}
      progress={overwriteClearSplash?.progress ?? 0}
      subtitle={overwriteClearSplash?.buildName}
      title="Очистка override"
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
        onBrowseSource={() => browseTransferSource()}
      onSelectDestinationDrive={(drive) => void selectTransferDestinationDrive(drive)}
      onRefreshDrives={() => void loadTransferDestinationDrives()}
      onAnalyze={() => analyzeMo2Transfer()}
      onStart={() => void startMo2Transfer()}
      onCancel={() => void cancelMo2Transfer()}
      onClose={() => {
        setIsTransferPageOpen(false);
        changeRoute('home');
      }}
    />
  );

  const exportAiDataSnapshot = async () => {
    const defaultPath = `fluxora-ai-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    const picked = await window.fluxora.dialogs.saveTextFile(defaultPath, 'Export AI data snapshot');
    if (picked.canceled || !picked.path) {
      return;
    }

    const operationId = createRendererOperationId('ai_data_export');
    const snapshot = createAiSupportBundleSnapshot([aiChat.session], {
      includeRawPrompts: false,
      now: new Date()
    });

    setSettingsBusyLabel('Exporting AI data');
    try {
      await window.fluxora.textFiles.save(picked.path, JSON.stringify(snapshot, null, 2), {
        operationId
      });
      setMessage('AI data snapshot exported.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSettingsBusyLabel(null);
    }
  };

  const clearAiLocalData = () => {
    if (!window.confirm('Clear local AI chat data for this build?')) {
      return;
    }

    activeAiRunRef.current?.handle?.dispose();
    activeAiRunRef.current = null;
    window.localStorage.removeItem(aiSessionStorageKey(aiChat.session.scopeKey));
    window.localStorage.removeItem(aiAutonomousJobQueueStorageKey(aiChat.session.scopeKey));
    dispatchAiChat({
      type: 'restore-session',
      session: createAiSessionForScope(aiSessionScope)
    });
    setMessage('Local AI chat data cleared.');
  };

  const connectAiProvider = async (providerId: string) => {
    const provider = aiHostStatus?.providers.find((candidate) => candidate.id === providerId);
    if (!provider || !provider.requiresCredential || provider.connected) {
      return;
    }

    const apiKey = window.prompt(`Enter API key for ${provider.displayName}`);
    const secret = apiKey?.trim();
    if (!secret) {
      return;
    }

    setSettingsBusyLabel(`Connecting ${provider.displayName}`);
    try {
      const operationId = createRendererOperationId('ai_provider_connect');
      const result = await window.fluxora.ai.connectProvider(provider.id, secret, {
        operationId
      });
      if (!result.connected) {
        setMessage(result.message);
        return;
      }

      const refreshed = await window.fluxora.ai.getStatus({
        operationId: createRendererOperationId('ai_status')
      });
      setAiHostStatus(refreshed);
      setAiChatSettings((current) =>
        normalizeAiChatSettings(
          {
            ...current,
            modelId: provider.defaultModelId,
            routingPreset: 'byok'
          },
          refreshed
        )
      );
      setMessage(`${provider.displayName} connected.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSettingsBusyLabel(null);
    }
  };

  const disconnectAiProvider = async (providerId: string) => {
    const provider = aiHostStatus?.providers.find((candidate) => candidate.id === providerId);
    if (!provider || !provider.requiresCredential) {
      return;
    }

    if (!window.confirm(`Disconnect ${provider.displayName}?`)) {
      return;
    }

    setSettingsBusyLabel(`Disconnecting ${provider.displayName}`);
    try {
      const operationId = createRendererOperationId('ai_provider_disconnect');
      await window.fluxora.ai.disconnectProvider(provider.id, { operationId });
      const refreshed = await window.fluxora.ai.getStatus({
        operationId: createRendererOperationId('ai_status')
      });
      setAiHostStatus(refreshed);
      setMessage(`${provider.displayName} disconnected.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSettingsBusyLabel(null);
    }
  };

  const setDeveloperMode = (enabled: boolean) => {
    setDeveloperModeEnabled(enabled);
    saveDeveloperModeSetting(window.localStorage, enabled);
  };

  const openOriginalRepository = () => {
    void window.fluxora.links.openExternal(fluxoraOriginalRepositoryUrl);
  };

  const renderSettingsWorkspace = () => (
    <SettingsWorkspace
      apiLimitProviders={apiLimitProviders}
      apiLimitsBusy={apiLimitsBusy}
      appInfo={appInfo}
      bridgeStatus={bridgeStatus}
      developerModeEnabled={developerModeEnabled}
      isTransferRunning={isTransferRunning}
      languageBusy={languageBusy}
      lastBuildDate={rendererBuildDate}
      nexusBusy={nexusBusy}
      nexusStatus={nexusStatus}
      onDeveloperModeChange={setDeveloperMode}
      onOpenRepository={openOriginalRepository}
      section={settingsSection}
      settingsBusyLabel={settingsBusyLabel}
      settingsCapabilities={settingsCapabilities}
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

    const activeRightPaneTabIndex = rightPaneTabs.findIndex((tab) => tab.id === activeRightPane);

    return (
      <section className="build-page" aria-label="Selected build">
        <BuildDetailHeader
          buildCapabilities={buildHeaderCapabilities}
          executables={executablesWorkspace.items}
          executablesBusyLabel={executablesBusyLabel}
          grassCacheAvailable={grassCacheAction.available}
          grassCacheReason={grassCacheAction.reason}
          grassCacheVisible={grassCacheAction.visible}
          isOperationRunning={Boolean(operationOverlay?.isRunning)}
          language={bridgeStatus?.language}
          launchAvailable={executableCapabilities.launchAvailable}
          launchReason={executableCapabilities.launchReason}
          onBack={() => changeRoute('home')}
          onExecutableChange={(id) =>
            dispatchExecutablesWorkspace({ type: 'selected', id })
          }
          onLaunch={() => void launchExecutable()}
          onProfileChange={(profileName) => {
            dispatchProfilesWorkspace({ type: 'selected', name: profileName });
            setProfileDraftName(profileName);
            setProfileDeleteArmedName(null);
          }}
          onGenerateGrassCache={() => requestGrassCacheGeneration()}
          onSettings={() => void openBuildPathSettings()}
          profileOptions={buildProfileOptions}
          profilesBusyLabel={profilesBusyLabel}
          project={selectedProject}
          selectedExecutable={selectedExecutableItem}
          selectedProfileName={selectedProjectProfileName}
          settingsBusyLabel={buildPathsBusyLabel}
        />

        <section className="build-workbench" aria-label="Mod Organizer style workspace">
          <section
            className="build-pane build-pane--mods"
            aria-label="Mods"
            data-download-install-active={Boolean(draggedDownloadInstallId)}
            onDragOver={handleModInstallSurfaceDragOver}
            onDrop={(event) => void handleModInstallSurfaceDrop(event)}
          >
            <header className="build-pane__header build-pane__header--mods">
              <div>
                <h3>Моды</h3>
                <span>
                  {enabledModCount} of {totalModCount} enabled · {filteredModItems.length} visible
                </span>
              </div>
            </header>
            <div className="mods-pane-toolbar">
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
              <button
                className="pane-menu-trigger"
                type="button"
                data-row-context-menu-trigger="true"
                aria-haspopup="menu"
                aria-expanded={Boolean(modsToolbarMenuPosition)}
                aria-label="Действия со сборкой"
                title="Действия со сборкой"
                onClick={(event) => {
                  event.stopPropagation();
                  if (modsToolbarMenuPosition) {
                    setModsToolbarMenuPosition(null);
                    return;
                  }

                  setModMenuOrderId(null);
                  setModsToolbarMenuPosition(
                    rowContextMenuPositionFromAnchor(
                      event.currentTarget.getBoundingClientRect()
                    )
                  );
                }}
              >
                <MoreHorizontal size={15} aria-hidden="true" />
              </button>
              {renderModsToolbarMenu()}
            </div>
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
              <div
                className="right-pane-tabs"
                role="tablist"
                aria-label="Right pane tabs"
                data-active-index={activeRightPaneTabIndex}
              >
                {rightPaneTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeRightPane === id}
                    data-active={activeRightPane === id}
                    key={id}
                    onClick={() => activateRightPane(id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
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

  const logAiRuntimeEntry = (entry: AiRuntimeLogEntry) => {
    void window.fluxora.ui.log({
      level: entry.level,
      category: entry.category,
      message: `channel=${entry.channel} ${entry.message}`,
      operationId: entry.operationId
    });
  };

  const currentAiBuildOperationHints = (): AiBuildOperationHint[] =>
    [
      openingBuildSplash
        ? {
            label: 'opening-build',
            operationId: openingBuildSplash.operationId,
            state: 'running'
          }
        : null,
      overwriteClearSplash
        ? {
            label: 'overwrite-clear',
            operationId: overwriteClearSplash.operationId,
            state: overwriteClearSplash.progress >= 100 ? 'completed' : 'running'
          }
        : null,
      transferRunningOperationId
        ? {
            label: 'mo2-transfer',
            operationId: transferRunningOperationId,
            state: 'running'
          }
        : null
    ].filter((hint): hint is AiBuildOperationHint => Boolean(hint));
  const aiChatProviderDiagnostic = aiProviderDiagnostic(aiChatSettings, aiHostStatus);

  const finishAiRunAsStopped = (run: Pick<AiRun, 'id' | 'operationId'>) => {
    const event = createAiStreamEvent(run, 'run-cancelled', { status: 'stopped' });
    dispatchAiChat({
      type: 'cancel-run',
      message: createAiMessage('assistant', 'Остановлено', new Date(), run.id, {
        agentStatus: 'stopped'
      }),
      event
    });
  };

  const finishAiRunAsBlocked = (run: Pick<AiRun, 'id' | 'operationId'>, error: unknown) => {
    const messageText = `AI host blocked the response before it started: ${errorMessage(error)}`;
    const event = createAiStreamEvent(run, 'run-finished', { status: 'blocked' });
    dispatchAiChat({
      type: 'append-assistant-message',
      message: createAiMessage('assistant', messageText, new Date(), run.id, {
        agentStatus: 'blocked'
      }),
      event,
      status: 'blocked'
    });
  };

  const requestNativeAiRunCancel = (operationId: string) => {
    void window.fluxora.ai
      .cancelRun(operationId, {
        operationId: createRendererOperationId('ai_cancel_run')
      })
      .catch((error) => {
        logAiRuntimeEntry({
          category: 'ai-chat',
          channel: 'tauri-bridge',
          level: 'warning',
          message:
            error instanceof Error && error.message
              ? `AI host cancel request failed: ${error.message}`
              : 'AI host cancel request failed.',
          operationId
        });
      });
  };

  const openAiSubagentChat = (subagent: AiSubagentChatMetadata) => {
    dispatchAiChat({ type: 'open-subagent-chat', subagent });
  };

  const sendAiChatMessageAsync = async () => {
    const prompt = aiChat.draft.trim();
    if (!prompt || aiChat.isRunning || !aiHostStatus?.ready || aiChatProviderDiagnostic?.level === 'error') {
      return;
    }

    activeAiRunRef.current?.handle?.dispose();
    activeAiRunRef.current = null;
    const operationId = createRendererOperationId('ai_chat_run');
    const requestSession = aiChat.session;
    const run = createAiRunForPrompt(requestSession, operationId, prompt);
    const runControl: ActiveAiRunControl = {
      cancelled: false,
      handle: null,
      operationId,
      runId: run.id
    };
    activeAiRunRef.current = runControl;
    const runCreatedEvent = createAiStreamEvent(run, 'run-created', { status: 'thinking' });
    dispatchAiChat({
      type: 'submit-user-message',
      message: createAiMessage('user', prompt, new Date(), run.id),
      run,
      event: runCreatedEvent
    });
    dispatchAiChat({
      type: 'set-context-estimate',
      runId: run.id,
      estimateState: 'counting'
    });

    const providerId = providerForModel(
      aiChatSettings.modelId,
      aiHostStatus.models,
      aiHostStatus.providers
    )?.id;
    const modelSupportsBackground =
      aiHostStatus.models.find((model) => model.id === aiChatSettings.modelId)
        ?.supportsBackground === true;

    try {
      const buildContextSnapshot = await collectAiBuildContext(
        window.fluxora,
        {
          activeOperationHints: currentAiBuildOperationHints(),
          bridgeStatus,
          defaultProfileName: selectedProjectDefaultProfileName,
          profileName: selectedProjectProfileName,
          prompt,
          project: selectedProject,
          selectedModId: selectedModItem?.isMod ? selectedModItem.id : null,
          selectedModName: selectedModItem?.isMod ? selectedModItem.name : null
        },
        operationId
      );
      if (activeAiRunRef.current !== runControl || runControl.cancelled) {
        return;
      }

      const runSettings = {
        ...aiChatSettings,
        buildContextSnapshot,
        jobStorage: window.localStorage,
        modelSupportsBackground,
        providerId
      };
      const chatRequest = createAiHostChatRequest(run, requestSession, prompt, runSettings);

      const estimateAiContextUsage = async () => {
        try {
          const contextUsage = await window.fluxora.ai.estimateContext(chatRequest);
          if (activeAiRunRef.current !== runControl || runControl.cancelled) {
            return;
          }
          dispatchAiChat({
            type: 'set-context-estimate',
            runId: run.id,
            estimateState: 'ready',
            contextUsage
          });
        } catch (error) {
          if (activeAiRunRef.current !== runControl || runControl.cancelled) {
            return;
          }
          dispatchAiChat({
            type: 'set-context-estimate',
            runId: run.id,
            estimateState: 'error',
            contextUsage: null
          });
          logAiRuntimeEntry({
            category: 'ai-chat',
            channel: 'tauri-bridge',
            level: 'warning',
            message:
              error instanceof Error && error.message
                ? `Context estimate failed: ${error.message}`
                : 'Context estimate failed.',
            operationId
          });
        }
      };

      if (activeAiRunRef.current !== runControl || runControl.cancelled) {
        return;
      }

      runControl.handle = startHostAiRun(
        run,
        requestSession,
        prompt,
        window.fluxora.ai,
        {
          ...runSettings,
          preparedRequest: chatRequest
        },
        {
          onEvent: (event) => dispatchAiChat({ type: 'apply-stream-event', event }),
          onRunEvent: (event) => dispatchAiChat({ type: 'apply-run-event', event }),
          onFinish: (message, event, status, ledgerEntry) => {
            if (activeAiRunRef.current === runControl) {
              activeAiRunRef.current = null;
            }
            if (runControl.cancelled && event.type !== 'run-cancelled') {
              return;
            }
            if (event.type === 'run-cancelled') {
              dispatchAiChat({ type: 'cancel-run', message, event });
              return;
            }

            dispatchAiChat({
              type: 'append-assistant-message',
              message,
              event,
              status,
              ledgerEntry
            });
          },
          onLog: logAiRuntimeEntry
        }
      );
      if (runControl.cancelled) {
        runControl.handle.cancel();
        return;
      }
      void estimateAiContextUsage();
    } catch (error) {
      if (activeAiRunRef.current !== runControl || runControl.cancelled) {
        return;
      }

      activeAiRunRef.current = null;
      finishAiRunAsBlocked(run, error);
      logAiRuntimeEntry({
        category: 'ai-chat',
        channel: 'tauri-bridge',
        level: 'error',
        message:
          error instanceof Error && error.message
            ? `AI chat preflight failed: ${error.message}`
            : 'AI chat preflight failed.',
        operationId
      });
    }
  };

  const sendAiChatMessage = () => {
    void sendAiChatMessageAsync();
  };

  const cancelAiChatRun = () => {
    const runControl = activeAiRunRef.current;
    if (!runControl || runControl.cancelled) {
      return;
    }

    runControl.cancelled = true;
    requestNativeAiRunCancel(runControl.operationId);
    if (runControl.handle) {
      runControl.handle.cancel();
      return;
    }

    activeAiRunRef.current = null;
    finishAiRunAsStopped({
      id: runControl.runId,
      operationId: runControl.operationId
    });
  };

  const openAiSource = (url: string) => {
    const sourceUrl = safeAiSourceUrl(url);
    if (!sourceUrl) {
      setMessage('AI source link was blocked by the security policy.');
      return;
    }

    if (sourceUrl.startsWith(AI_CONTEXT_SOURCE_URL_PREFIX)) {
      const encodedSourceId = sourceUrl.slice(AI_CONTEXT_SOURCE_URL_PREFIX.length);
      const sourceId = (() => {
        try {
          return decodeURIComponent(encodedSourceId);
        } catch {
          return encodedSourceId;
        }
      })();
      setMessage(`AI context source: ${sourceId}. Trace and fingerprints are attached to the answer.`);
      return;
    }

    void window.fluxora.links.openExternal(sourceUrl);
  };

  const aiChatLayoutStyle = {
    '--ai-chat-width': `${aiChat.isCollapsed ? AI_CHAT_PANEL_COLLAPSED_WIDTH : aiChat.width}px`
  } as CSSProperties;

  const renderTitlebar = (showSettingsButton: boolean) => (
    <AppTitlebar
      aiActive={aiChat.isOpen}
      homeActive={activeRoute === 'home' && !isTransferPageOpen}
      mode={isSecondaryWindow ? 'settings' : 'main'}
      settingsActive={isSettingsWindow}
      showShortcuts={showSettingsButton}
      title={windowTitle}
      onClose={() => void closeWindow()}
      onHome={() => changeRoute('home')}
      onMinimize={() => void minimizeWindow()}
      onOpenSettings={() => void openSettingsWindow()}
      onRefresh={() => void refreshCurrentView()}
      onToggleAi={showSettingsButton ? () => dispatchAiChat({ type: 'toggle-open' }) : undefined}
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

  if (isBuildSettingsWindow) {
    return (
      <main className="desktop-shell desktop-shell--settings-window">
        {renderTitlebar(false)}
        <section className="settings-window">
          {renderBuildSettingsWorkspace()}
        </section>
      </main>
    );
  }

  if (isModDetailsWindow) {
    return (
      <main className="desktop-shell desktop-shell--settings-window desktop-shell--mod-details-window">
        {renderTitlebar(false)}
        {renderModDetailsWindow()}
      </main>
    );
  }

  if (isTextEditorWindow) {
    return (
      <main className="desktop-shell desktop-shell--settings-window desktop-shell--text-editor-window">
        {renderTitlebar(false)}
        <TextEditorWorkspace
          project={selectedProject}
          initialModPath={textEditorModId}
          initialRelativePath={textEditorInitialPath}
          initialFileName={textEditorInitialName}
        />
      </main>
    );
  }

  if (isFilePreviewWindow) {
    return (
      <main className="desktop-shell desktop-shell--settings-window desktop-shell--file-preview-window">
        {renderTitlebar(false)}
        <Suspense
          fallback={
            <section className="file-preview-window" aria-busy="true" aria-label="Loading file preview" />
          }
        >
          <FilePreviewWorkspace
            project={selectedProject}
            initialModPath={filePreviewModId}
            initialRelativePath={filePreviewInitialPath}
            initialFileName={filePreviewInitialName}
            initialProfileName={filePreviewProfileName}
            initialKind={filePreviewKind}
          />
        </Suspense>
      </main>
    );
  }

  return (
    <main className="desktop-shell">
      {renderTitlebar(true)}

      <section
        className="workspace-with-ai"
        data-ai-collapsed={aiChat.isCollapsed ? 'true' : undefined}
        data-ai-open={aiChat.isOpen ? 'true' : undefined}
        style={aiChatLayoutStyle}
      >
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
                {renderModCreationDialog()}
                {renderFluxPackExportDialog()}
                {renderFluxPackInstallConflictDialog()}
                {renderFluxPackManualDownloadsDialog()}
                {renderDeletionConfirmation()}
                {renderGrassCacheConfirmation()}
                {renderOperationOverlay()}
                {renderOverwriteClearSplash()}
                {renderOpeningBuildSplash()}
                {renderLaunchSplash()}
              </>
            )}
          </div>
        </section>

        {aiChat.isOpen ? (
          <AiChatPanel
            hostReady={aiHostStatus?.ready ?? false}
            providerDiagnostic={aiChatProviderDiagnostic}
            showCheckedSites={developerModeEnabled}
            showDeveloperDiagnostics={developerModeEnabled}
            state={aiChat}
            onCancel={cancelAiChatRun}
            onClose={() => dispatchAiChat({ type: 'close' })}
            onCloseChat={(chatId) => dispatchAiChat({ type: 'close-chat', chatId })}
            onCreateChat={() => dispatchAiChat({ type: 'create-chat' })}
            onDraftChange={(value) => dispatchAiChat({ type: 'set-draft', value })}
            onOpenSubagentChat={openAiSubagentChat}
            onOpenSource={openAiSource}
            onResize={(width) => dispatchAiChat({ type: 'set-width', width })}
            onSend={sendAiChatMessage}
            onSelectChat={(chatId) => dispatchAiChat({ type: 'select-chat', chatId })}
            onToggleCollapse={() => dispatchAiChat({ type: 'toggle-collapse' })}
          />
        ) : null}
      </section>
    </main>
  );
};
