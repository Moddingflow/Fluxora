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
} from './design-system/icons/lucide-compat';
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
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
import menuOpenExternalIcon from '../../../Icons/open.svg';
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
import {
  normalizeAppLocale,
  translateForLanguage,
  type TranslationKey
} from '../localization';
import {
  appLanguageReducer,
  initialAppLanguageState
} from '../localization/app-language-state';
import { LocalizationProvider, useLocalization } from '../localization/react';
import { useAppUpdate } from './features/update/use-app-update';
import {
  AdaptiveVirtualList,
  type AdaptiveVirtualListHandle
} from './components/virtualization/AdaptiveVirtualList';
import {
  installListPerformanceBenchmarkHarness,
  measureListPerformanceStage
} from './performance/list-performance-benchmark';
import { useSearchScrollRestoration } from './hooks/useSearchScrollRestoration';
import { Badge, Button, EmptyState, LoadingSplash, Skeleton, StatusDot } from './design-system';
import { PrimitivePreview } from './design-system/PrimitivePreview';
import {
  LibraryHome,
  type LibraryCatalogState
} from './features/library/LibraryHome';
import { CreateBuildWizard } from './features/library/CreateBuildWizard';
import { useCreateBuildWizard } from './features/library/useCreateBuildWizard';
import {
  buildProjectLibraryStats,
  type ProjectRuntimeSummary
} from './features/library/projectLibraryStats';
import {
  applyModUpdateCheckProgress,
  createModUpdateCheckSplashState,
  ModUpdateCheckSplash,
  type ModUpdateCheckSplashState
} from './features/mods/ModUpdateCheckSplash';
import { ModConflictScrollbar } from './features/mods/ModConflictScrollbar';
import { AiChatPanel } from './features/ai/AiChatPanel';
import { openModdingFlowRegistration } from './features/ai/ai-account-access';
import { resolveAiManagedFileLocation } from './features/ai/ai-managed-file-location';
import {
  aiMicrophonePermissionChangedEvent,
  aiMicrophonePermissionStorageKey,
  hasAiMicrophonePermission,
  resetAiMicrophonePermission
} from './features/ai/ai-microphone-permission';
import {
  aiChatReducer,
  createAiMessage,
  createAiStreamEvent,
  initialAiChatState,
  type AiRun
} from './features/ai/ai-chat-state';
import {
  createAiHostChatRequest,
  createAiRunForPrompt,
  loadAiSession,
  saveAiSession,
  startHostAiRun,
  type AiLocalRunHandle,
  type AiRuntimeLogEntry
} from './features/ai/ai-chat-runtime';
import {
  aiProviderDiagnostic,
  loadAiChatSettings,
  type AiChatSettings
} from './features/ai/ai-chat-settings';
import {
  AI_CONTEXT_SOURCE_URL_PREFIX,
  safeAiSourceUrl
} from './features/ai/ai-chat-security';
import { BuildPathsInspector } from './features/build/BuildPathsInspector';
import { BuildSettingsWorkspace } from './features/build/BuildSettingsWorkspace';
import { BuildDetailHeader } from './features/build/BuildDetailHeader';
import { watchLaunchProcessSession } from './features/executables/launch-process-session';
import { managedExecutableDisplay } from './features/executables/managed-executable-display';
import {
  BUILD_RENAME_NAME_MAX_LENGTH,
  BuildRenameDialog,
  buildRenameDialogCopy,
  type BuildRenameDialogState
} from './features/library/BuildRenameDialog';
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
import { DownloadDuplicateDecisionDialog } from './features/downloads/DownloadDuplicateDecisionDialog';
import { taskbarDownloadProgress } from './features/downloads/taskbar-download-progress';
import {
  buildModRowViewIndex,
  buildPluginRowViewIndex,
  modOrderItemPresentationKey,
  modRowViewPresentationKey,
  pluginOrderItemPresentationKey,
  pluginRowViewPresentationKey,
  type ModRowViewIndex,
  type PluginRowViewIndex
} from './features/lists/order-row-view-index';
import { MissingMastersStatus } from './features/plugins/MissingMastersStatus';
import { ModdingFlowActivationConfirmationHost } from './features/moddingflow/ModdingFlowActivationConfirmationHost';
import { PluginRow, PluginsListSurface } from './features/plugins/PluginsListSurface';
import {
  PluginSeparatorDialog,
  PLUGIN_SEPARATOR_NAME_MAX_LENGTH,
  pluginSeparatorCopy,
  type PluginSeparatorDialogState
} from './features/plugins/PluginSeparatorDialog';
import { createPluginSeparatorForSelection } from './features/plugins/plugin-separator-service';
import {
  InstallDialog,
  type InstallDialogState
} from './features/install/InstallDialog';
import {
  downloadArchiveSuffix,
  downloadRenameBaseName,
  ItemRenameDialog,
  itemRenameDialogCopy,
  type ItemRenameDialogState
} from './features/rename/ItemRenameDialog';
import { applyInstallNameSuggestion } from './features/install/install-name-state';
import {
  attachBackgroundInstallPlan,
  attachInstallPlanForDisplay,
  installPlanNeedsUserNameReplan,
  matchedInstallTargetForCurrentName
} from './features/install/install-plan-state';
import {
  MOD_CREATION_NAME_MAX_LENGTH,
  ModCreationDialog,
  type ModCreationDialogKind,
  type ModCreationDialogState
} from './features/mods/ModCreationDialog';
import { ModInstallProgressLabel } from './features/mods/ModInstallProgressLabel';
import { ModRow, ModsListSurface } from './features/mods/ModsListSurface';
import { createModSeparatorAtEnd } from './features/mods/mod-separator-service';
import {
  createModDetailsContentCache,
  modDetailsContentCacheKey,
  modDetailsContentFileTree
} from './features/mods/mod-details-content';
import { downloadInstallDropPlacementFromPointer } from './features/mods/download-install-drop-state';
import { resolveModSourcePageUrl } from './features/mods/mod-source-url';
import {
  pendingInstallConflictMarkerReady,
  pendingInstallTargetIndexForPlacement,
  type PendingInstallDropPlacement
} from './features/mods/pending-install-orchestrator-state';
import { shouldAcceptInstallOperation } from './features/mods/install-progress-store';
import { usePostInstallModReveal } from './features/mods/use-post-install-mod-reveal';
import {
  restoredInstallNeedsPendingProjection,
  usePendingInstallOrchestrator
} from './features/mods/use-pending-install-orchestrator';
import {
  OperationOverlay,
  type OperationOverlayState
} from './features/operations/OperationOverlay';
import { SettingsWorkspace } from './features/settings/SettingsWorkspace';
import { isTextEditorFileName } from './features/text-editor/text-editor-model';
import { previewKindForFile } from './features/file-preview/preview-kind-registry';
import { filterProjects } from './project-catalog-state';
import {
  cleanupCreatedProject,
  createProjectFromDraft,
  deleteProjectConfig,
  loadProjectCatalog,
  mergeProjectIntoCatalog,
  openProjectConfig,
  projectCatalogFallback,
  replaceRenamedProject,
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
  modConflictMarkerStatesForHighlight,
  modItemTitle,
  modLatestVersionDiffers,
  modLatestVersionText,
  modOverwriteView,
  modOrderItemMovePlan,
  modOrderItemMatchesLookup,
  modStatusText,
  modTableStatusView,
  modVersionText,
  modWorkspaceReducer,
  reorderModOrderItemSelection,
  reorderModOrderItems,
  removeModOrderItems,
  selectedModOrderItem,
  targetIndexForDrop,
  visibleModOrderItems,
  type ModConflictHighlight,
  type ModConflictMarkerState
} from './mod-workspace-state';
import {
  loadCollapsedSeparatorOrderIds,
  saveCollapsedSeparatorOrderIds
} from './separator-collapse-persistence';
import {
  deleteSeparatorSelection,
  separatorDeletionOrderIds
} from './order-separator-deletion-service';
import {
  assessPluginOrderItemSelectionReorder,
  canDragPluginOrderItem,
  emptyPluginWorkspaceState,
  enabledPluginNameKeys,
  isSkyrimMissingMasterStatusProject,
  mergePendingPluginEnabledStates,
  pluginCapabilityView,
  pluginHexIndex,
  pluginItemTitle,
  pluginMissingMasterSummary,
  pluginOrderItemMovePlan,
  pluginSourceLabel,
  pluginSourceModKey,
  pluginStatusText,
  pluginTypeLabel,
  pluginWorkspaceReducer,
  reorderPluginOrderItemSelection,
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
  queuedDownloadDuplicateDecisions,
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
  fluxoraOriginalRepositoryUrl,
  loadDeveloperModeSetting,
  saveDeveloperModeSetting,
  settingsCapabilityView,
  type SettingsSectionId
} from './settings-workspace-state';
import {
  connectionCanToggle,
  connectionIsReady,
  loadCachedConnectionSnapshot,
  mergeConnectionStatus,
  providerFromSnapshot,
  saveCachedConnectionSnapshot
} from './connection-workspace-state';
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
  currentFomodStepValidation,
  defaultInstallModName,
  evaluateFomodWizard,
  fileNameFromPath,
  initialFomodSelection,
  normalizeInstallModName,
  sanitizeFomodManualDecisions,
  validateInstallModName,
  type InstallModOrderPlacement,
  type InstallSource,
  type PlacementOverrideMap
} from './install-workspace-state';
import { defaultModNameFromPath, shortPath } from './services/path-display-service';
import {
  createProjectOpenTiming,
  formatProjectOpenBackgroundPerformanceMessage,
  formatProjectOpenPerformanceMessage,
  type ProjectOpenTiming
} from './services/project-open-performance';
import { createRendererOperationId, errorMessage } from './services/renderer-operation-service';
import {
  applyModUpdateResultToInstalledMods,
  applyModUpdateResultToOrderItems,
  createModUpdateCoordinator
} from './services/mod-update-coordinator';
import {
  createExternalConnectionCoordinator,
  type ExternalConnectionCoordinator
} from './services/external-connection-coordinator';
import {
  modUpdateFreshnessView,
  modUpdateProjectKey,
  modUpdateTransientMessage,
  rememberModUpdateResult,
  type ModUpdateResultsByProject
} from './services/mod-update-status';
import { installRendererRefreshShortcut } from './services/renderer-refresh-shortcut-service';
import { createWorkspaceOrderMutationGate } from './services/workspace-order-mutation-gate';
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
import {
  applyWorkspaceDelta,
  type WorkspaceDeltaState
} from './services/workspace-delta-state';
import type {
  FluxoraAppInfo,
  FluxoraAiHostStatus,
  FluxoraAiFileChange,
  FluxoraAiFileChangeSet,
  FluxoraApiLimitProvider,
  FluxoraExternalConnectionSnapshot,
  FluxoraContentLayoutPreview,
  FluxoraDownloadEntry,
  FluxoraDownloadsChangedEvent,
  FluxoraDownloadDuplicateChoice,
  FluxoraExecutable,
  FluxoraExecutableLaunchResult,
  FluxoraExistingModInstallMode,
  FluxoraFileDropEvent,
  FluxoraFomodInstaller,
  FluxoraInstallPlan,
  FluxoraFluxPackInstallResult,
  FluxoraFluxPackManualSourceArchive,
  FluxoraFluxPackPackageType,
  FluxoraFluxPackSourceInstallPlan,
  FluxoraFluxPackSummary,
  FluxoraGameTemplate,
  FluxoraInstalledMod,
  FluxoraInstalledModSummary,
  FluxoraInstallOperation,
  FluxoraPlacementEditsV2,
  FluxoraModOrganizerImportAnalysis,
  FluxoraModOrganizerImportProgress,
  FluxoraMo2TransferHandoff,
  FluxoraEffectiveFileTreePage,
  FluxoraEffectiveFileTreeEntry,
  FluxoraEffectiveFileTreeSnapshot,
  FluxoraModConflictTreePage,
  FluxoraModDetailsBootstrap,
  FluxoraModDetailsContent,
  FluxoraModFileTreeEntry,
  FluxoraModOrderItem,
  FluxoraNxmInboundLinksCaptured,
  FluxoraNxmProtocolResult,
  FluxoraPluginOrderItem,
  FluxoraProject,
  FluxoraSecurityState,
  FluxoraThemeMode,
  FluxoraTransferDriveOption,
  FluxoraWorkspaceDelta,
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

interface PendingWorkspaceFullResync {
  project: FluxoraProject;
  profileName: string;
  reason: string;
}

installListPerformanceBenchmarkHarness();

const listPresentationTokens = new WeakMap<object, number>();
let listPresentationTokenSequence = 0;
const listPresentationToken = (value: object | null | undefined): number => {
  if (!value) {
    return 0;
  }
  const existing = listPresentationTokens.get(value);
  if (existing !== undefined) {
    return existing;
  }
  listPresentationTokenSequence += 1;
  listPresentationTokens.set(value, listPresentationTokenSequence);
  return listPresentationTokenSequence;
};

const FilePreviewWorkspace = lazy(async () => {
  const module = await import('./features/file-preview/FilePreviewWorkspace');
  return { default: module.FilePreviewWorkspace };
});

const bodySlideLaunchErrorMessage = (error: unknown, language?: string | null): string => {
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
  const messages: Record<string, TranslationKey> = {
    BODYSLIDE_EXTERNAL_TOOL: 'bodyslide.error.externalTool',
    BODYSLIDE_X86_UNSUPPORTED: 'bodyslide.error.x86Unsupported',
    BODYSLIDE_PLATFORM_UNSUPPORTED: 'bodyslide.error.platformUnsupported',
    BODYSLIDE_RUNTIME_INVALID: 'bodyslide.error.runtimeInvalid',
    BODYSLIDE_GAME_UNSUPPORTED: 'bodyslide.error.gameUnsupported',
    BODYSLIDE_OUTPUT_CONFLICT: 'bodyslide.error.outputConflict',
    BODYSLIDE_SESSION_ACTIVE: 'bodyslide.error.sessionActive',
    BODYSLIDE_SESSION_NOT_FOUND: 'bodyslide.error.sessionNotFound',
    BODYSLIDE_VFS_UNAVAILABLE: 'bodyslide.error.vfsUnavailable',
    BODYSLIDE_CONFIGURATION_FAILED: 'bodyslide.error.configurationFailed'
  };
  const key = messages[code];
  return key ? translateForLanguage(language, key) : errorMessage(error);
};

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

const buildScopedAiRoutes = new Set<RouteId>([
  'build',
  'workspace',
  'mods',
  'plugins',
  'downloads',
  'profiles',
  'executables'
]);
const aiRollbackCheckpointResetMarker = 'fluxora.ai.rollback-checkpoints.v1';

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

interface BuildRenameDialogRequest extends BuildRenameDialogState {
  project: FluxoraProject;
}

interface ItemRenameDialogRequest extends ItemRenameDialogState {
  project: FluxoraProject;
  targetPath: string;
}

interface PluginSeparatorDialogRequest extends PluginSeparatorDialogState {
  contextOrderId: string;
  selectedOrderIds: string[];
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
type RowReorderKind = 'mod' | 'plugin' | 'download-install';
type RowDropPlacement = PendingInstallDropPlacement;
type OrderRowDropPlacement = Exclude<RowDropPlacement, 'inside'>;
type ModDetailsTabId = 'files' | 'conflicts';

interface EffectiveFileTreeRow {
  entry: FluxoraEffectiveFileTreeEntry;
  level: number;
}

interface RowDropTargetState {
  orderId: string;
  placement: RowDropPlacement;
  blockedReason?: string;
}

interface RowReorderSession {
  kind: RowReorderKind;
  pointerId: number;
  sourceOrderId: string;
  sourceOrderIds: string[];
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
  frameId: number | null;
  lastFrameTime: number | null;
  targetOrderId: string | null;
  placement: RowDropPlacement | null;
  blockedReason: string | null;
  scrollContainer: HTMLElement | null;
}

interface WorkspaceLoadOptions {
  coordinatedSequence?: number;
  forcePluginDiscoveryRefresh?: boolean;
  persistedSnapshot?: boolean;
  showBusy?: boolean;
  showLoading?: boolean;
  suppressError?: boolean;
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
  chatId: string;
  handle: AiLocalRunHandle | null;
  operationId: string;
  runId: string;
}

interface DeletionConfirmationRequest {
  description?: string;
  kind: DeletionConfirmationKind;
  itemName: string;
  itemCount?: number;
  onConfirm: () => Promise<void>;
}

type MenuIconStyle = CSSProperties & { '--menu-icon': string };
type AssetIconStyle = CSSProperties & { '--asset-icon': string };

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

const expandedParentsForRelativePath = (relativePath?: string): Record<string, boolean> => {
  const parts = (relativePath ?? '').replaceAll('\\', '/').split('/').filter(Boolean);
  const expanded: Record<string, boolean> = {};
  let current = '';
  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part;
    expanded[current] = true;
  }
  return expanded;
};

type ModDetailsBootstrapWindow = Window & {
  __FLUXORA_MOD_DETAILS_BOOTSTRAP__?: FluxoraModDetailsBootstrap;
};

let modDetailsBootstrapReadCache: FluxoraModDetailsBootstrap | null = null;

const writeModDetailsBootstrap = (bootstrap: FluxoraModDetailsBootstrap): void => {
  try {
    const storageFallback: FluxoraModDetailsBootstrap = { ...bootstrap, content: undefined };
    window.localStorage.setItem(
      modDetailsBootstrapStorageKey(bootstrap.key),
      JSON.stringify(storageFallback)
    );
  } catch {
    // Bootstrap is an optimization. The window can still load through the bridge.
  }
};

const readModDetailsBootstrap = (key: string): FluxoraModDetailsBootstrap | null => {
  if (!key) {
    return null;
  }

  if (modDetailsBootstrapReadCache?.key === key) {
    return modDetailsBootstrapReadCache;
  }

  const bootstrapWindow = window as ModDetailsBootstrapWindow;
  const injected = bootstrapWindow.__FLUXORA_MOD_DETAILS_BOOTSTRAP__;
  if (injected?.key === key) {
    modDetailsBootstrapReadCache = injected;
    delete bootstrapWindow.__FLUXORA_MOD_DETAILS_BOOTSTRAP__;
    return injected;
  }

  const storageKey = modDetailsBootstrapStorageKey(key);
  try {
    const raw = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<FluxoraModDetailsBootstrap>;
    modDetailsBootstrapReadCache =
      parsed && typeof parsed.key === 'string' && parsed.item
        ? (parsed as FluxoraModDetailsBootstrap)
        : null;
    return modDetailsBootstrapReadCache;
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

const effectiveFileTreeSourceLabel = (
  entry: FluxoraEffectiveFileTreeEntry,
  language?: string | null
): string => {
  if (entry.sourceKind === 'game') {
    return translateForLanguage(language, 'app.source.game');
  }
  if (entry.sourceKind === 'overwrite') {
    return translateForLanguage(language, 'app.source.overwrite');
  }
  if (entry.sourceKind === 'mod') {
    return entry.sourceName;
  }
  return '';
};

const effectiveVirtualPathLabel = (
  entry: FluxoraEffectiveFileTreeEntry,
  language?: string | null
): string => entry.virtualPath || entry.relativePath ||
  translateForLanguage(language, 'app.source.gameRoot');

const modConflictMarkerKeys: Record<ModConflictMarkerState, TranslationKey> = {
  overwrites: 'app.conflict.overwrites',
  overwritten: 'app.conflict.overwritten',
  'fully-overwritten': 'app.conflict.fullyOverwritten'
};

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
  const { t } = useLocalization();
  if (states.length === 0) {
    return null;
  }
  const markerTitle = states.map((state) => t(modConflictMarkerKeys[state])).join(' · ');

  return (
    <span
      aria-label={markerTitle}
      className={['mod-conflict-markers', className].filter(Boolean).join(' ')}
      role="group"
      title={markerTitle}
    >
      {states.map((state) => (
        <StatusDot
          className="mod-conflict-marker-dot"
          key={state}
          label={t(modConflictMarkerKeys[state])}
          size={18}
          state={state}
          title={t(modConflictMarkerKeys[state])}
        />
      ))}
    </span>
  );
}

const openingBuildMessageKeys: TranslationKey[] = [
  'app.opening.loadingBuild',
  'app.opening.plugins',
  'app.opening.profile',
  'app.opening.workspace',
  'app.opening.almostDone'
];

const overwriteClearMessageKeys: TranslationKey[] = [
  'app.overwriteClear.clearing',
  'app.overwriteClear.temporary',
  'app.overwriteClear.refreshing',
  'app.overwriteClear.almostDone'
];

const rendererBuildDate =
  typeof import.meta.env.VITE_FLUXORA_BUILD_DATE === 'string'
    ? import.meta.env.VITE_FLUXORA_BUILD_DATE
    : '';

const projectMatchesSelection = (project: FluxoraProject, selection: string): boolean =>
  project.id === selection ||
  project.configPath === selection ||
  project.projectDirectory === selection;

const modRowHeight = 48;
const pluginRowHeight = 48;
const modLoadingSkeletonRows = Array.from({ length: 10 }, (_, index) => index);
const pluginLoadingSkeletonRows = Array.from({ length: 10 }, (_, index) => index);
const effectiveFileTreeSkeletonRows = Array.from({ length: 14 }, (_, index) => index);
const loadingSkeletonWidths = ['72%', '58%', '66%', '48%', '62%'] as const;
const downloadRowHeight = 48;
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
const rowReorderAutoScrollFrameMs = 1000 / 60;
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
  const itemCount = 5 + (entry.isDownloading ? 1 : 0) + (entry.canResume ? 1 : 0);
  return rowContextMenuPaddingY + itemCount * rowContextMenuItemHeight;
};

const modRowMenuEstimatedHeight = (
  item: FluxoraModOrderItem,
  selectedOrderIds: ReadonlySet<string>
): number | undefined => {
  if (!isModOverwriteItem(item)) {
    return undefined;
  }

  const itemCount = selectedOrderIds.has(item.orderId) && selectedOrderIds.size > 1 ? 1 : 2;
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
): OrderRowDropPlacement => {
  const rect = row.getBoundingClientRect();
  return pointerY < rect.top + rect.height / 2 ? 'before' : 'after';
};

export const App = () => {
  const windowParameters = useMemo(() => new URLSearchParams(window.location.search), []);
  const windowMode = windowParameters.get('window');
  const isSettingsWindow = windowMode === 'settings';
  const isBuildSettingsWindow = windowMode === 'build-settings';
  const isModDetailsWindow = windowMode === 'mod-details';
  const isFilePreviewWindow = windowMode === 'file-preview';
  const isSecondaryWindow =
    isSettingsWindow ||
    isBuildSettingsWindow ||
    isModDetailsWindow ||
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
  const filePreviewProjectId = windowParameters.get('project');
  const filePreviewProjectDirectory = windowParameters.get('directory')?.trim() ?? '';
  const filePreviewModId = windowParameters.get('mod')?.trim() ?? '';
  const filePreviewInitialPath = windowParameters.get('path')?.trim() ?? '';
  const filePreviewInitialName = windowParameters.get('name')?.trim() ?? '';
  const filePreviewProfileName = windowParameters.get('profile')?.trim() ?? '';
  const filePreviewKind = windowParameters.get('kind')?.trim() ?? 'nif';
  const [activeRoute, setActiveRoute] = useState<RouteId>(() =>
    isSettingsWindow
      ? 'settings'
      : isModDetailsWindow || isFilePreviewWindow
        ? 'mods'
        : 'home'
  );
  const [appInfo, setAppInfo] = useState<FluxoraAppInfo | null>(null);
  const [securityState, setSecurityState] = useState<FluxoraSecurityState | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<NativeBridgeStatus | null>(null);
  const [appLanguage, dispatchAppLanguage] = useReducer(
    appLanguageReducer,
    initialAppLanguageState
  );
  const appLocale = normalizeAppLocale(appLanguage.language);
  const appUpdate = useAppUpdate({
    api: window.fluxora.updates,
    enabled:
      appLanguage.ready &&
      !isBuildSettingsWindow &&
      !isModDetailsWindow &&
      !isFilePreviewWindow,
    automaticChecks: appLanguage.ready && !isSecondaryWindow,
    acknowledgeRendererHealth: !isSecondaryWindow,
    language: appLocale,
    releaseSignals: appLanguage.ready && !isSecondaryWindow
  });
  const t = useCallback(
    (key: TranslationKey, variables?: Record<string, string | number>) =>
      translateForLanguage(appLocale, key, variables),
    [appLocale]
  );
  const navItems = useMemo<Array<{ id: RouteId; label: string; icon: typeof Home }>>(() => [
    { id: 'home', label: t('app.nav.home'), icon: Home },
    { id: 'build', label: t('app.nav.build'), icon: Layers }
  ], [t]);
  const modDetailsTabs = useMemo<Array<{ id: ModDetailsTabId; label: string; icon: string }>>(() => [
    { id: 'files', label: t('app.tab.files'), icon: modDetailsFilesIcon },
    { id: 'conflicts', label: t('app.tab.conflicts'), icon: modDetailsConflictsIcon }
  ], [t]);
  const rightPaneTabs = useMemo<Array<{ id: RightPaneId; label: string; icon: typeof Layers }>>(() => [
    { id: 'plugins', label: t('app.tab.plugins'), icon: Layers },
    { id: 'data', label: t('app.tab.data'), icon: FolderTree },
    { id: 'downloads', label: t('app.tab.downloads'), icon: Download }
  ], [t]);
  const openingBuildMessages = useMemo(
    () => openingBuildMessageKeys.map((key) => t(key)),
    [t]
  );
  const overwriteClearMessages = useMemo(
    () => overwriteClearMessageKeys.map((key) => t(key)),
    [t]
  );
  useLayoutEffect(() => {
    if (appLanguage.ready) {
      document.documentElement.lang = appLocale;
    }
  }, [appLanguage.ready, appLocale]);

  useEffect(() => window.fluxora.settings.onLanguageChanged((result) => {
    dispatchAppLanguage({ type: 'language-confirmed', language: result.language });
    setBridgeStatus((current) => current
      ? { ...current, language: result.language, operationId: result.operationId }
      : current);
  }), []);
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
  const [buildRenameDialog, setBuildRenameDialog] =
    useState<BuildRenameDialogRequest | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>('idle');
  const [searchText, setSearchText] = useState('');
  const [, setMessage] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [aiChat, dispatchAiChat] = useReducer(aiChatReducer, initialAiChatState);
  const [aiRollbackStoreReady, setAiRollbackStoreReady] = useState(
    () => window.localStorage.getItem(aiRollbackCheckpointResetMarker) === 'ready'
  );
  const [aiHostStatus, setAiHostStatus] = useState<FluxoraAiHostStatus | null>(null);
  const [aiChatSettings] = useState<AiChatSettings>(() =>
    loadAiChatSettings(window.localStorage)
  );
  const activeAiRunsRef = useRef<Map<string, ActiveAiRunControl>>(new Map());
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
  const pluginBuildContentRefreshCoordinator = useMemo(createTrailingRefreshCoordinator, []);
  const workspaceOrderMutationGate = useMemo(createWorkspaceOrderMutationGate, []);
  const pendingBuildContentModPaths = useMemo(createPendingPathAccumulator, []);
  const installCommitOperationsRef = useRef(new Set<string>());
  const deferredBuildContentRefreshRef = useRef<(() => Promise<void>) | null>(null);
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
  const [microphoneAllowed, setMicrophoneAllowed] = useState(() =>
    hasAiMicrophonePermission(window.localStorage)
  );
  const [microphonePermissionBusy, setMicrophonePermissionBusy] = useState(false);
  const [settingsBusyLabel, setSettingsBusyLabel] = useState<string | null>(null);
  const [connectionSnapshot, setConnectionSnapshot] = useState<FluxoraExternalConnectionSnapshot>(() =>
    loadCachedConnectionSnapshot(window.localStorage)
  );
  const [connectionBusyAction, setConnectionBusyAction] = useState<
    'connect' | 'cancel' | 'disconnect' | null
  >(null);
  const [connectionBusyProviderId, setConnectionBusyProviderId] = useState<string | null>(null);
  const connectionActionGenerationRef = useRef(0);
  const [apiLimitProviders, setApiLimitProviders] = useState<FluxoraApiLimitProvider[]>([]);
  const [apiLimitsBusy, setApiLimitsBusy] = useState(false);
  const connectionCoordinatorRef = useRef<ExternalConnectionCoordinator | null>(null);
  const connectionCoordinator = useMemo(
    () =>
      createExternalConnectionCoordinator({
        api: {
          listStatus: (request) => window.fluxora.connections.listStatus(request),
          restoreAll: (attempt, request) => window.fluxora.connections.restoreAll(attempt, request)
        },
        createOperationId: createRendererOperationId,
        language: () => document.documentElement.lang,
        initialSnapshot: connectionSnapshot,
        onSnapshot: (snapshot) => {
          setConnectionSnapshot(snapshot);
          saveCachedConnectionSnapshot(window.localStorage, snapshot);
        }
      }),
    []
  );
  connectionCoordinatorRef.current = connectionCoordinator;
  useEffect(() => {
    const refreshMicrophonePermission = () => {
      setMicrophoneAllowed(hasAiMicrophonePermission(window.localStorage));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === aiMicrophonePermissionStorageKey) {
        refreshMicrophonePermission();
      }
    };
    window.addEventListener('focus', refreshMicrophonePermission);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(aiMicrophonePermissionChangedEvent, refreshMicrophonePermission);
    return () => {
      window.removeEventListener('focus', refreshMicrophonePermission);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(aiMicrophonePermissionChangedEvent, refreshMicrophonePermission);
    };
  }, []);
  const nexusConnection = providerFromSnapshot(connectionSnapshot, 'nexus');
  const nexusConnectionReady = connectionIsReady(nexusConnection);
  const nxmAutoRegistrationAttemptedRef = useRef(false);
  const pendingInboundNxmEventRef = useRef<FluxoraNxmInboundLinksCaptured | null>(null);
  const inboundNxmReadinessRef = useRef({
    bridgeReady: false,
    downloadBridgeAvailable: false
  });
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
  const chromePlatform = appInfo?.platform ?? bridgeStatus?.capabilities?.platform ?? 'unknown';
  const createWizard = useCreateBuildWizard({
    bridgeReady: Boolean(bridgeStatus?.ready),
    defaultInstallRootDirectory: catalog.defaultInstallRootDirectory,
    templates
  });
  const isCreateOpen = createWizard.isOpen;
  const [modsWorkspace, dispatchModsWorkspace] = useReducer(
    modWorkspaceReducer,
    undefined,
    emptyModWorkspaceState
  );
  const modsWorkspaceItemsRef = useRef<FluxoraModOrderItem[]>([]);
  modsWorkspaceItemsRef.current = modsWorkspace.items;
  const modsWorkspaceProjectIdRef = useRef<string | null>(null);
  const [installedMods, setInstalledMods] = useState<FluxoraInstalledMod[]>([]);
  const installedModsRef = useRef<FluxoraInstalledMod[]>([]);
  installedModsRef.current = installedMods;
  const [modUpdateResultsByProject, setModUpdateResultsByProject] =
    useState<ModUpdateResultsByProject>({});
  const [manualModUpdateNotice, setManualModUpdateNotice] = useState<string | null>(null);
  const [manualModUpdateSplash, setManualModUpdateSplash] =
    useState<ModUpdateCheckSplashState | null>(null);
  const manualModUpdateNoticeTimerRef = useRef<number | null>(null);
  const modUpdateApplyRef = useRef<(
    projectDirectory: string,
    result: Parameters<typeof applyModUpdateResultToInstalledMods>[1]
  ) => void>(() => undefined);
  modUpdateApplyRef.current = (projectDirectory, result) => {
    if (selectedProjectDirectoryRef.current !== projectDirectory) {
      return;
    }
    setModUpdateResultsByProject((current) =>
      rememberModUpdateResult(current, projectDirectory, result)
    );
    setInstalledMods((current) => applyModUpdateResultToInstalledMods(current, result));
    dispatchModsWorkspace({
      type: 'items-loaded',
      items: applyModUpdateResultToOrderItems(modsWorkspace.items, result)
    });
  };
  const modUpdateCoordinator = useMemo(
    () =>
      createModUpdateCoordinator({
        api: {
          checkUpdates: (request, operation) => window.fluxora.mods.checkUpdates(request, operation),
          cancel: (operationId, operation) => window.fluxora.operations.cancel(operationId, operation)
        },
        createOperationId: createRendererOperationId,
        onApplied: (projectDirectory, result) =>
          modUpdateApplyRef.current(projectDirectory, result),
        onAuthenticationUnavailable: () => {
          void connectionCoordinatorRef.current?.retryNow('mod_updates_auth_unavailable');
        }
      }),
    []
  );
  const [modsBusyLabel, setModsBusyLabel] = useState<string | null>(null);
  const [isCreatingModSeparator, setIsCreatingModSeparator] = useState(false);
  const [isDeletingModSeparators, setIsDeletingModSeparators] = useState(false);
  const modsActionsBusy =
    Boolean(modsBusyLabel) || isCreatingModSeparator || isDeletingModSeparators;
  const [modMenuOrderId, setModMenuOrderId] = useState<string | null>(null);
  const [modMenuPosition, setModMenuPosition] = useState<RowContextMenuPosition | null>(null);
  const [modsToolbarMenuPosition, setModsToolbarMenuPosition] =
    useState<RowContextMenuPosition | null>(null);
  const [modCreationDialog, setModCreationDialog] = useState<ModCreationDialogState | null>(null);
  const [itemRenameDialog, setItemRenameDialog] =
    useState<ItemRenameDialogRequest | null>(null);
  const modListVirtualizerRef = useRef<AdaptiveVirtualListHandle | null>(null);
  const modListScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [draggedModOrderIds, setDraggedModOrderIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [modDropTarget, setModDropTarget] = useState<RowDropTargetState | null>(null);
  const [downloadInstallDropTarget, setDownloadInstallDropTarget] =
    useState<RowDropTargetState | null>(null);
  const [fileTreeCache, setFileTreeCache] = useState<Record<string, FluxoraModFileTreeEntry[]>>(
    () => {
      if (initialModDetailsBootstrap?.content) {
        return modDetailsContentFileTree(initialModDetailsBootstrap.content);
      }
      if (initialModDetailsBootstrap?.rootFileTree) {
        return { '': initialModDetailsBootstrap.rootFileTree };
      }

      return {} as Record<string, FluxoraModFileTreeEntry[]>;
    }
  );
  const modDetailsContentCacheRef = useRef(createModDetailsContentCache());
  const [expandedFileTree, setExpandedFileTree] = useState<Record<string, boolean>>(
    () => expandedParentsForRelativePath(initialModDetailsBootstrap?.highlightRelativePath)
  );
  const [fileTreeState, setFileTreeState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    () =>
      initialModDetailsBootstrap?.content || initialModDetailsBootstrap?.rootFileTree
        ? 'ready'
        : 'idle'
  );
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
    useState<FluxoraModConflictTreePage | null>(
      () => initialModDetailsBootstrap?.content?.conflictTree ?? null
    );
  const [modDetailsTab, setModDetailsTab] = useState<ModDetailsTabId>('files');
  const [modDetailsConflictScanState, setModDetailsConflictScanState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >(() => (initialModDetailsBootstrap?.content ? 'ready' : 'idle'));
  effectiveFileTreeSnapshotRef.current = effectiveFileTreeSnapshot;
  const [pluginsWorkspace, dispatchPluginsWorkspace] = useReducer(
    pluginWorkspaceReducer,
    undefined,
    emptyPluginWorkspaceState
  );
  const pluginsWorkspaceItemsRef = useRef<FluxoraPluginOrderItem[]>([]);
  pluginsWorkspaceItemsRef.current = pluginsWorkspace.items;
  const pluginsWorkspaceProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const projectId = modsWorkspaceProjectIdRef.current;
    if (!projectId || modsWorkspace.loadState !== 'ready') {
      return;
    }

    saveCollapsedSeparatorOrderIds(
      window.localStorage,
      projectId,
      'mods',
      modsWorkspace.collapsedSeparatorOrderIds
    );
  }, [modsWorkspace.collapsedSeparatorOrderIds, modsWorkspace.loadState]);
  useEffect(() => {
    const projectId = pluginsWorkspaceProjectIdRef.current;
    if (!projectId || pluginsWorkspace.loadState !== 'ready') {
      return;
    }

    saveCollapsedSeparatorOrderIds(
      window.localStorage,
      projectId,
      'plugins',
      pluginsWorkspace.collapsedSeparatorOrderIds
    );
  }, [pluginsWorkspace.collapsedSeparatorOrderIds, pluginsWorkspace.loadState]);
  const [pluginsBusyLabel, setPluginsBusyLabel] = useState<string | null>(null);
  const [isDeletingPluginSeparators, setIsDeletingPluginSeparators] = useState(false);
  const pluginsActionsBusy = Boolean(pluginsBusyLabel) || isDeletingPluginSeparators;
  const [pluginMenuOrderId, setPluginMenuOrderId] = useState<string | null>(null);
  const [pluginMenuPosition, setPluginMenuPosition] =
    useState<RowContextMenuPosition | null>(null);
  const [pluginSeparatorDialog, setPluginSeparatorDialog] =
    useState<PluginSeparatorDialogRequest | null>(null);
  const pluginListVirtualizerRef = useRef<AdaptiveVirtualListHandle | null>(null);
  const [draggedPluginOrderIds, setDraggedPluginOrderIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [pluginDropTarget, setPluginDropTarget] = useState<RowDropTargetState | null>(null);
  const [downloadsWorkspace, dispatchDownloadsWorkspace] = useReducer(
    downloadWorkspaceReducer,
    undefined,
    emptyDownloadWorkspaceState
  );
  const downloadsWorkspaceItemsRef = useRef<FluxoraDownloadEntry[]>([]);
  downloadsWorkspaceItemsRef.current = downloadsWorkspace.items;
  const [downloadsBusyLabel, setDownloadsBusyLabel] = useState<string | null>(null);
  const [isImportingNxmManually, setIsImportingNxmManually] = useState(false);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [downloadMenuPosition, setDownloadMenuPosition] =
    useState<RowContextMenuPosition | null>(null);
  const downloadListVirtualizerRef = useRef<AdaptiveVirtualListHandle | null>(null);
  const [downloadDropCue, setDownloadDropCueState] = useState<DownloadDropCue>('idle');
  const [downloadDuplicateDecisionResolving, setDownloadDuplicateDecisionResolving] = useState(false);
  const [downloadDuplicateDecisionError, setDownloadDuplicateDecisionError] = useState<string | null>(null);
  const [draggedDownloadInstallId, setDraggedDownloadInstallId] = useState<string | null>(null);
  const downloadDropCueRef = useRef<DownloadDropCue>('idle');
  const downloadDropSurfaceRef = useRef<HTMLDivElement | null>(null);
  const downloadDropResetRef = useRef<number | null>(null);
  const downloadsDeltaCursorRef = useRef<{
    projectDirectory: string;
    revision: string;
    sequence: number;
  } | null>(null);
  const downloadsDeltaResyncInFlightRef = useRef(false);
  const workspaceDeltaStateRef = useRef<WorkspaceDeltaState | null>(null);
  const workspaceDeltaSeedRef = useRef<{
    scopeKey: string;
    promise: Promise<WorkspaceDeltaState | null>;
  } | null>(null);
  const workspaceFullResyncInFlightRef = useRef(false);
  const pendingWorkspaceFullResyncRef = useRef<PendingWorkspaceFullResync | null>(null);
  const listScrollActivityRef = useRef({ mods: false, plugins: false });
  const applyIncomingWorkspaceDeltaRef = useRef<(
    delta: FluxoraWorkspaceDelta,
    expectedOperationId?: string,
    urgent?: boolean
  ) => boolean>(() => false);
  const queueWorkspaceFullResyncRef = useRef<(
    project: FluxoraProject,
    profileName: string,
    reason: string
  ) => void>(() => undefined);
  const flushWorkspaceFullResyncRef = useRef<() => void>(() => undefined);
  const handleModsScrollActivityChange = useCallback((active: boolean) => {
    listScrollActivityRef.current.mods = active;
    if (!active) {
      flushWorkspaceFullResyncRef.current();
    }
  }, []);
  const handlePluginsScrollActivityChange = useCallback((active: boolean) => {
    listScrollActivityRef.current.plugins = active;
    if (!active) {
      flushWorkspaceFullResyncRef.current();
    }
  }, []);
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
  const installDetectionPromiseRef = useRef<{
    operationId: string;
    promise: Promise<FluxoraFomodInstaller>;
  } | null>(null);
  const installPlanPromiseRef = useRef<{
    operationId: string;
    promise: Promise<FluxoraInstallPlan>;
  } | null>(null);
  const installSubmitSourcesRef = useRef<Set<string>>(new Set());
  const installSourceByOperationRef = useRef<Map<string, string>>(new Map());
  const installOperationsRef = useRef<Map<string, FluxoraInstallOperation>>(new Map());
  const installRestoreGenerationRef = useRef(0);
  const installPlacementValidationGenerationRef = useRef(0);
  const downloadsActionsBusy = Boolean(downloadsBusyLabel);
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
  const modOrderDragSettledResolversRef = useRef<Set<() => void>>(new Set());
  const modOrderClientRevisionRef = useRef(0);
  const modOrderSaveSequenceRef = useRef(0);
  const pendingModOrderSavesRef = useRef<Set<Promise<void>>>(new Set());
  const modEnableSaveSequenceRef = useRef(0);
  const latestModEnableSequenceByOrderIdRef = useRef<Map<string, number>>(new Map());
  const modBulkEnableSequenceRef = useRef(0);
  const pendingInstallOrchestrator = usePendingInstallOrchestrator({
    items: modsWorkspace.items,
    onItemsChanged: (items) => dispatchModsWorkspace({ type: 'items-loaded', items }),
    onWorkspaceRevision: () => {
      modOrderClientRevisionRef.current += 1;
    },
    onRebaseError: (error, operationId) => {
      const detail = errorMessage(error);
      setMessage(t('app.message.pendingInstallOrderFailed', { error: detail }));
      void window.fluxora.ui.log({
        level: 'warning',
        category: 'ModInstall',
        message: `Pending install rebase deferred: ${detail}`,
        operationId
      });
    },
    onOperationProgress: (operation, finalizePendingProjection) => {
      const settleOperation = () => {
        const previousOperation = installOperationsRef.current.get(operation.operationId);
        installOperationsRef.current.set(operation.operationId, operation);
        if (operation.state === 'committing' || operation.state === 'finalizing') {
          installCommitOperationsRef.current.add(operation.operationId);
        } else if (
          operation.state === 'completed' ||
          operation.state === 'failed' ||
          operation.state === 'cancelled' ||
          operation.state === 'needsReview'
        ) {
          installCommitOperationsRef.current.delete(operation.operationId);
          if (
            installCommitOperationsRef.current.size === 0 &&
            deferredBuildContentRefreshRef.current
          ) {
            const refresh = deferredBuildContentRefreshRef.current;
            deferredBuildContentRefreshRef.current = null;
            void window.fluxora.ui.log({
              level: 'info',
              category: 'ModInstall',
              message: 'Install commit gate released; running one deduplicated watcher reconciliation.',
              operationId: operation.operationId
            });
            void buildContentRefreshCoordinator.schedule(refresh).catch(() => undefined);
          }
        }
        if (
          operation.state !== 'completed' &&
          operation.state !== 'failed' &&
          operation.state !== 'cancelled' &&
          operation.state !== 'needsReview'
        ) {
          return;
        }
        const sourcePath = installSourceByOperationRef.current.get(operation.operationId);
        if (sourcePath && operation.state !== 'needsReview') {
          installSubmitSourcesRef.current.delete(sourcePath);
          installSourceByOperationRef.current.delete(operation.operationId);
        }
        if (operation.state === 'completed') {
          const source = downloadsWorkspaceItemsRef.current.find(
            (entry) => downloadPath(entry).toLocaleLowerCase() === operation.sourcePath.toLocaleLowerCase()
          );
          if (source) {
            dispatchDownloadsWorkspace({
              type: 'items-upserted',
              items: [{ ...source, buildStatus: 'Installed' }]
            });
          }
          if (operation.result?.orderId) {
            dispatchModsWorkspace({
              type: 'item-reveal-requested',
              orderId: operation.result.orderId
            });
          }
          setMessage(t('app.message.installComplete', {
            name: operation.result?.name || operation.targetFolder
          }));
        } else if (operation.state === 'needsReview') {
          const source = downloadsWorkspaceItemsRef.current.find(
            (entry) => downloadPath(entry).toLocaleLowerCase() === operation.sourcePath.toLocaleLowerCase()
          );
          if (source) {
            dispatchDownloadsWorkspace({
              type: 'items-upserted',
              items: [{ ...source, buildStatus: 'Ready' }]
            });
          }
          if (previousOperation?.state !== 'needsReview') {
            reopenInstallForReview(operation);
          }
        } else if (operation.state === 'cancelled') {
          setMessage(t('app.message.installCancelled', { name: operation.targetFolder }));
          const source = downloadsWorkspaceItemsRef.current.find(
            (entry) => downloadPath(entry).toLocaleLowerCase() === operation.sourcePath.toLocaleLowerCase()
          );
          if (source) {
            dispatchDownloadsWorkspace({
              type: 'items-upserted',
              items: [{ ...source, buildStatus: 'Ready' }]
            });
          }
        } else {
          setMessage(operation.errorMessage || t('app.message.installFailed', {
            name: operation.targetFolder
          }));
          const source = downloadsWorkspaceItemsRef.current.find(
            (entry) => downloadPath(entry).toLocaleLowerCase() === operation.sourcePath.toLocaleLowerCase()
          );
          if (source) {
            dispatchDownloadsWorkspace({
              type: 'items-upserted',
              items: [{ ...source, buildStatus: 'Failed' }]
            });
          }
        }
      };

      const workspaceDelta = operation.workspaceDelta;
      if (!workspaceDelta) {
        settleOperation();
        return;
      }

      void workspaceOrderMutationGate
        .readStable(async () => workspaceDelta)
        .then((stableDelta) => {
          finalizePendingProjection?.();
          applyIncomingWorkspaceDeltaRef.current(
            stableDelta,
            operation.operationId,
            true
          );
          settleOperation();
        })
        .catch((error) => {
          finalizePendingProjection?.();
          settleOperation();
          void window.fluxora.ui.log({
            level: 'warning',
            category: 'WorkspaceDelta',
            message: `Could not apply the install workspace delta after order saves settled: ${errorMessage(error)}`,
            operationId: operation.operationId
          });
        });
    }
  });
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
  const currentModUpdateResult = selectedProject
    ? modUpdateResultsByProject[modUpdateProjectKey(selectedProject.projectDirectory)]
    : undefined;
  useEffect(() => {
    const projectDirectory = selectedProject?.projectDirectory;
    if (!projectDirectory || loadedWorkspaceProjectId !== selectedProject.id) {
      return;
    }
    const restoreGeneration = installRestoreGenerationRef.current + 1;
    installRestoreGenerationRef.current = restoreGeneration;
    const operationId = createRendererOperationId('install_restore');
    void window.fluxora.installs.restore(projectDirectory, { operationId }).then((operations) => {
      void window.fluxora.ui.log({
        level: 'info',
        category: 'ModInstall',
        message: `Install recovery scan returned ${operations.length} active operation(s).`,
        operationId
      });
      if (
        installRestoreGenerationRef.current !== restoreGeneration ||
        selectedProjectDirectoryRef.current !== projectDirectory
      ) {
        void window.fluxora.ui.log({
          level: 'info',
          category: 'ModInstall',
          message: 'Install recovery result was superseded by a newer workspace scan.',
          operationId
        });
        return;
      }
      for (const operation of operations) {
        installOperationsRef.current.set(operation.operationId, operation);
        pendingInstallOrchestrator.progressStore.setOperation(operation);
        const restoredSourceKey = operation.sourcePath.toLocaleLowerCase();
        if (!restoredInstallNeedsPendingProjection(operation)) {
          installSubmitSourcesRef.current.delete(restoredSourceKey);
          installSourceByOperationRef.current.delete(operation.operationId);
          continue;
        }
        const afterIndex = operation.afterOrderId
          ? modsWorkspace.items.findIndex((item) => item.orderId === operation.afterOrderId)
          : -1;
        const beforeIndex = operation.beforeOrderId
          ? modsWorkspace.items.findIndex((item) => item.orderId === operation.beforeOrderId)
          : -1;
        const targetIndex = afterIndex >= 0
          ? afterIndex
          : beforeIndex >= 0
            ? beforeIndex + 1
            : modsWorkspace.items.length;
        installSubmitSourcesRef.current.add(restoredSourceKey);
        installSourceByOperationRef.current.set(
          operation.operationId,
          restoredSourceKey
        );
        const targetStillExists = Boolean(
          operation.targetModUuid &&
          modsWorkspace.items.some((item) => item.modUuid === operation.targetModUuid)
        );
        const restoredSession = pendingInstallOrchestrator.begin({
          projectDirectory,
          operationId: operation.operationId,
          modName: operation.targetFolder,
          mode: targetStillExists ? operation.existingModMode : 0,
          targetModUuid: targetStillExists ? operation.targetModUuid : undefined,
          targetIndex
        });
        void window.fluxora.ui.log({
          level: 'info',
          category: 'ModInstall',
          message: `Install recovery projected ${restoredSession.rowOrderId}.`,
          operationId: operation.operationId
        });
        if (operation.state === 'needsReview') {
          reopenInstallForReview(operation);
        }
      }
    }).catch((error) => {
      if (
        installRestoreGenerationRef.current === restoreGeneration &&
        selectedProjectDirectoryRef.current === projectDirectory
      ) {
        void window.fluxora.ui.log({
          level: 'warning',
          category: 'ModInstall',
          message: `Install recovery scan failed: ${errorMessage(error)}`,
          operationId
        });
      }
    });
  }, [loadedWorkspaceProjectId, selectedProject?.id, selectedProject?.projectDirectory]);
  useEffect(() => {
    if (
      isSecondaryWindow ||
      !bridgeStatus?.ready ||
      !nexusConnectionReady ||
      !selectedProject ||
      loadedWorkspaceProjectId !== selectedProject.id
    ) {
      modUpdateCoordinator.stop();
      return;
    }
    modUpdateCoordinator.activate(selectedProject.projectDirectory);
  }, [
    bridgeStatus?.ready,
    isSecondaryWindow,
    loadedWorkspaceProjectId,
    modUpdateCoordinator,
    nexusConnectionReady,
    selectedProject?.id,
    selectedProject?.projectDirectory
  ]);

  useEffect(() => () => modUpdateCoordinator.stop(), [modUpdateCoordinator]);
  useEffect(() => () => {
    if (manualModUpdateNoticeTimerRef.current !== null) {
      window.clearTimeout(manualModUpdateNoticeTimerRef.current);
    }
  }, []);
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
      return t('titlebar.buildSettings', {
        name: selectedProject?.name ?? (buildSettingsInitialName || t('titlebar.fallbackBuild'))
      });
    }

    if (isModDetailsWindow) {
      return modDetailsInitialName || t('app.ui.details');
    }

    if (isFilePreviewWindow) {
      return t('titlebar.preview', {
        name: filePreviewInitialName || t('titlebar.fallbackFile')
      });
    }

    return isSettingsWindow ? t('titlebar.settings') : t('titlebar.appName');
  }, [
    buildSettingsInitialName,
    filePreviewInitialName,
    isFilePreviewWindow,
    isBuildSettingsWindow,
    isModDetailsWindow,
    isSettingsWindow,
    modDetailsInitialName,
    selectedProject?.name,
    t
  ]);

  const deferredSearchText = useDeferredValue(searchText);
  const deferredModSearchText = useDeferredValue(modsWorkspace.searchText);
  const deferredPluginSearchText = useDeferredValue(pluginsWorkspace.searchText);
  const deferredDownloadSearchText = useDeferredValue(downloadsWorkspace.searchText);
  const deferredProfileSearchText = useDeferredValue(profilesWorkspace.searchText);
  const deferredExecutableSearchText = useDeferredValue(executablesWorkspace.searchText);

  const prepareModSearchScroll = useSearchScrollRestoration({
    renderedSearchText: deferredModSearchText,
    readScrollTop: () => modListVirtualizerRef.current?.getScrollTop() ?? 0,
    scrollTo: (scrollTop) => modListVirtualizerRef.current?.scrollTo(scrollTop)
  });
  const preparePluginSearchScroll = useSearchScrollRestoration({
    renderedSearchText: deferredPluginSearchText,
    readScrollTop: () => pluginListVirtualizerRef.current?.getScrollTop() ?? 0,
    scrollTo: (scrollTop) => pluginListVirtualizerRef.current?.scrollTo(scrollTop)
  });
  const prepareDownloadSearchScroll = useSearchScrollRestoration({
    renderedSearchText: deferredDownloadSearchText,
    readScrollTop: () => downloadListVirtualizerRef.current?.getScrollTop() ?? 0,
    scrollTo: (scrollTop) => downloadListVirtualizerRef.current?.scrollTo(scrollTop)
  });

  const filteredProjects = useMemo(
    () => filterProjects(projects, deferredSearchText),
    [projects, deferredSearchText]
  );

  const filteredModItems = useMemo(
    () =>
      measureListPerformanceStage('derive:visible-mods', () =>
        visibleModOrderItems(
          modsWorkspace.items,
          deferredModSearchText,
          modsWorkspace.collapsedSeparatorOrderIds
        )
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
    () =>
      measureListPerformanceStage('derive:displayed-mods', () =>
        appendOverwriteOrderItem(filteredModItems, overwriteModItem, deferredModSearchText)
      ),
    [deferredModSearchText, filteredModItems, overwriteModItem]
  );

  const {
    highlightedOrderId: postInstallRevealOrderId,
    requestPostInstallModReveal,
    scrollContainerRef: postInstallModRevealContainerRef,
    handlePostInstallModRevealAnimationEnd
  } = usePostInstallModReveal({
    items: displayedModItems,
    rowHeight: modRowHeight,
    scopeKey: selectedProject?.id ?? null,
    onScrollTopChange: (scrollTop) =>
      modListVirtualizerRef.current?.synchronizeScrollPosition(scrollTop)
  });
  const setModListScrollContainerRef = useCallback((container: HTMLDivElement | null) => {
    modListScrollContainerRef.current = container;
    postInstallModRevealContainerRef(container);
  }, [postInstallModRevealContainerRef]);

  const selectableModOrderIds = useMemo(
    () =>
      measureListPerformanceStage('derive:selectable-mods', () =>
        displayedModItems
          .filter((item) => !isModOverwriteItem(item))
          .map((item) => item.orderId)
      ),
    [displayedModItems]
  );

  const selectedModItem = useMemo(
    () =>
      measureListPerformanceStage('derive:selected-mod', () => {
        if (modsWorkspace.selectedOrderId === overwriteModItem?.orderId) {
          return overwriteModItem;
        }

        return selectedModOrderItem(
          modsWorkspace.items,
          modsWorkspace.selectedOrderId,
          modsWorkspace.collapsedSeparatorOrderIds
        );
      }),
    [
      modsWorkspace.items,
      modsWorkspace.selectedOrderId,
      modsWorkspace.collapsedSeparatorOrderIds,
      overwriteModItem
    ]
  );
  const aiVoiceBuildTerms = useMemo(() => {
    return measureListPerformanceStage('derive:ai-voice-mod-terms', () => {
      const selectedName = selectedModItem?.isMod ? modItemTitle(selectedModItem, appLocale) : '';
      const loadedNames = installedMods.map((mod) => mod.name);
      const workspaceNames = modsWorkspace.items
        .filter((item) => item.isMod)
        .map((item) => modItemTitle(item, appLocale));
      return [selectedName, selectedProject?.name ?? '', ...loadedNames, ...workspaceNames];
    });
  }, [appLocale, installedMods, modsWorkspace.items, selectedModItem, selectedProject?.name]);

  const selectedModDeletionItems = useMemo(
    () =>
      measureListPerformanceStage('derive:selected-mod-deletions', () =>
        modsWorkspace.items.filter(
          (item) => item.isMod && modsWorkspace.selectedOrderIds.has(item.orderId)
        )
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
    () =>
      measureListPerformanceStage(
        'derive:total-mod-count',
        () => modsWorkspace.items.filter((item) => item.isMod).length
      ),
    [modsWorkspace.items]
  );

  const enabledModCount = useMemo(
    () =>
      measureListPerformanceStage(
        'derive:enabled-mod-count',
        () => modsWorkspace.items.filter((item) => item.isMod && item.isEnabled).length
      ),
    [modsWorkspace.items]
  );

  const filteredPluginItems = useMemo(
    () =>
      measureListPerformanceStage('derive:visible-plugins', () =>
        visiblePluginOrderItems(
          pluginsWorkspace.items,
          deferredPluginSearchText,
          pluginsWorkspace.collapsedSeparatorOrderIds
        )
      ),
    [
      pluginsWorkspace.items,
      deferredPluginSearchText,
      pluginsWorkspace.collapsedSeparatorOrderIds
    ]
  );

  const selectablePluginOrderIds = useMemo(
    () =>
      measureListPerformanceStage(
        'derive:selectable-plugins',
        () => filteredPluginItems.map((item) => item.orderId)
      ),
    [filteredPluginItems]
  );

  const selectedPluginItem = useMemo(
    () =>
      measureListPerformanceStage('derive:selected-plugin', () =>
        selectedPluginOrderItem(
          pluginsWorkspace.items,
          pluginsWorkspace.selectedOrderId,
          pluginsWorkspace.collapsedSeparatorOrderIds
        )
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

  const taskbarProgressState = useMemo(
    () => {
      const downloadsFeatureState = bridgeStatus?.capabilities?.features.downloads?.state;
      return selectedProject &&
        bridgeStatus?.ready &&
        (downloadsFeatureState === 'available' || downloadsFeatureState === 'limited')
        ? taskbarDownloadProgress(downloadsWorkspace.items)
        : ({ status: 'none' } as const);
    },
    [
      bridgeStatus?.capabilities?.features.downloads?.state,
      bridgeStatus?.ready,
      downloadsWorkspace.items,
      selectedProject
    ]
  );

  useEffect(() => {
    if (isSecondaryWindow) {
      return;
    }

    void window.fluxora.windowControls
      .setTaskbarProgress(taskbarProgressState)
      .catch(() => undefined);
  }, [isSecondaryWindow, taskbarProgressState]);

  useEffect(() => {
    if (isSecondaryWindow) {
      return undefined;
    }

    return () => {
      void window.fluxora.windowControls
        .setTaskbarProgress({ status: 'none' })
        .catch(() => undefined);
    };
  }, [isSecondaryWindow]);

  const downloadDuplicateDecisionQueue = useMemo(
    () => queuedDownloadDuplicateDecisions(downloadsWorkspace.items),
    [downloadsWorkspace.items]
  );
  const activeDownloadDuplicateDecision = downloadDuplicateDecisionQueue[0] ?? null;

  useEffect(() => {
    setDownloadDuplicateDecisionError(null);
    setDownloadDuplicateDecisionResolving(false);
  }, [activeDownloadDuplicateDecision?.id]);

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
  useEffect(() => {
    window.__fluxoraListPerformance?.setContext({
      projectDirectory: selectedProject?.projectDirectory,
      profileName: selectedProjectProfileName
    });
  }, [selectedProject?.projectDirectory, selectedProjectProfileName]);

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

  const effectiveFileTreeRequestKey = useMemo(
    () =>
      selectedProject
        ? [
            selectedProject.projectDirectory,
            selectedProjectProfileName,
            buildPathRevisionKey
          ].join('\n')
        : '',
    [
      buildPathRevisionKey,
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

  const enabledPluginSlotCounts = useMemo(
    () =>
      measureListPerformanceStage('derive:enabled-plugin-slot-counts', () => {
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
      }),
    [pluginsWorkspace.items]
  );

  const selectedProjectRuntimeSummary = useMemo<ProjectRuntimeSummary | undefined>(
    () =>
      measureListPerformanceStage('derive:project-runtime-summary', () => {
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
      }),
    [
      downloadsWorkspace.items,
      downloadsWorkspace.loadState,
      installedMods,
      loadedWorkspaceProjectId,
      modsWorkspace.items,
      modsWorkspace.loadState
    ]
  );

  const selectedProjectLibraryStats = useMemo(
    () =>
      selectedProject
        ? buildProjectLibraryStats(
            selectedProject,
            selectedProjectRuntimeSummary,
            bridgeStatus?.language
          )
        : null,
    [bridgeStatus?.language, selectedProject, selectedProjectRuntimeSummary]
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
        if (
          !exactWorkspacePreparedDuringOpen &&
          !exactWorkspaceCoveredByWatcher &&
          buildContentRefreshCoordinator.isRunning()
        ) {
          // The watcher owns this exact revision. Let its fast plugin refresh
          // and single mod reconciliation finish instead of starting another
          // expensive workspace scan from the open-background path.
          return;
        }
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
  }, [buildContentRefreshCoordinator, loadedWorkspaceProjectId, projectOpenCommitSequence]);

  const buildProfileOptions = useMemo(() => {
    if (profilesWorkspace.items.length > 0) {
      return profilesWorkspace.items;
    }

    return selectedProjectProfileName ? [selectedProjectProfileName] : [];
  }, [profilesWorkspace.items, selectedProjectProfileName]);

  const installFomodEvaluation = useMemo(
    () =>
      installDialog?.fomodInstaller
        ? evaluateFomodWizard(
            installDialog.fomodInstaller,
            installDialog.selectedFomodOptionIds,
            appLocale
          )
        : null,
    [appLocale, installDialog?.fomodInstaller, installDialog?.selectedFomodOptionIds]
  );

  const installExistingModName = useMemo(
    () =>
      installDialog
        ? matchedInstallTargetForCurrentName(installDialog)?.displayName ?? null
        : null,
    [installDialog?.installPlan, installDialog?.modName, installDialog?.modNameSource]
  );

  const pluginCapabilities = useMemo(
    () => pluginCapabilityView(selectedProject, bridgeStatus, appLocale),
    [appLocale, bridgeStatus, selectedProject]
  );
  const showPluginMissingMastersStatus = useMemo(
    () => isSkyrimMissingMasterStatusProject(selectedProject),
    [selectedProject]
  );
  const disabledPluginSourceModNameKeys = useMemo(
    () =>
      measureListPerformanceStage('derive:disabled-plugin-source-mods', () => {
        const keys = new Set<string>();
        const addSourceModKey = (value: string | null | undefined) => {
          const key = pluginSourceModKey(value);
          if (key) {
            keys.add(key);
          }
        };

        modsWorkspace.items.forEach((item) => {
          if (item.isMod && !item.isEnabled) {
            addSourceModKey(modItemTitle(item, appLocale));
          }
        });
        installedMods.forEach((mod) => {
          if (!mod.isEnabled) {
            addSourceModKey(mod.name);
          }
        });

        return keys;
      }),
    [installedMods, modsWorkspace.items]
  );
  const pluginMasterAvailabilityNeeded = useMemo(
    () =>
      measureListPerformanceStage('derive:plugin-master-availability-needed', () =>
        pluginsWorkspace.items.some(
          (item) => item.isPlugin && (item.masterFiles?.length ?? 0) > 0
        )
      ),
    [pluginsWorkspace.items]
  );
  const pluginMissingMasterContext = useMemo<PluginMissingMasterContext>(
    () =>
      measureListPerformanceStage('derive:plugin-missing-master-context', () => ({
        disabledSourceModNameKeys: disabledPluginSourceModNameKeys,
        enabledPluginNameKeys: pluginMasterAvailabilityNeeded
          ? enabledPluginNameKeys(
              pluginsWorkspace.items,
              disabledPluginSourceModNameKeys
            )
          : undefined
      })),
    [
      disabledPluginSourceModNameKeys,
      pluginMasterAvailabilityNeeded,
      pluginsWorkspace.items
    ]
  );
  const pendingInstallSessionByOrderId = useMemo(
    () =>
      measureListPerformanceStage('derive:pending-install-index', () => {
        if (pendingInstallOrchestrator.sessions.size === 0) {
          return new Map<
            string,
            ReturnType<typeof pendingInstallOrchestrator.activeSessionForItem>
          >();
        }
        const byOrderId = new Map<
          string,
          ReturnType<typeof pendingInstallOrchestrator.activeSessionForItem>
        >();
        const byModUuid = new Map<
          string,
          ReturnType<typeof pendingInstallOrchestrator.activeSessionForItem>
        >();
        pendingInstallOrchestrator.sessions.forEach((session) => {
          if (!byOrderId.has(session.rowOrderId)) {
            byOrderId.set(session.rowOrderId, session);
          }
          if (!byOrderId.has(session.pendingOrderId)) {
            byOrderId.set(session.pendingOrderId, session);
          }
          if (session.targetModUuid && !byModUuid.has(session.targetModUuid)) {
            byModUuid.set(session.targetModUuid, session);
          }
        });
        modsWorkspace.items.forEach((item) => {
          const session = item.modUuid ? byModUuid.get(item.modUuid) : null;
          if (session && !byOrderId.has(item.orderId)) {
            byOrderId.set(item.orderId, session);
          }
        });
        return byOrderId;
      }),
    [modsWorkspace.items, pendingInstallOrchestrator.sessions]
  );
  const conflictMarkerReadyByOrderId = useMemo(
    () =>
      measureListPerformanceStage('derive:conflict-marker-ready-index', () => {
        if (pendingInstallSessionByOrderId.size === 0) {
          return new Map<string, boolean>();
        }
        const ready = new Map<string, boolean>();
        modsWorkspace.items.forEach((item) => {
          const session = pendingInstallSessionByOrderId.get(item.orderId);
          ready.set(
            item.orderId,
            session ? pendingInstallConflictMarkerReady(session, item) : true
          );
        });
        return ready;
      }),
    [modsWorkspace.items, pendingInstallSessionByOrderId]
  );
  const previousModRowViewIndexRef = useRef<ModRowViewIndex | undefined>(undefined);
  const modRowViewIndex = useMemo(
    () =>
      measureListPerformanceStage('derive:mod-row-view-index', () =>
        buildModRowViewIndex(
          modsWorkspace.items,
          {
            selectedItem: selectedModItem,
            language: bridgeStatus?.language,
            collapsedSeparatorOrderIds: modsWorkspace.collapsedSeparatorOrderIds,
            updateResult: currentModUpdateResult,
            conflictMarkerReadyByOrderId
          },
          previousModRowViewIndexRef.current
        )
      ),
    [
      conflictMarkerReadyByOrderId,
      currentModUpdateResult,
      bridgeStatus?.language,
      modsWorkspace.collapsedSeparatorOrderIds,
      modsWorkspace.items,
      selectedModItem
    ]
  );
  useEffect(() => {
    previousModRowViewIndexRef.current = modRowViewIndex;
  }, [modRowViewIndex]);
  const previousPluginRowViewIndexRef = useRef<PluginRowViewIndex | undefined>(undefined);
  const pluginRowViewIndex = useMemo(
    () =>
      measureListPerformanceStage('derive:plugin-row-view-index', () =>
        buildPluginRowViewIndex(
          pluginsWorkspace.items,
          {
            collapsedSeparatorOrderIds: pluginsWorkspace.collapsedSeparatorOrderIds,
            missingMasterContext: pluginMissingMasterContext,
            missingMasterLimit: pluginMissingMasterStatusLimit
          },
          previousPluginRowViewIndexRef.current
        )
      ),
    [
      pluginMissingMasterContext,
      pluginsWorkspace.collapsedSeparatorOrderIds,
      pluginsWorkspace.items
    ]
  );
  useEffect(() => {
    previousPluginRowViewIndexRef.current = pluginRowViewIndex;
  }, [pluginRowViewIndex]);
  const modsListPresentationRevision = useMemo(
    () => ({}),
    [
      downloadInstallDropTarget,
      draggedModOrderIds,
      modDropTarget,
      modMenuOrderId,
      modRowViewIndex,
      modsActionsBusy,
      modsWorkspace.selectedOrderIds,
      pendingInstallSessionByOrderId,
      postInstallRevealOrderId
    ]
  );
  const pluginsListPresentationRevision = useMemo(
    () => ({}),
    [
      draggedPluginOrderIds,
      pluginCapabilities.loadOrderSupported,
      pluginDropTarget,
      pluginMenuOrderId,
      pluginRowViewIndex,
      pluginsActionsBusy,
      pluginsWorkspace.selectedOrderIds,
      showPluginMissingMastersStatus
    ]
  );

  const downloadCapabilities = useMemo(
    () => downloadCapabilityView(selectedProject, bridgeStatus, appLocale),
    [appLocale, bridgeStatus, selectedProject]
  );
  inboundNxmReadinessRef.current = {
    bridgeReady: Boolean(bridgeStatus?.ready),
    downloadBridgeAvailable: downloadCapabilities.bridgeAvailable
  };

  const profilesCapabilities = useMemo(
    () => profilesCapabilityView(selectedProject, bridgeStatus, appLocale),
    [appLocale, bridgeStatus, selectedProject]
  );

  const executableCapabilities = useMemo(
    () => executablesCapabilityView(selectedProject, bridgeStatus, appLocale),
    [appLocale, bridgeStatus, selectedProject]
  );

  const buildHeaderCapabilities = useMemo(
    () => buildHeaderCapabilityView(bridgeStatus, appLocale),
    [appLocale, bridgeStatus]
  );

  const grassCacheModEntries = useMemo(
    () =>
      installedMods.length > 0
        ? installedMods
        : modsWorkspace.items.filter((item) => item.isMod),
    [installedMods, modsWorkspace.items]
  );

  const grassCacheAction = useMemo(
    () => ngioGrassCacheActionView(
      selectedProject,
      grassCacheModEntries,
      bridgeStatus,
      appLocale
    ),
    [appLocale, bridgeStatus, grassCacheModEntries, selectedProject]
  );

  const settingsCapabilities = useMemo(
    () => settingsCapabilityView(bridgeStatus),
    [bridgeStatus]
  );

  const rememberApiLimitProviders = (providers: FluxoraApiLimitProvider[]) => {
    setApiLimitProviders(providers);
  };
  const nexusVerifiedLinked = nexusConnectionReady;

  const isTransferRunning = transferRunningOperationId !== null;
  const operationCancellationSupported =
    bridgeStatus?.capabilities?.features.operationCancellation?.state === 'available';
  const transferCancellationSupported = settingsCapabilities.transferCancellationAvailable;

  const modConflictScrollbarMarkers = useMemo(() => {
    return measureListPerformanceStage('derive:mod-conflict-scrollbar-markers', () => {
      if (displayedModItems.length === 0) {
        return [];
      }

      return displayedModItems.flatMap((item, index) => {
        const rowView = modRowViewIndex.byOrderId.get(item.orderId);
        if (!rowView || !(conflictMarkerReadyByOrderId.get(item.orderId) ?? true)) {
          return [];
        }
        const states = item.isSeparator
          ? rowView.isCollapsed
            ? modConflictMarkerStatesForHighlight(rowView.conflictHighlight)
            : []
          : modConflictMarkerStatesForHighlight(rowView.conflictHighlight);

        return states.map((state, stateIndex) => ({
          contentOffset: (index + 0.5) * modRowHeight,
          key: `${item.orderId}:${state}`,
          state,
          stackOffset: (stateIndex - (states.length - 1) / 2) * 4
        }));
      });
    });
  }, [
    conflictMarkerReadyByOrderId,
    displayedModItems,
    modRowViewIndex
  ]);

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
    () => navItems.find((item) => item.id === activeRoute)?.label ?? t('app.nav.home'),
    [activeRoute, navItems, t]
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

  const installWorkspaceDeltaState = (
    nextState: WorkspaceDeltaState,
    project: FluxoraProject,
    urgent = false
  ) => {
    workspaceDeltaStateRef.current = nextState;
    if (
      selectedWorkspaceScopeRef.current.project?.projectDirectory !==
        nextState.projectDirectory ||
      selectedWorkspaceScopeRef.current.profileName !== nextState.profileName
    ) {
      return;
    }
    const projectedMods = measureListPerformanceStage(
      'workspace-delta:merge-pending-installs',
      () => pendingInstallOrchestrator.mergeAuthoritativeItems(nextState.mods)
    );
    const commit = () => {
      setInstalledMods(nextState.installedMods);
      modsWorkspaceProjectIdRef.current = project.id;
      pluginsWorkspaceProjectIdRef.current = project.id;
      dispatchModsWorkspace({
        type: 'items-loaded',
        items: projectedMods,
        collapsedSeparatorOrderIds: loadCollapsedSeparatorOrderIds(
          window.localStorage,
          project.id,
          'mods'
        )
      });
      dispatchPluginsWorkspace({
        type: 'items-loaded',
        items: nextState.plugins,
        collapsedSeparatorOrderIds: loadCollapsedSeparatorOrderIds(
          window.localStorage,
          project.id,
          'plugins'
        )
      });
    };
    if (urgent) {
      commit();
    } else {
      startTransition(commit);
    }
  };

  const ensureWorkspaceDeltaBaseline = async (
    project: FluxoraProject,
    profileName: string,
    operationId = createRendererOperationId('workspace_delta_baseline'),
    force = false
  ): Promise<WorkspaceDeltaState | null> => {
    const scopeKey = pluginWorkspaceContextKey(project, profileName);
    const current = workspaceDeltaStateRef.current;
    if (
      !force &&
      current?.projectDirectory === project.projectDirectory &&
      current.profileName === profileName
    ) {
      return current;
    }
    if (workspaceDeltaSeedRef.current?.scopeKey === scopeKey) {
      return workspaceDeltaSeedRef.current.promise;
    }

    const promise = workspaceOrderMutationGate
      .readStable(() =>
        window.fluxora.workspace.getDelta(project.projectDirectory, profileName, '', {
          operationId,
          templateId: project.templateId
        })
      )
      .then((delta) => {
        const emptyState: WorkspaceDeltaState = {
          projectDirectory: project.projectDirectory,
          profileName,
          revision: '',
          sequence: Math.max(0, delta.sequence - 1),
          mods: [],
          installedMods: installedModsRef.current,
          plugins: []
        };
        const seeded = applyWorkspaceDelta(emptyState, delta, {
          expectedOperationId: operationId
        });
        if (seeded.status !== 'applied') {
          return null;
        }
        installWorkspaceDeltaState(seeded.state, project, true);
        return seeded.state;
      })
      .catch((error) => {
        void window.fluxora.ui.log({
          level: 'warning',
          category: 'WorkspaceDelta',
          message: `Could not establish the workspace delta baseline: ${errorMessage(error)}`,
          operationId
        });
        return null;
      })
      .finally(() => {
        if (workspaceDeltaSeedRef.current?.promise === promise) {
          workspaceDeltaSeedRef.current = null;
        }
      });
    workspaceDeltaSeedRef.current = { scopeKey, promise };
    return promise;
  };

  const applyIncomingWorkspaceDelta = (
    delta: FluxoraWorkspaceDelta,
    expectedOperationId?: string,
    urgent = false
  ): boolean => {
    const current = workspaceDeltaStateRef.current;
    const scope = selectedWorkspaceScopeRef.current;
    const project =
      scope.project?.projectDirectory === delta.projectDirectory
        ? scope.project
        : null;
    if (!current || !project) {
      if (project) {
        queueWorkspaceFullResyncRef.current(
          project,
          delta.profileName,
          'missing-delta-baseline'
        );
      }
      return false;
    }

    const applied = measureListPerformanceStage(
      'workspace-delta:apply',
      () => applyWorkspaceDelta(current, delta, { expectedOperationId })
    );
    if (applied.status === 'applied') {
      installWorkspaceDeltaState(applied.state, project, urgent);
      return true;
    }
    if (applied.status === 'ignored') {
      return true;
    }
    queueWorkspaceFullResyncRef.current(project, delta.profileName, applied.reason);
    return false;
  };
  applyIncomingWorkspaceDeltaRef.current = applyIncomingWorkspaceDelta;

  const reconcileWorkspaceOrderMutation = async (
    project: FluxoraProject,
    profileName: string,
    operationId: string,
    isCurrent: () => boolean
  ): Promise<void> => {
    const baseline = workspaceDeltaStateRef.current;
    if (
      baseline?.projectDirectory !== project.projectDirectory ||
      baseline.profileName !== profileName
    ) {
      return;
    }

    try {
      const delta = await window.fluxora.workspace.getDelta(
        project.projectDirectory,
        profileName,
        baseline.revision,
        {
          operationId,
          templateId: project.templateId
        }
      );
      if (!isCurrent()) {
        return;
      }
      applyIncomingWorkspaceDelta(delta, operationId, true);
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      void window.fluxora.ui.log({
        level: 'warning',
        category: 'WorkspaceDelta',
        message: `Could not reconcile the workspace after an order mutation: ${errorMessage(error)}`,
        operationId
      });
      queueWorkspaceFullResyncRef.current(
        project,
        profileName,
        'order-mutation-reconciliation-failed'
      );
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
    const clientRevisionAtStart = modOrderClientRevisionRef.current;
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
      setModsBusyLabel(t('app.busy.loadingMods'));
      setMessage(null);
    }

    try {
      const getWorkspace = options.persistedSnapshot
        ? window.fluxora.mods.getPersistedWorkspace
        : window.fluxora.mods.getWorkspace;
      let { installedMods: nextInstalledMods, modOrder: nextOrder } =
        await workspaceOrderMutationGate.readStable(() =>
          getWorkspace(project.projectDirectory, profileName, { operationId })
        );
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
          await workspaceOrderMutationGate.readStable(() =>
            window.fluxora.mods.getWorkspace(project.projectDirectory, profileName, {
              operationId
            })
          ));
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

      const activeReorder = rowReorderSessionRef.current;
      if (
        modOrderClientRevisionRef.current !== clientRevisionAtStart ||
        (activeReorder?.kind === 'mod' && activeReorder.active) ||
        pendingModOrderSavesRef.current.size > 0
      ) {
        return false;
      }

      setInstalledMods(nextInstalledMods);
      modsWorkspaceProjectIdRef.current = project.id;
      dispatchModsWorkspace({
        type: 'items-loaded',
        items: pendingInstallOrchestrator.mergeAuthoritativeItems(nextOrder),
        collapsedSeparatorOrderIds: loadCollapsedSeparatorOrderIds(
          window.localStorage,
          project.id,
          'mods'
        )
      });
      if (resetScroll) {
        modListVirtualizerRef.current?.scrollTo(0);
      }
      setDraggedModOrderIds(new Set<string>());
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
      return false;
    }

    const operationId = createRendererOperationId('mods_file_tree');
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
      return true;
    } catch (error) {
      setFileTreeState('error');
      setMessage(errorMessage(error));
      return false;
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

    setMessage(t('app.message.savingOrder'));
    const results = await Promise.allSettled(pendingSaves);
    return results.every((result) => result.status === 'fulfilled');
  };

  const waitForPendingOrderSavesQuietly = async (): Promise<void> => {
    while (true) {
      const pendingSaves = [
        ...Array.from(pendingModOrderSavesRef.current),
        ...Array.from(pendingPluginOrderSavesRef.current)
      ];
      if (pendingSaves.length === 0) {
        return;
      }

      await Promise.allSettled(pendingSaves);
    }
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
    if (
      !selectedProject ||
      !item.isMod ||
      item.isEnabled === isEnabled ||
      pendingInstallOrchestrator.isActiveOrderItem(item)
    ) {
      return;
    }

    const project = selectedProject;
    const profileName = modWorkspaceProfileName;
    const orderId = item.orderId;
    const previousEnabled = item.isEnabled;
    const optimisticItems = modsWorkspace.items.map((candidate) =>
      candidate.isMod && candidate.orderId === orderId
        ? { ...candidate, isEnabled }
        : candidate
    );
    const sequence = modEnableSaveSequenceRef.current + 1;
    modEnableSaveSequenceRef.current = sequence;
    latestModEnableSequenceByOrderIdRef.current.set(orderId, sequence);

    setMessage(null);
    dispatchModsWorkspace({ type: 'item-enabled-set', orderId, isEnabled });
    updateInstalledModEnabled(item.id, isEnabled);

    const operationId = createRendererOperationId('mods_set_enabled');
    const save = workspaceOrderMutationGate.enqueue(async (isCurrent) => {
      await window.fluxora.mods.setEnabled(project.projectDirectory, item.id, isEnabled, {
        operationId
      });
      if (isCurrent()) {
        await pendingInstallOrchestrator.rebase(
          project.projectDirectory,
          optimisticItems,
          false
        );
      }
    }, (isCurrent) =>
      reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
    );
    trackModOrderSave(save);

    try {
      await save;
      if (pluginCapabilities.bridgeAvailable && pluginCapabilities.projectSupported) {
        await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
      }
      if (latestModEnableSequenceByOrderIdRef.current.get(orderId) === sequence) {
        await loadModsWorkspace(project, backgroundReorderLoadOptions);
      }
    } catch (error) {
      if (latestModEnableSequenceByOrderIdRef.current.get(orderId) === sequence) {
        dispatchModsWorkspace({ type: 'item-enabled-set', orderId, isEnabled: previousEnabled });
        updateInstalledModEnabled(item.id, previousEnabled);
        setMessage(t('app.message.toggleModFailed', {
          action: t(isEnabled ? 'app.ui.enable' : 'app.ui.disable').toLocaleLowerCase(appLocale),
          name: modItemTitle(item, appLocale),
          error: errorMessage(error)
        }));
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
    const profileName = modWorkspaceProfileName;
    const previousItems = modsWorkspace.items;
    const previousInstalledMods = installedMods;
    const optimisticItems = modsWorkspace.items.map((item) =>
      item.isMod && !item.orderId.startsWith('pending-install:')
        ? { ...item, isEnabled }
        : item
    );
    const sequence = modBulkEnableSequenceRef.current + 1;
    modBulkEnableSequenceRef.current = sequence;

    setMessage(null);
    dispatchModsWorkspace({ type: 'items-loaded', items: optimisticItems });
    updateAllInstalledModsEnabled(isEnabled);

    const operationId = createRendererOperationId('mods_set_all_enabled');
    const save = workspaceOrderMutationGate.enqueue(async (isCurrent) => {
      await window.fluxora.mods.setAllEnabled(project.projectDirectory, isEnabled, {
        operationId
      });
      if (isCurrent()) {
        await pendingInstallOrchestrator.rebase(
          project.projectDirectory,
          optimisticItems,
          false
        );
      }
    }, (isCurrent) =>
      reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
    );
    trackModOrderSave(save);

    try {
      await save;
      if (
        modBulkEnableSequenceRef.current === sequence &&
        pluginCapabilities.bridgeAvailable &&
        pluginCapabilities.projectSupported
      ) {
        await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
      }
      if (modBulkEnableSequenceRef.current === sequence) {
        await loadModsWorkspace(project, backgroundReorderLoadOptions);
      }
    } catch (error) {
      if (modBulkEnableSequenceRef.current === sequence) {
        dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
        setInstalledMods(previousInstalledMods);
        setMessage(t('app.message.toggleAllModsFailed', {
          action: t(isEnabled ? 'app.ui.enable' : 'app.ui.disable').toLocaleLowerCase(appLocale),
          error: errorMessage(error)
        }));
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

    const operationId = createRendererOperationId('plugins_set_all_enabled');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
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
        if (isCurrent()) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(confirmedOrder, contextKey, sequence)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch(async (error) => {
        let shouldRevert = false;
        targetItems.forEach((candidate) => {
          if (revertLatestPluginEnableSave(candidate.orderId, sequence)) {
            shouldRevert = true;
          }
        });

        if (shouldRevert) {
          dispatchPluginsWorkspace({ type: 'items-loaded', items: previousItems });
          setMessage(t('app.message.toggleAllPluginsFailed', {
            action: t(isEnabled ? 'app.ui.enable' : 'app.ui.disable').toLocaleLowerCase(appLocale),
            error: errorMessage(error)
          }));
          await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
        }
      });
    trackPluginOrderSave(save);
    await save;
  };

  const setSelectedPluginsEnabled = async (isEnabled: boolean) => {
    if (
      !selectedProject ||
      !pluginCapabilities.bridgeAvailable ||
      !pluginCapabilities.projectSupported
    ) {
      return;
    }

    const targetItems = pluginsWorkspace.items.filter(
      (candidate) =>
        candidate.isPlugin &&
        pluginsWorkspace.selectedOrderIds.has(candidate.orderId) &&
        !candidate.isLocked &&
        candidate.isEnabled !== isEnabled
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
    targetItems.forEach((candidate) => {
      dispatchPluginsWorkspace({
        type: 'item-enabled-set',
        orderId: candidate.orderId,
        isEnabled
      });
    });

    const operationId = createRendererOperationId('plugins_set_selected_enabled');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
        let confirmedOrder = previousItems;
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

        targetItems.forEach((candidate) =>
          completeLatestPluginEnableSave(candidate.orderId, sequence)
        );
        if (isCurrent()) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(confirmedOrder, contextKey, sequence)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch(async (error) => {
        let shouldRevert = false;
        targetItems.forEach((candidate) => {
          if (revertLatestPluginEnableSave(candidate.orderId, sequence)) {
            shouldRevert = true;
          }
        });

        if (shouldRevert) {
          dispatchPluginsWorkspace({ type: 'items-loaded', items: previousItems });
          const targetLabel =
            targetItems.length === 1 ? pluginItemTitle(targetItems[0], appLocale) : t('app.ui.selectedPlugins');
          setMessage(
            t('app.message.togglePluginFailed', {
              action: t(isEnabled ? 'app.ui.enable' : 'app.ui.disable').toLocaleLowerCase(appLocale),
              name: targetLabel,
              error: errorMessage(error)
            })
          );
          await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
        }
      });
    trackPluginOrderSave(save);
    await save;
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
    const movesPendingInstall = pendingInstallOrchestrator.isActiveOrderItem(item);

    setMessage(null);
    modOrderClientRevisionRef.current += 1;
    dispatchModsWorkspace({
      type: 'items-reordered',
      orderId: item.orderId,
      targetIndex
    });

    const operationId = createRendererOperationId('mods_reorder');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
        if (movesPendingInstall) {
          if (isCurrent()) {
            await pendingInstallOrchestrator.rebase(
              project.projectDirectory,
              optimisticItems,
              true
            );
          }
          return;
        }

        const confirmedOrder = await window.fluxora.mods.moveOrderItem(
          project.projectDirectory,
          profileName,
          item.orderId,
          targetIndex,
          { operationId }
        );
        if (!isCurrent()) {
          return;
        }
        const orderWithPendingInstall = pendingInstallOrchestrator.mergeAuthoritativeItems(
          confirmedOrder
        );
        await pendingInstallOrchestrator.rebase(
          project.projectDirectory,
          orderWithPendingInstall,
          false
        );

        if (modOrderSaveSequenceRef.current === sequence) {
          modOrderClientRevisionRef.current += 1;
          dispatchModsWorkspace({
            type: 'items-loaded',
            items: pendingInstallOrchestrator.mergeAuthoritativeItems(confirmedOrder)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch((error) => {
        const message = errorMessage(error);
        setMessage(t('app.message.saveModOrderFailed', { error: message }));
        if (modOrderSaveSequenceRef.current === sequence) {
          modOrderClientRevisionRef.current += 1;
          dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
          void pendingInstallOrchestrator.rebase(
            project.projectDirectory,
            previousItems,
            false
          ).catch(() => undefined);
          window.setTimeout(() => {
            void loadModsWorkspace(project, backgroundReorderLoadOptions);
          }, 0);
        }
        throw error;
      });

    trackModOrderSave(save);
  };

  const moveModOrderItemSelectionToOrder = async (
    movingOrderIds: ReadonlySet<string>,
    optimisticItems: FluxoraModOrderItem[]
  ) => {
    if (!selectedProject) {
      return;
    }

    const previousItems = modsWorkspace.items;
    const isPendingItem = (candidate: FluxoraModOrderItem) =>
      pendingInstallOrchestrator.isActiveOrderItem(candidate);
    const persistentItems = previousItems.filter((candidate) => !isPendingItem(candidate));
    const persistentOptimisticItems = optimisticItems.filter(
      (candidate) => !isPendingItem(candidate)
    );
    const persistentMovingOrderIds = new Set(
      persistentItems
        .filter((candidate) => movingOrderIds.has(candidate.orderId))
        .map((candidate) => candidate.orderId)
    );
    const movePlan = modOrderItemMovePlan(
      persistentItems,
      persistentOptimisticItems,
      persistentMovingOrderIds
    );
    const movesPendingInstall = previousItems.some(
      (candidate) => movingOrderIds.has(candidate.orderId) && isPendingItem(candidate)
    );
    if (!movePlan || (movePlan.length === 0 && !movesPendingInstall)) {
      return;
    }

    const sequence = modOrderSaveSequenceRef.current + 1;
    modOrderSaveSequenceRef.current = sequence;
    const project = selectedProject;
    const profileName = modWorkspaceProfileName;

    setMessage(null);
    modOrderClientRevisionRef.current += 1;
    dispatchModsWorkspace({ type: 'items-loaded', items: optimisticItems });

    const operationId = createRendererOperationId('mods_reorder');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
        if (movesPendingInstall && isCurrent()) {
          await pendingInstallOrchestrator.rebase(
            project.projectDirectory,
            optimisticItems,
            true
          );
        }

        let confirmedOrder = persistentItems;
        for (const move of movePlan) {
          confirmedOrder = await window.fluxora.mods.moveOrderItem(
            project.projectDirectory,
            profileName,
            move.orderId,
            move.targetIndex,
            { operationId }
          );
        }

        if (movePlan.length === 0) {
          return;
        }
        if (!isCurrent()) {
          return;
        }

        const orderWithPendingInstall = pendingInstallOrchestrator.mergeAuthoritativeItems(
          confirmedOrder
        );
        await pendingInstallOrchestrator.rebase(
          project.projectDirectory,
          orderWithPendingInstall,
          false
        );

        if (modOrderSaveSequenceRef.current === sequence) {
          modOrderClientRevisionRef.current += 1;
          dispatchModsWorkspace({
            type: 'items-loaded',
            items: pendingInstallOrchestrator.mergeAuthoritativeItems(confirmedOrder)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch((error) => {
        const message = errorMessage(error);
        setMessage(t('app.message.saveModOrderFailed', { error: message }));
        if (modOrderSaveSequenceRef.current === sequence) {
          modOrderClientRevisionRef.current += 1;
          dispatchModsWorkspace({ type: 'items-loaded', items: previousItems });
          void pendingInstallOrchestrator.rebase(
            project.projectDirectory,
            previousItems,
            false
          ).catch(() => undefined);
          window.setTimeout(() => {
            void loadModsWorkspace(project, backgroundReorderLoadOptions);
          }, 0);
        }
        throw error;
      });

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
      return t('app.message.separatorNameRequired');
    }

    if (title.length > MOD_CREATION_NAME_MAX_LENGTH) {
      return t('app.message.separatorNameTooLong', { count: MOD_CREATION_NAME_MAX_LENGTH });
    }

    return '';
  };

  const createModSeparator = async (title: string) => {
    if (!selectedProject) {
      return;
    }

    const project = selectedProject;
    const profileName = modWorkspaceProfileName;
    const operationId = createRendererOperationId('mods_create_separator');
    setIsCreatingModSeparator(true);
    setMessage(null);

    try {
      await workspaceOrderMutationGate.enqueue(async (isCurrent) => {
        const result = await createModSeparatorAtEnd({
          createSeparator: (separatorTitle, targetIndex) =>
            window.fluxora.mods.createSeparator(
              project.projectDirectory,
              profileName,
              separatorTitle,
              targetIndex,
              { operationId }
            ),
          items: modsWorkspace.items,
          title
        });
        if (isCurrent()) {
          const items = pendingInstallOrchestrator.mergeAuthoritativeItems(result.items);
          dispatchModsWorkspace({ type: 'items-loaded', items });
          dispatchModsWorkspace({
            type: 'item-reveal-requested',
            orderId: result.separatorOrderId
          });
          requestPostInstallModReveal({
            animate: true,
            installedId: result.separatorOrderId,
            installedName: title,
            orderId: result.separatorOrderId
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      );
    } catch (error) {
      await loadModsWorkspace(project, {
        ...backgroundReorderLoadOptions,
        resetScroll: false
      });
      setMessage(t('app.message.createSeparatorFailed', { error: errorMessage(error) }));
    } finally {
      setIsCreatingModSeparator(false);
    }
  };

  const requestDeleteModSeparatorSelection = (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isSeparator || modsActionsBusy) {
      return;
    }

    const separatorOrderIds = separatorDeletionOrderIds(
      modsWorkspace.items,
      modsWorkspace.selectedOrderIds,
      item.orderId
    );
    if (separatorOrderIds.length === 0) {
      return;
    }

    setDeletionConfirmation({
      kind: 'separator',
      itemName: modItemTitle(item, appLocale),
      itemCount: separatorOrderIds.length,
      onConfirm: () => deleteModSeparators(separatorOrderIds)
    });
  };

  const deleteModSeparators = async (separatorOrderIds: readonly string[]) => {
    if (!selectedProject || separatorOrderIds.length === 0) {
      return;
    }

    const project = selectedProject;
    const profileName = modWorkspaceProfileName;
    const previousItems = modsWorkspace.items;
    const removedOrderIds = new Set(separatorOrderIds);
    const operationId = createRendererOperationId('mods_delete_separator');

    setIsDeletingModSeparators(true);
    setMessage(null);
    dispatchModsWorkspace({
      type: 'items-loaded',
      items: removeModOrderItems(previousItems, removedOrderIds)
    });

    try {
      await workspaceOrderMutationGate.enqueue(
        async () =>
          deleteSeparatorSelection(separatorOrderIds, (separatorOrderId) =>
            window.fluxora.mods.deleteSeparator(
              project.projectDirectory,
              profileName,
              separatorOrderId,
              { operationId }
            )
          ),
        (isCurrent) =>
          reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      );
      await loadModsWorkspace(project, backgroundReorderLoadOptions);
    } catch (error) {
      await loadModsWorkspace(project, backgroundReorderLoadOptions);
      setMessage(t('app.message.deleteSeparatorsFailed', { error: errorMessage(error) }));
    } finally {
      setIsDeletingModSeparators(false);
    }
  };

  const removeDeletedModItems = (items: FluxoraModOrderItem[]) => {
    const removedOrderIds = new Set(items.map((mod) => mod.orderId));
    const removedModIds = new Set(items.map((mod) => mod.id));

    modOrderClientRevisionRef.current += 1;
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
    if (pluginCapabilities.bridgeAvailable && pluginCapabilities.projectSupported) {
      await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
    }
    await loadModsWorkspace(project, backgroundReorderLoadOptions);
  };

  const createEmptyMod = async (modName: string) => {
    if (!selectedProject) {
      return;
    }

    const project = selectedProject;
    const profileName = modWorkspaceProfileName;
    await runModMutation(t('app.busy.creatingEmptyMod'), (operationId) =>
      workspaceOrderMutationGate.enqueue(
        async () =>
          window.fluxora.mods.createEmpty(project.projectDirectory, modName, {
            operationId
          }),
        (isCurrent) =>
          reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
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
        ? validateInstallModName(name, appLocale)
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

  const rejectDeletionWhileInstallActive = (items: FluxoraModOrderItem[]) => {
    const activeTarget = items.find((item) =>
      Boolean(pendingInstallOrchestrator.activeSessionForItem(item))
    );
    if (!activeTarget) {
      return false;
    }

    setDeletionConfirmation(null);
      setMessage(t('app.message.deleteInstallingMod', {
        name: modItemTitle(activeTarget, appLocale)
      }));
    return true;
  };

  const requestDeleteInstalledMod = (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    const targets = modDeletionItemsFor(item);
    if (targets.length === 0) {
      return;
    }
    if (rejectDeletionWhileInstallActive(targets)) {
      return;
    }

    const deletedModTitle = modItemTitle(targets[0] ?? item, appLocale);
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
    if (rejectDeletionWhileInstallActive([item])) {
      return;
    }

    const project = selectedProject;
    const profileName = modWorkspaceProfileName;
    const previousItems = modsWorkspace.items;
    const previousInstalledMods = installedMods;
    const deletedModTitle = modItemTitle(item, appLocale);

    const operationId = createRendererOperationId('mods_delete');
    setMessage(null);
    removeDeletedModItems([item]);

    try {
      await workspaceOrderMutationGate.enqueue(
        async () =>
          window.fluxora.mods.deleteInstalled(project.projectDirectory, item.id, {
            operationId
          }),
        (isCurrent) =>
          reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      );
      await refreshAfterModDeletion(project);
    } catch (error) {
      restoreDeletedModItems(previousItems, previousInstalledMods);
      setMessage(t('app.message.deleteModFailed', {
        name: deletedModTitle,
        error: errorMessage(error)
      }));
    }
  };

  const deleteInstalledMods = async (items: FluxoraModOrderItem[]) => {
    const targets = items.filter((item) => item.isMod);
    if (!selectedProject || targets.length === 0) {
      return;
    }
    if (rejectDeletionWhileInstallActive(targets)) {
      return;
    }

    if (targets.length === 1) {
      await deleteInstalledMod(targets[0]!);
      return;
    }

    const project = selectedProject;
    const profileName = modWorkspaceProfileName;
    const operationId = createRendererOperationId('mods_delete_bulk');
    const previousItems = modsWorkspace.items;
    const previousInstalledMods = installedMods;
    setMessage(null);
    removeDeletedModItems(targets);

    try {
      await workspaceOrderMutationGate.enqueue(
        async () => {
          for (let index = 0; index < targets.length; index += 1) {
            const item = targets[index]!;
            await window.fluxora.mods.deleteInstalled(project.projectDirectory, item.id, {
              operationId
            });
          }
        },
        (isCurrent) =>
          reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      );

      await refreshAfterModDeletion(project);
    } catch (error) {
      restoreDeletedModItems(previousItems, previousInstalledMods);
      setMessage(t('app.message.deleteModsFailed', { error: errorMessage(error) }));
    }
  };

  const openInstalledMod = async (item: FluxoraModOrderItem) => {
    if (!item.isMod) {
      return;
    }

    const result = await window.fluxora.shell.openPath(item.id);
    if (!result.ok) {
      setMessage(result.message ?? t('app.message.modFolderOpenFailed'));
    }
  };

  const openInstalledModSource = async (item: FluxoraModOrderItem) => {
    const sourcePageUrl = resolveModSourcePageUrl(item);
    if (!sourcePageUrl) {
      setMessage(t('app.message.sourceUnavailable', { name: modItemTitle(item, appLocale) }));
      return;
    }

    const result = await window.fluxora.links.openExternal(sourcePageUrl);
    if (!result.ok) {
      setMessage(t('app.message.sourceOpenFailed'));
    }
  };

  const openPluginInExplorer = async (item: FluxoraPluginOrderItem) => {
    if (!item.isPlugin) {
      return;
    }

    const path = item.path?.trim();

    if (!path) {
      setMessage(t('app.message.pluginLocationMissing', { name: pluginItemTitle(item, appLocale) }));
      return;
    }

    const result = await window.fluxora.shell.showItemInFolder(path);
    if (!result.ok) {
      setMessage(result.message ?? t('app.message.pluginLocationOpenFailed'));
    }
  };

  const preloadModDetailsContent = (
    item: FluxoraModOrderItem,
    project: FluxoraProject | null = selectedProject
  ): Promise<FluxoraModDetailsContent> => {
    if (!project || !item.isMod) {
      return Promise.reject(new Error(t('app.error.modDetailsRequiresBuild')));
    }

    const cacheKey = modDetailsContentCacheKey(project.projectDirectory, item.id);
    return modDetailsContentCacheRef.current.load(cacheKey, () =>
      window.fluxora.mods.getModDetailsContent(project.projectDirectory, item.id, {
        operationId: createRendererOperationId('mods_details_content')
      })
    );
  };

  const openModDetailsWindow = async (
    item: FluxoraModOrderItem,
    highlightRelativePath?: string
  ) => {
    if (!selectedProject || !item.isMod) {
      return;
    }

    try {
      const content = await preloadModDetailsContent(item, selectedProject);
      const preloadedFileTree = modDetailsContentFileTree(content);
      const bootstrapKey = createRendererOperationId('mod_details_bootstrap');
      const bootstrap: FluxoraModDetailsBootstrap = {
        key: bootstrapKey,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        projectDirectory: selectedProject.projectDirectory,
        configPath: selectedProject.configPath,
        profileName: modWorkspaceProfileName,
        modPath: item.id,
        item,
        rootFileTree: preloadedFileTree[''],
        content,
        highlightRelativePath,
        createdAt: Date.now()
      };
      writeModDetailsBootstrap({
        ...bootstrap
      });
      await window.fluxora.windowControls.openModDetails(
        selectedProject.configPath,
        item.id,
        modItemTitle(item, appLocale),
        modWorkspaceProfileName,
        bootstrapKey,
        bootstrap
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const openOverwriteFolder = async () => {
    const path = selectedProject?.paths?.overwriteDirectory;
    if (!path) {
      setMessage(t('app.message.overwriteMissing'));
      return;
    }

    const result = await window.fluxora.shell.openPath(path);
    if (!result.ok) {
      setMessage(result.message ?? t('app.message.overwriteOpenFailed'));
    }
  };

  const clearOverwriteFolder = async () => {
    if (!selectedProject) {
      return;
    }

    const path = selectedProject.paths?.overwriteDirectory;
    if (!path) {
      setMessage(t('app.message.overwriteMissing'));
      return;
    }

    if (!window.confirm(t('app.message.overwriteClearConfirm', { path }))) {
      return;
    }

    const operationId = createRendererOperationId('mods_clear_overwrite');
    overwriteClearOperationIdRef.current = operationId;
    setOverwriteClearSplash({
      operationId,
      buildName: selectedProject.name,
      progress: 6
    });
    setModsBusyLabel(t('app.busy.clearingOverwrite'));
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

    const project = selectedProject;
    const operationId = createRendererOperationId('mods_check_updates_manual');
    setMessage(null);
    setManualModUpdateSplash(
      createModUpdateCheckSplashState(operationId, bridgeStatus?.language ?? 'en-US')
    );

    try {
      const result = await modUpdateCoordinator.checkManual(
        project.projectDirectory,
        operationId
      );
      const transientMessage = modUpdateTransientMessage(result, bridgeStatus?.language);
      if (transientMessage) {
        setManualModUpdateNotice(transientMessage);
        if (manualModUpdateNoticeTimerRef.current !== null) {
          window.clearTimeout(manualModUpdateNoticeTimerRef.current);
        }
        manualModUpdateNoticeTimerRef.current = window.setTimeout(() => {
          setManualModUpdateNotice((current) => current === transientMessage ? null : current);
          manualModUpdateNoticeTimerRef.current = null;
        }, 5_000);
      }
      await loadModsWorkspace(project);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setManualModUpdateSplash((current) =>
        current?.operationId === operationId ? null : current
      );
    }
  };

  const toggleFileTreeDirectory = async (entry: FluxoraModFileTreeEntry) => {
    if (!entry.isDirectory || !entry.hasChildren) {
      return;
    }

    const isExpanded = Boolean(expandedFileTree[entry.relativePath]);
    if (isExpanded) {
      setExpandedFileTree((current) => ({ ...current, [entry.relativePath]: false }));
      return;
    }

    const item =
      selectedModItem?.isMod
        ? selectedModItem
        : isModDetailsWindow && modDetailsSummary?.isMod
          ? modDetailsSummary
          : null;
    if (!fileTreeCache[entry.relativePath]) {
      const loaded = await loadModFileTree(entry.relativePath, item);
      if (!loaded) {
        return;
      }
    }

    setExpandedFileTree((current) => ({ ...current, [entry.relativePath]: true }));
  };

  const openTextEditorForFile = async (entry: FluxoraModFileTreeEntry) => {
    const item =
      selectedModItem?.isMod
        ? selectedModItem
        : isModDetailsWindow && modDetailsSummary?.isMod
          ? modDetailsSummary
          : null;
    const configPath = selectedProject?.configPath ?? initialModDetailsBootstrap?.configPath ?? '';
    const projectDirectory =
      selectedProject?.projectDirectory ?? initialModDetailsBootstrap?.projectDirectory ?? '';
    if (
      !configPath ||
      !projectDirectory ||
      !item?.isMod ||
      entry.isDirectory ||
      !isTextEditorFileName(entry.name)
    ) {
      return;
    }

    try {
      await window.fluxora.windowControls.openTextEditor(
        configPath,
        projectDirectory,
        item.id,
        entry.relativePath,
        entry.name
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const openFilePreviewForFile = async (entry: FluxoraModFileTreeEntry) => {
    const previewKind = previewKindForFile(entry.name);
    const item =
      selectedModItem?.isMod
        ? selectedModItem
        : isModDetailsWindow && modDetailsSummary?.isMod
          ? modDetailsSummary
          : null;
    const configPath = selectedProject?.configPath ?? initialModDetailsBootstrap?.configPath ?? '';
    const projectDirectory =
      selectedProject?.projectDirectory ?? initialModDetailsBootstrap?.projectDirectory ?? '';
    if (
      !configPath ||
      !projectDirectory ||
      !item?.isMod ||
      entry.isDirectory ||
      previewKind === null
    ) {
      return;
    }

    try {
      await window.fluxora.windowControls.openFilePreview(
        configPath,
        projectDirectory,
        item.id,
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
    const capabilities = pluginCapabilityView(project, bridgeStatus, appLocale);
    if (!project || !bridgeStatus?.ready) {
      return false;
    }

    if (!capabilities.bridgeAvailable) {
      pluginsWorkspaceProjectIdRef.current = project.id;
      dispatchPluginsWorkspace({ type: 'items-loaded', items: [] });
      setDraggedPluginOrderIds(new Set<string>());
      setPluginDropTarget(null);
      return true;
    }

    if (!capabilities.projectSupported) {
      pluginsWorkspaceProjectIdRef.current = project.id;
      dispatchPluginsWorkspace({ type: 'items-loaded', items: [] });
      setDraggedPluginOrderIds(new Set<string>());
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
      setPluginsBusyLabel(t('app.busy.loadingPlugins'));
      setMessage(null);
    }

    try {
      const listPlugins = options.persistedSnapshot
        ? window.fluxora.plugins.listPersisted
        : window.fluxora.plugins.list;
      const nextPlugins = await workspaceOrderMutationGate.readStable(() =>
        listPlugins(
          project.projectDirectory,
          project.templateId,
          profileName,
          {
            operationId,
            ...(options.forcePluginDiscoveryRefresh
              ? { forceDiscoveryRefresh: true }
              : {})
          }
        )
      );
      if (!isCurrentWorkspaceStoreLoad('plugins', loadSequence)) {
        return false;
      }
      pluginsWorkspaceProjectIdRef.current = project.id;
      dispatchPluginsWorkspace({
        type: 'items-loaded',
        items: applyPendingPluginEnableStates(nextPlugins, contextKey, snapshotSequence),
        collapsedSeparatorOrderIds: loadCollapsedSeparatorOrderIds(
          window.localStorage,
          project.id,
          'plugins'
        )
      });
      if (resetScroll) {
        pluginListVirtualizerRef.current?.scrollTo(0);
      }
      setDraggedPluginOrderIds(new Set<string>());
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

  const performWorkspaceFullResync = async (
    request: PendingWorkspaceFullResync
  ) => {
    if (workspaceFullResyncInFlightRef.current) {
      pendingWorkspaceFullResyncRef.current ??= request;
      return;
    }
    workspaceFullResyncInFlightRef.current = true;
    workspaceDeltaStateRef.current = null;
    const operationId = createRendererOperationId('workspace_delta_full_resync');
    try {
      const [modsLoaded, pluginsLoaded] = await Promise.all([
        loadModsWorkspace(request.project, {
          operationId,
          profileName: request.profileName,
          resetScroll: false,
          showBusy: false,
          showLoading: false
        }),
        loadPluginsWorkspace(request.project, {
          operationId,
          profileName: request.profileName,
          resetScroll: false,
          showBusy: false,
          showLoading: false
        })
      ]);
      if (modsLoaded && pluginsLoaded) {
        await ensureWorkspaceDeltaBaseline(
          request.project,
          request.profileName,
          operationId,
          true
        );
      }
      void window.fluxora.ui.log({
        level: modsLoaded && pluginsLoaded ? 'info' : 'warning',
        category: 'WorkspaceDelta',
        message:
          `Completed one revision-gap workspace resync. reason=${request.reason} ` +
          `modsLoaded=${modsLoaded} pluginsLoaded=${pluginsLoaded}`,
        operationId
      });
    } finally {
      workspaceFullResyncInFlightRef.current = false;
      flushWorkspaceFullResyncRef.current();
    }
  };

  const flushWorkspaceFullResync = () => {
    if (
      workspaceFullResyncInFlightRef.current ||
      listScrollActivityRef.current.mods ||
      listScrollActivityRef.current.plugins
    ) {
      return;
    }
    const pending = pendingWorkspaceFullResyncRef.current;
    if (!pending) {
      return;
    }
    pendingWorkspaceFullResyncRef.current = null;
    void performWorkspaceFullResync(pending).catch((error) => {
      setMessage(t('app.message.workspaceResyncFailed', { error: errorMessage(error) }));
    });
  };
  flushWorkspaceFullResyncRef.current = flushWorkspaceFullResync;

  const queueWorkspaceFullResync = (
    project: FluxoraProject,
    profileName: string,
    reason: string
  ) => {
    const current = pendingWorkspaceFullResyncRef.current;
    if (
      !current ||
      current.project.projectDirectory !== project.projectDirectory ||
      current.profileName !== profileName
    ) {
      pendingWorkspaceFullResyncRef.current = { project, profileName, reason };
    }
    flushWorkspaceFullResync();
  };
  queueWorkspaceFullResyncRef.current = queueWorkspaceFullResync;

  const refreshWorkspaceDelta = async (
    project: FluxoraProject,
    profileName: string,
    operationId: string
  ): Promise<boolean> => {
    let baseline = workspaceDeltaStateRef.current;
    if (
      baseline?.projectDirectory !== project.projectDirectory ||
      baseline.profileName !== profileName
    ) {
      baseline = await ensureWorkspaceDeltaBaseline(
        project,
        profileName,
        operationId
      );
      return baseline !== null;
    }
    const delta = await workspaceOrderMutationGate.readStable(() =>
      window.fluxora.workspace.getDelta(
        project.projectDirectory,
        profileName,
        baseline.revision,
        {
          operationId,
          templateId: project.templateId
        }
      )
    );
    return applyIncomingWorkspaceDelta(delta, operationId, true);
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

    const operationId = createRendererOperationId('plugins_set_enabled');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
        const confirmedOrder = await window.fluxora.plugins.setEnabled(
          project.projectDirectory,
          project.templateId,
          profileName,
          item.name,
          isEnabled,
          { operationId }
        );

        if (completeLatestPluginEnableSave(orderId, sequence) && isCurrent()) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(confirmedOrder, contextKey, sequence)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch((error) => {
        if (revertLatestPluginEnableSave(orderId, sequence)) {
          dispatchPluginsWorkspace({
            type: 'item-enabled-set',
            orderId,
            isEnabled: previousEnabled
          });
        setMessage(t('app.message.togglePluginFailed', {
          action: t(isEnabled ? 'app.ui.enable' : 'app.ui.disable').toLocaleLowerCase(appLocale),
          name: pluginItemTitle(item, appLocale),
          error: errorMessage(error)
        }));
        }
      });
    trackPluginOrderSave(save);
    await save;
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

    const operationId = createRendererOperationId('plugins_reorder');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
        const confirmedOrder = await window.fluxora.plugins.move(
          project.projectDirectory,
          project.templateId,
          profileName,
          item.orderId,
          targetIndex,
          { operationId }
        );

        if (pluginOrderSaveSequenceRef.current === sequence && isCurrent()) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(confirmedOrder, contextKey, snapshotSequence)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch(async (error) => {
        const message = errorMessage(error);
        setMessage(t('app.message.savePluginOrderFailed', { error: message }));
        if (pluginOrderSaveSequenceRef.current === sequence) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(previousItems, contextKey, snapshotSequence)
          });
          await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
        }
        throw error;
      });

    trackPluginOrderSave(save);
  };

  const movePluginOrderItemSelectionToOrder = async (
    movingOrderIds: ReadonlySet<string>,
    optimisticItems: FluxoraPluginOrderItem[]
  ) => {
    if (!selectedProject || !pluginCapabilities.loadOrderSupported) {
      return;
    }

    const movePlan = pluginOrderItemMovePlan(
      pluginsWorkspace.items,
      optimisticItems,
      movingOrderIds
    );
    if (!movePlan || movePlan.length === 0) {
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
    dispatchPluginsWorkspace({ type: 'items-loaded', items: optimisticItems });

    const operationId = createRendererOperationId('plugins_reorder');
    const save = workspaceOrderMutationGate
      .enqueue(async (isCurrent) => {
        let confirmedOrder = previousItems;
        for (const move of movePlan) {
          confirmedOrder = await window.fluxora.plugins.move(
            project.projectDirectory,
            project.templateId,
            profileName,
            move.orderId,
            move.targetIndex,
            { operationId }
          );
        }

        if (pluginOrderSaveSequenceRef.current === sequence && isCurrent()) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(confirmedOrder, contextKey, snapshotSequence)
          });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
      .catch(async (error) => {
        const message = errorMessage(error);
        setMessage(t('app.message.savePluginOrderFailed', { error: message }));
        if (pluginOrderSaveSequenceRef.current === sequence) {
          dispatchPluginsWorkspace({
            type: 'items-loaded',
            items: applyPendingPluginEnableStates(previousItems, contextKey, snapshotSequence)
          });
          await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
        }
        throw error;
      });

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
    if (session?.kind === 'mod' && session.active) {
      const resolvers = Array.from(modOrderDragSettledResolversRef.current);
      modOrderDragSettledResolversRef.current.clear();
      resolvers.forEach((resolve) => resolve());
    }
    setDraggedModOrderIds(new Set<string>());
    setModDropTarget(null);
    setDraggedPluginOrderIds(new Set<string>());
    setPluginDropTarget(null);
    setDraggedDownloadInstallId(null);
    setDownloadInstallDropTarget(null);
    document.body.classList.remove('row-reorder-active');
    document.body.classList.remove('row-reorder-blocked');
  };

  const waitForActiveModOrderDragToSettle = async () => {
    const session = rowReorderSessionRef.current;
    if (session?.kind !== 'mod' || !session.active) {
      return;
    }

    await new Promise<void>((resolve) => {
      modOrderDragSettledResolversRef.current.add(resolve);
    });
  };

  const setRowDropTarget = (
    kind: RowReorderKind,
    target: RowDropTargetState | null
  ) => {
    if (kind === 'mod') {
      setModDropTarget(target);
      return;
    }

    if (kind === 'plugin') {
      setPluginDropTarget(target);
      return;
    }

    setDownloadInstallDropTarget(target);
  };

  const targetIndexForRowDrop = (
    kind: Exclude<RowReorderKind, 'download-install'>,
    sourceOrderId: string,
    targetOrderId: string,
    placement: OrderRowDropPlacement
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

  const reorderedItemsForRowDrop = (
    kind: Exclude<RowReorderKind, 'download-install'>,
    sourceOrderId: string,
    sourceOrderIds: readonly string[],
    targetOrderId: string,
    placement: OrderRowDropPlacement
  ): FluxoraModOrderItem[] | FluxoraPluginOrderItem[] | null =>
    kind === 'mod'
      ? reorderModOrderItemSelection(
          modsWorkspace.items,
          sourceOrderId,
          new Set(sourceOrderIds),
          targetOrderId,
          placement,
          modsWorkspace.collapsedSeparatorOrderIds
        )
      : reorderPluginOrderItemSelection(
          pluginsWorkspace.items,
          sourceOrderId,
          new Set(sourceOrderIds),
          targetOrderId,
          placement,
          pluginsWorkspace.collapsedSeparatorOrderIds
        );

  const applyRowReorderAutoScroll = (
    session: RowReorderSession,
    frameTime: number
  ): boolean => {
    const container = session.scrollContainer;
    if (!container) {
      session.lastFrameTime = null;
      return false;
    }

    const rect = container.getBoundingClientRect();
    if (
      session.kind === 'download-install' &&
      (session.currentX < rect.left || session.currentX > rect.right)
    ) {
      session.lastFrameTime = null;
      return false;
    }

    let pressure = 0;
    if (session.currentY < rect.top + rowReorderAutoScrollEdge) {
      pressure = -Math.min(
        1,
        (rect.top + rowReorderAutoScrollEdge - session.currentY) /
          rowReorderAutoScrollEdge
      );
    } else if (session.currentY > rect.bottom - rowReorderAutoScrollEdge) {
      pressure = Math.min(
        1,
        (session.currentY - (rect.bottom - rowReorderAutoScrollEdge)) /
          rowReorderAutoScrollEdge
      );
    }

    if (pressure === 0) {
      session.lastFrameTime = null;
      return false;
    }

    const elapsed =
      session.lastFrameTime === null
        ? rowReorderAutoScrollFrameMs
        : Math.min(rowReorderAutoScrollFrameMs * 2, Math.max(0, frameTime - session.lastFrameTime));
    session.lastFrameTime = frameTime;
    const previousScrollTop = container.scrollTop;
    container.scrollTop +=
      pressure * rowReorderAutoScrollMaxStep * (elapsed / rowReorderAutoScrollFrameMs);
    const didScroll = container.scrollTop !== previousScrollTop;
    if (!didScroll) {
      session.lastFrameTime = null;
    }
    return didScroll;
  };

  const resolveRowDropTarget = (session: RowReorderSession, frameTime: number) => {
    session.frameId = null;
    const didAutoScroll = applyRowReorderAutoScroll(session, frameTime);

    const element = document.elementFromPoint(session.currentX, session.currentY);
    const targetKind = session.kind === 'download-install' ? 'mod' : session.kind;
    const row =
      element instanceof Element
        ? element.closest<HTMLElement>(`[data-reorder-kind="${targetKind}"][data-order-id]`)
        : null;
    const targetOrderId = row?.dataset.orderId ?? null;
    const placement =
      row && !(session.kind === 'download-install' && row.dataset.overwrite === 'true')
        ? session.kind === 'download-install'
          ? downloadInstallDropPlacementFromPointer(
              row.getBoundingClientRect(),
              session.currentY,
              row.dataset.separator === 'true'
            )
          : rowDropPlacementFromPointer(row, session.currentY)
        : null;
    let reorderedItems: FluxoraModOrderItem[] | FluxoraPluginOrderItem[] | null = null;
    let blockedReason: string | null = null;
    if (
      session.kind !== 'download-install' &&
      targetOrderId &&
      placement &&
      placement !== 'inside'
    ) {
      if (session.kind === 'plugin') {
        const assessment = assessPluginOrderItemSelectionReorder(
          pluginsWorkspace.items,
          session.sourceOrderId,
          new Set(session.sourceOrderIds),
          targetOrderId,
          placement,
          pluginsWorkspace.collapsedSeparatorOrderIds,
          appLocale
        );
        reorderedItems = assessment.items;
        blockedReason = assessment.blockedReason;
      } else {
        reorderedItems = reorderedItemsForRowDrop(
          session.kind,
          session.sourceOrderId,
          session.sourceOrderIds,
          targetOrderId,
          placement
        );
      }
    }
    const nextTarget =
      targetOrderId &&
      placement &&
      (session.kind === 'download-install' || reorderedItems !== null || blockedReason)
        ? {
            orderId: targetOrderId,
            placement,
            ...(blockedReason ? { blockedReason } : {})
          }
        : null;

    const targetChanged = !(
      session.targetOrderId === (nextTarget?.orderId ?? null) &&
      session.placement === (nextTarget?.placement ?? null) &&
      session.blockedReason === (nextTarget?.blockedReason ?? null)
    );
    if (targetChanged) {
      session.targetOrderId = nextTarget?.orderId ?? null;
      session.placement = nextTarget?.placement ?? null;
      session.blockedReason = nextTarget?.blockedReason ?? null;
      document.body.classList.toggle('row-reorder-blocked', Boolean(nextTarget?.blockedReason));
      setRowDropTarget(session.kind, nextTarget);
    }

    if (
      didAutoScroll &&
      session.active &&
      rowReorderSessionRef.current === session
    ) {
      scheduleRowDropTargetResolve(session);
    }
  };

  const scheduleRowDropTargetResolve = (session: RowReorderSession) => {
    if (session.frameId !== null) {
      return;
    }

    session.frameId = window.requestAnimationFrame((frameTime) =>
      resolveRowDropTarget(session, frameTime)
    );
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

    const scrollContainer =
      kind === 'download-install'
        ? document.querySelector<HTMLElement>('.build-pane--mods .mod-list__body, .mods-surface .mod-list__body')
        : event.currentTarget.closest<HTMLElement>(
            kind === 'mod' ? '.mod-list__body' : '.mod-table__body'
          );
    if (rowReorderSessionRef.current) {
      clearRowReorderSession();
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sourceOrderIds =
      kind === 'mod' && modsWorkspace.selectedOrderIds.has(sourceOrderId)
        ? modsWorkspace.items
            .filter(
              (item) =>
                modsWorkspace.selectedOrderIds.has(item.orderId) && !isModOverwriteItem(item)
            )
            .map((item) => item.orderId)
        : kind === 'plugin' && pluginsWorkspace.selectedOrderIds.has(sourceOrderId)
          ? pluginsWorkspace.items
              .filter(
                (item) =>
                  pluginsWorkspace.selectedOrderIds.has(item.orderId) &&
                  canDragPluginOrderItem(pluginsWorkspace.items, item.orderId)
              )
              .map((item) => item.orderId)
          : [sourceOrderId];
    rowReorderSessionRef.current = {
      kind,
      pointerId: event.pointerId,
      sourceOrderId,
      sourceOrderIds,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      active: false,
      frameId: null,
      lastFrameTime: null,
      targetOrderId: null,
      placement: null,
      blockedReason: null,
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
        setDraggedModOrderIds(new Set(session.sourceOrderIds));
      } else if (session.kind === 'plugin') {
        setDraggedPluginOrderIds(new Set(session.sourceOrderIds));
      } else {
        setDraggedDownloadInstallId(session.sourceOrderId);
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
      resolveRowDropTarget(session, window.performance.now());
    }

    const targetOrderId = session.targetOrderId;
    const placement = session.placement;
    const sourceOrderId = session.sourceOrderId;
    const sourceOrderIds = session.sourceOrderIds;
    const kind = session.kind;
    const wasActive = session.active;
    const blockedReason = session.blockedReason;
    clearRowReorderSession();

    if (!wasActive) {
      return;
    }

    suppressNextRowClickRef.current = true;
    event.preventDefault();
    if (blockedReason) {
      return;
    }
    if (kind === 'download-install') {
      const entry = downloadsWorkspace.items.find((item) => item.id === sourceOrderId) ?? null;
      if (entry && targetOrderId && placement) {
        void installDownload(entry, { targetOrderId, placement });
      }
      return;
    }

    if (placement === 'inside') {
      return;
    }

    const optimisticItems =
      targetOrderId && placement
        ? reorderedItemsForRowDrop(
            kind,
            sourceOrderId,
            sourceOrderIds,
            targetOrderId,
            placement
          )
        : null;
    if (!optimisticItems) {
      return;
    }

    if (sourceOrderIds.length > 1) {
      const movingOrderIds = new Set(sourceOrderIds);
      if (kind === 'mod') {
        void moveModOrderItemSelectionToOrder(
          movingOrderIds,
          optimisticItems as FluxoraModOrderItem[]
        );
      } else {
        void movePluginOrderItemSelectionToOrder(
          movingOrderIds,
          optimisticItems as FluxoraPluginOrderItem[]
        );
      }
      return;
    }

    const targetIndex =
      targetOrderId && placement
        ? targetIndexForRowDrop(kind, sourceOrderId, targetOrderId, placement)
        : null;
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

    if (event.key === 'Delete' && item.isSeparator) {
      event.preventDefault();
      requestDeleteModSeparatorSelection(item);
      return;
    }

    if (event.key === 'Delete' && item.isMod) {
      event.preventDefault();
      requestDeleteInstalledMod(item);
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
      if (pendingInstallOrchestrator.activeSessionForItem(item)) {
        return;
      }
      if (!modsWorkspace.selectedOrderIds.has(item.orderId)) {
        dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
      }
      setModMenuPosition(
        rowContextMenuPositionFromAnchor(
          event.currentTarget.getBoundingClientRect(),
          modRowMenuEstimatedHeight(item, modsWorkspace.selectedOrderIds)
        )
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

    if (event.key === 'Delete' && item.isSeparator) {
      event.preventDefault();
      requestDeletePluginSeparatorSelection(item);
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

    if (event.key === 'Delete' && entry.canDelete && !downloadsActionsBusy) {
      event.preventDefault();
      requestDeleteDownload(entry);
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

  const openPluginSeparatorDialog = (item: FluxoraPluginOrderItem) => {
    if (!item.isPlugin || !pluginCapabilities.loadOrderSupported) {
      return;
    }

    const selectedOrderIds = pluginsWorkspace.selectedOrderIds.has(item.orderId)
      ? [...pluginsWorkspace.selectedOrderIds]
      : [item.orderId];
    setPluginSeparatorDialog({
      contextOrderId: item.orderId,
      name: '',
      selectedOrderIds,
      validationMessage: null
    });
  };

  const updatePluginSeparatorDialogName = (name: string) => {
    const limitedName = name.slice(0, PLUGIN_SEPARATOR_NAME_MAX_LENGTH);
    setPluginSeparatorDialog((current) =>
      current
        ? {
            ...current,
            name: limitedName,
            validationMessage: null
          }
        : current
    );
  };

  const submitPluginSeparatorDialog = async () => {
    if (!pluginSeparatorDialog || !selectedProject) {
      return;
    }

    const copy = pluginSeparatorCopy(bridgeStatus?.language);
    const title = pluginSeparatorDialog.name.trim();
    if (!title) {
      setPluginSeparatorDialog((current) =>
        current
          ? {
              ...current,
              validationMessage: copy.requiredMessage
            }
          : current
      );
      return;
    }

    const request = pluginSeparatorDialog;
    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const previousItems = pluginsWorkspace.items;
    setPluginSeparatorDialog(null);

    await runPluginMutation(copy.creatingLabel, (operationId) =>
      workspaceOrderMutationGate.enqueue(async (isCurrent) => {
        const result = await createPluginSeparatorForSelection({
          api: {
            createSeparator: (separatorTitle, targetIndex) =>
              window.fluxora.plugins.createSeparator(
                project.projectDirectory,
                project.templateId,
                profileName,
                separatorTitle,
                targetIndex,
                { operationId }
              ),
            deleteSeparator: (separatorOrderId) =>
              window.fluxora.plugins.deleteSeparator(
                project.projectDirectory,
                project.templateId,
                profileName,
                separatorOrderId,
                { operationId }
              ),
            move: (orderId, targetIndex) =>
              window.fluxora.plugins.move(
                project.projectDirectory,
                project.templateId,
                profileName,
                orderId,
                targetIndex,
                { operationId }
              )
          },
          contextOrderId: request.contextOrderId,
          items: previousItems,
          selectedOrderIds: new Set(request.selectedOrderIds),
          title
        });
        if (isCurrent()) {
          dispatchPluginsWorkspace({ type: 'items-loaded', items: result.items });
        }
      }, (isCurrent) =>
        reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      )
    );
  };

  const requestDeletePluginSeparatorSelection = (item: FluxoraPluginOrderItem) => {
    if (
      !selectedProject ||
      !item.isSeparator ||
      !pluginCapabilities.loadOrderSupported ||
      pluginsActionsBusy
    ) {
      return;
    }

    const separatorOrderIds = separatorDeletionOrderIds(
      pluginsWorkspace.items,
      pluginsWorkspace.selectedOrderIds,
      item.orderId
    );
    if (separatorOrderIds.length === 0) {
      return;
    }

    setDeletionConfirmation({
      kind: 'separator',
      itemName: pluginItemTitle(item, appLocale),
      itemCount: separatorOrderIds.length,
      onConfirm: () => deletePluginSeparators(separatorOrderIds)
    });
  };

  const deletePluginSeparators = async (separatorOrderIds: readonly string[]) => {
    if (!selectedProject || separatorOrderIds.length === 0) {
      return;
    }

    const project = selectedProject;
    const profileName = selectedProjectProfileName;
    const previousItems = pluginsWorkspace.items;
    const removedOrderIds = new Set(separatorOrderIds);
    const operationId = createRendererOperationId('plugins_delete_separator');

    setIsDeletingPluginSeparators(true);
    setMessage(null);
    dispatchPluginsWorkspace({
      type: 'items-loaded',
      items: previousItems.filter((candidate) => !removedOrderIds.has(candidate.orderId))
    });

    try {
      await workspaceOrderMutationGate.enqueue(
        async () =>
          deleteSeparatorSelection(separatorOrderIds, (separatorOrderId) =>
            window.fluxora.plugins.deleteSeparator(
              project.projectDirectory,
              project.templateId,
              profileName,
              separatorOrderId,
              { operationId }
            )
          ),
        (isCurrent) =>
          reconcileWorkspaceOrderMutation(project, profileName, operationId, isCurrent)
      );
      await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
    } catch (error) {
      await loadPluginsWorkspace(project, backgroundReorderLoadOptions);
      setMessage(t('app.message.deletePluginSeparatorsFailed', { error: errorMessage(error) }));
    } finally {
      setIsDeletingPluginSeparators(false);
    }
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
    const capabilities = profilesCapabilityView(project, bridgeStatus, appLocale);
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
      setProfilesBusyLabel(t('app.busy.loadingProfiles'));
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
      setMessage(t('app.message.profileNameRequired'));
      return;
    }

    await runProfileMutation(t('app.busy.profileCreated'), (operationId) =>
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
      setMessage(t('app.message.profileNameRequired'));
      return;
    }

    await runProfileMutation(t('app.busy.profileCloned'), (operationId) =>
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
      setMessage(t('app.message.defaultProfileRename'));
      return;
    }

    const profileName = profileDraftName.trim();
    if (!profileName || profileName === selectedProjectProfileName) {
      setMessage(
        profileName ? t('app.message.profileNameDifferent') : t('app.message.profileNameRequired')
      );
      return;
    }

    await runProfileMutation(t('app.busy.profileRenamed'), (operationId) =>
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
      setMessage(t('app.message.defaultProfileDelete'));
      return;
    }

    if (profileDeleteArmedName !== selectedProjectProfileName) {
      setProfileDeleteArmedName(selectedProjectProfileName);
      setMessage(t('app.message.profileDeleteAgain', { name: selectedProjectProfileName }));
      return;
    }

    await runProfileMutation(t('app.busy.profileDeleted'), (operationId) =>
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
      setMessage(t('app.message.profilesDirectoryMissing'));
      return;
    }

    const result = await window.fluxora.shell.openPath(path);
    if (!result.ok) {
      setMessage(result.message ?? t('app.message.profilesDirectoryOpenFailed'));
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
    const capabilities = executablesCapabilityView(project, bridgeStatus, appLocale);
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
      setExecutablesBusyLabel(t('app.busy.loadingExecutables'));
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
      setMessage(t('app.message.executablesSaved'));
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
      t('app.dialog.addExecutable'),
      selectedProject.gamePath
    );
    if (picked.canceled || !picked.path) {
      return;
    }

    const fileName = fileNameFromPath(picked.path);
    const displayName = fileName.replace(/\.[^.]+$/, '') || t('app.ui.executable');
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
      t('app.busy.addingExecutable'),
      picked.path
    );
  };

  const deleteExecutable = async () => {
    if (!selectedExecutableItem) {
      return;
    }

    if (executableDeleteArmedId !== selectedExecutableItem.id) {
      setExecutableDeleteArmedId(selectedExecutableItem.id);
      setMessage(t('app.message.executableDeleteAgain', {
        name: executableTitle(selectedExecutableItem, appLocale)
      }));
      return;
    }

    await saveExecutableList(
      executablesWorkspace.items.filter((entry) => entry.id !== selectedExecutableItem.id),
      t('app.busy.deletingExecutable')
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
      t('app.busy.savingExecutable'),
      selectedExecutableItem.id
    );
  };

  const browseExecutableForDraft = async () => {
    if (!executableDraft) {
      return;
    }

    const picked = await window.fluxora.dialogs.pickExecutable(
      t('app.dialog.selectExecutable'),
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
      t('app.dialog.selectWorkingDirectory'),
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
    setExecutablesBusyLabel(t('app.busy.resolvingIcon'));

    try {
      const result = await window.fluxora.executables.getIcon(executableDraft.executablePath, {
        operationId
      });
      setExecutableDraft((current) =>
        current ? { ...current, iconPath: result.iconPath } : current
      );
      setMessage(result.iconPath ? t('app.message.iconResolved') : t('app.message.iconNotResolved'));
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
    const managedDisplay = managedExecutableDisplay(
      selectedExecutableItem.managedToolKind,
      selectedProject.name,
      appLocale
    );
    const isManagedBodySlide = selectedExecutableItem.managedToolKind === 'bodySlide';
    let managedSessionId: string | undefined;
    let managedOutcome: 'completed' | 'failed' | 'watcher-error' = 'failed';
    let launchedResult: FluxoraExecutableLaunchResult | null = null;
    let trackedProcessLabel = selectedExecutableItem.displayName;
    setExecutablesBusyLabel(managedDisplay?.preparationLabel ?? t('app.message.launchingExecutable'));
    setExecutableLaunchResult(null);
    setLaunchSplash({
      operationId,
      appName: selectedExecutableItem.displayName,
      buildName: selectedProject.name,
      detail: managedDisplay?.preparationLabel ?? t('app.message.processStarting'),
      state: 'starting',
      subtitle: selectedProject.name,
      title: managedDisplay?.preparationLabel ?? t('app.message.processStarting')
    });
    setMessage(null);

    try {
      const result = await window.fluxora.executables.launch(
        selectedProject.configPath,
        selectedExecutableItem.id,
        selectedProjectProfileName,
        { operationId }
      );
      launchedResult = result;
      managedSessionId = result.managedSessionId;
      if (managedSessionId) {
        setExecutablesBusyLabel(t('app.busy.vfsLaunch'));
        setLaunchSplash((current) =>
          current?.operationId === operationId
            ? {
                ...current,
                detail: t('app.operation.vfsLaunch'),
                subtitle: result.outputMod?.displayName ?? selectedProject.name,
                title: t('app.operation.vfsLaunch')
              }
            : current
        );
      }
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
            ? t('app.message.processLaunchTimeout', { name: processName })
            : t('app.message.processExitedBeforeTracking', { name: processName });
        setMessage(reason);
        return;
      }

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
      const knownProcesses = [
        {
          displayName: result.displayName || selectedExecutableItem.displayName,
          executableName: fileNameFromPath(result.resolvedExecutablePath),
          processId: result.processId
        },
        ...result.expectedChildProcessNames.map((executableName) => ({
          displayName: result.handoffDisplayName || executableName.replace(/\.exe$/i, ''),
          executableName
        }))
      ];
      trackedProcessLabel = processName;
      await watchLaunchProcessSession({
        activeProcess: ready,
        knownProcesses,
        onActiveProcess: (active) => {
          trackedProcessLabel = active.label;
          setLaunchSplash((current) =>
            current?.operationId === operationId
              ? {
                  ...current,
                  appName: active.label,
                  detail: t('app.message.processLaunched', { name: active.label }),
                  state: 'running',
                  subtitle: t('app.operation.closeProcess'),
                  title: t('app.message.processLaunched', { name: active.label })
                }
              : current
          );
          setMessage(
            `${active.label}. ${t('app.operation.closeProcess')}`
          );
        },
        operationId,
        waitForExit: window.fluxora.processes.waitForExit
      });
      managedOutcome = 'completed';
      setMessage(t('app.message.processClosedContinue', { name: trackedProcessLabel }));
    } catch (error) {
      managedOutcome = managedSessionId ? 'watcher-error' : 'failed';
      setMessage(isManagedBodySlide ? bodySlideLaunchErrorMessage(error, appLocale) : errorMessage(error));
    } finally {
      if (managedSessionId) {
        setExecutablesBusyLabel(t('app.busy.updatingOutput'));
        setLaunchSplash((current) =>
          current?.operationId === operationId
            ? {
                ...current,
                detail: t('app.operation.updatingOutput'),
                state: 'starting',
                subtitle:
                  launchedResult?.outputMod?.displayName ??
                  managedDisplay?.outputModName ??
                  selectedProject.name,
                title: t('app.operation.updatingOutput')
              }
            : current
        );
        try {
          const completion = await window.fluxora.executables.completeManagedLaunch(
            managedSessionId,
            managedOutcome,
            { operationId }
          );
          if (completion.deferred) {
            setMessage(
              completion.warnings[0] ??
                t('app.operation.processStillRunning', {
                  name: managedDisplay?.toolName ?? trackedProcessLabel
                })
            );
          } else if (managedOutcome === 'completed') {
            const warning = launchedResult?.warnings?.[0] ?? completion.warnings[0];
            setMessage(
              warning
                ? t('app.message.processClosedWarning', { name: trackedProcessLabel, warning })
                : t('app.message.outputUpdated', { name: completion.outputMod.displayName })
            );
          }
        } catch (completionError) {
          setMessage(t('app.message.outputUpdateFailed', {
            name: managedDisplay?.toolName ?? trackedProcessLabel,
            error: isManagedBodySlide
              ? bodySlideLaunchErrorMessage(completionError, appLocale)
              : errorMessage(completionError)
          }));
        }
      }
      if (launchedResult) {
        try {
          await loadModsWorkspace(selectedProject, {
            resetScroll: false,
            showBusy: false,
            showLoading: false
          });
        } catch {
          // The managed completion already invalidated native caches. A manual
          // refresh remains available if the renderer refresh itself fails.
        }
      }
      setLaunchSplash((current) => (current?.operationId === operationId ? null : current));
      setExecutablesBusyLabel(null);
    }
  };

  const requestGrassCacheGeneration = () => {
    if (!selectedProject || !grassCacheAction.visible) {
      return;
    }

    if (!grassCacheAction.available) {
      setMessage(grassCacheAction.reason || t('app.message.grassUnavailable'));
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
      title: t('app.operation.grassTitle'),
      statusText: t('app.operation.grassPreparing'),
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
      const resultText = t('app.message.grassCreated', { name: result.outputModName });
      finishOperationOverlay(operationId, resultText);
      setMessage(t('app.message.grassResult', {
        result: resultText,
        files: result.generatedFileCount,
        launches: result.launchCount
      }));
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

  const restoreInstallDialog = (
    dialog: InstallDialogState,
    patch: Partial<InstallDialogState> = {}
  ) => {
    setInstallDialog((current) =>
      current && current.operationId !== dialog.operationId
        ? current
        : { ...dialog, ...patch }
    );
  };

  const installDialogWithDetection = (
    current: InstallDialogState,
    fallbackName: string,
    fomodInstaller: FluxoraFomodInstaller
  ): InstallDialogState => {
    if (current.phase === 'error') {
      return current;
    }

    if (fomodInstaller.isFomod) {
      const nameState = applyInstallNameSuggestion(
        current,
        fomodInstaller.moduleName || fallbackName,
        'fomod'
      );
      const manualFomodDecisions = sanitizeFomodManualDecisions(
        fomodInstaller,
        current.manualFomodDecisions ?? []
      );
      const detectedDialog: InstallDialogState = {
        ...current,
        ...nameState,
        phase: 'fomod',
        installerKind: 'fomod',
        fomodInstaller,
        selectedFomodOptionIds: initialFomodSelection(fomodInstaller),
        manualFomodDecisions,
        isRecalculatingFomod: false,
        fomodStepIndex: 0,
        activeFomodOptionId: null,
        layoutPreview: null,
        validationMessage: null,
        errorMessage: null
      };
      return detectedDialog.installPlan
        ? attachBackgroundInstallPlan(detectedDialog, detectedDialog.installPlan)
        : detectedDialog;
    }

    const detectedDialog: InstallDialogState = {
      ...current,
      phase: 'detecting',
      installerKind: 'standard',
      fomodInstaller: null,
      validationMessage: null,
      errorMessage: null
    };
    return detectedDialog.installPlan
      ? attachBackgroundInstallPlan(detectedDialog, detectedDialog.installPlan)
      : detectedDialog;
  };

  const watchInstallDetection = (
    operationId: string,
    fallbackName: string,
    promise: Promise<FluxoraFomodInstaller>
  ) => {
    installDetectionPromiseRef.current = { operationId, promise };
    void promise
      .then((fomodInstaller) => {
        if (installDetectionPromiseRef.current?.promise !== promise) {
          return;
        }
        setInstallDialog((current) =>
          current?.operationId === operationId
            ? installDialogWithDetection(current, fallbackName, fomodInstaller)
            : current
        );
      })
      .catch((error) => {
        if (installDetectionPromiseRef.current?.promise !== promise) {
          return;
        }
        const message = errorMessage(error);
        setInstallDialogPatchForOperation(operationId, {
          phase: 'error',
          errorMessage: message,
          isSubmitting: false
        });
        setMessage(message);
      });
  };

  const watchInstallPlan = (
    operationId: string,
    promise: Promise<FluxoraInstallPlan>
  ) => {
    installPlanPromiseRef.current = { operationId, promise };
    void promise
      .then((plan) => {
        if (installPlanPromiseRef.current?.promise !== promise) {
          return;
        }
        setInstallDialog((current) =>
          current?.operationId === operationId
            ? attachBackgroundInstallPlan(current, plan)
            : current
        );
      })
      .catch((error) => {
        if (installPlanPromiseRef.current?.promise !== promise) {
          return;
        }
        const message = errorMessage(error);
        setInstallDialogPatchForOperation(operationId, {
          phase: 'error',
          errorMessage: message,
          isSubmitting: false
        });
        setMessage(message);
      });
  };

  const analyzeInstallLayout = async (
    source: InstallSource,
    operationId: string,
    project: FluxoraProject | null = selectedProject,
    placementEdits?: FluxoraPlacementEditsV2
  ): Promise<FluxoraContentLayoutPreview> => {
    if (!project) {
      throw new Error(t('app.error.openBuildBeforeInstall'));
    }

    return window.fluxora.downloads.analyzeContentLayout(
      {
        projectDirectory: project.projectDirectory,
        downloadPath: source.sourcePath,
        existingModMode: 0,
        placementEdits
      },
      { operationId }
    );
  };

  const watchStandardInstallReady = (
    operationId: string,
    fallbackName: string,
    source: InstallSource,
    project: FluxoraProject,
    detectionPromise: Promise<FluxoraFomodInstaller>,
    planPromise: Promise<FluxoraInstallPlan>
  ) => {
    void detectionPromise.then((fomodInstaller) => {
      if (fomodInstaller.isFomod || installDetectionPromiseRef.current?.promise !== detectionPromise) {
        return;
      }
      const layoutPromise = analyzeInstallLayout(
        source,
        operationId,
        project,
        { schemaVersion: 2, files: [], directories: [], excludedSourcePaths: [] }
      );
      void Promise.all([planPromise, layoutPromise])
        .then(([plan, layoutPreview]) => {
          if (
            installDetectionPromiseRef.current?.promise !== detectionPromise ||
            installPlanPromiseRef.current?.promise !== planPromise
          ) {
            return;
          }
          setInstallDialog((current) => {
            if (!current || current.operationId !== operationId || current.phase === 'error') {
              return current;
            }
            const detected = installDialogWithDetection(current, fallbackName, fomodInstaller);
            const planned = attachBackgroundInstallPlan(detected, plan);
            return {
              ...planned,
              phase: 'options',
              layoutPreview,
              placementValidationPending: false,
              validationMessage: null,
              errorMessage: null
            };
          });
        })
        .catch((error) => {
          const message = errorMessage(error);
          setInstallDialogPatchForOperation(operationId, {
            phase: 'error',
            errorMessage: message,
            isSubmitting: false,
            placementValidationPending: false
          });
          setMessage(message);
        });
    });
  };

  const planInstallSource = (
    source: InstallSource,
    project: FluxoraProject,
    operationId: string,
    profileName: string = selectedProjectProfileName,
    requestedModName?: string
  ): Promise<FluxoraInstallPlan> => {
    if (source.kind === 'download') {
      return requestedModName
        ? window.fluxora.downloads.planInstall(
            project.projectDirectory,
            source.sourcePath,
            profileName,
            requestedModName,
            { operationId }
          )
        : window.fluxora.downloads.planInstall(
            project.projectDirectory,
            source.sourcePath,
            profileName,
            { operationId }
          );
    }

    return requestedModName
      ? window.fluxora.archives.planInstall(
          project.projectDirectory,
          source.sourcePath,
          profileName,
          requestedModName,
          { operationId }
        )
      : window.fluxora.archives.planInstall(
          project.projectDirectory,
          source.sourcePath,
          profileName,
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
      phase: 'detecting',
      source,
      operationId,
      installerKind: 'pending',
      fomodInstaller: null,
      selectedFomodOptionIds: [],
      manualFomodDecisions: [],
      isRecalculatingFomod: false,
      fomodStepIndex: 0,
      activeFomodOptionId: null,
      layoutPreview: null,
      installPlan: null,
      modName: fallbackName,
      modNameSource: 'source',
      modOrderPlacement: placement,
      existingModMode: 0,
      placementOverrides: {},
      placementEdits: { schemaVersion: 2, files: [], directories: [], excludedSourcePaths: [] },
      placementValidationPending: false,
      draggedSourcePath: null,
      validationMessage: null,
      errorMessage: null,
      isSubmitting: false
    });

    const detectionPromise = window.fluxora.downloads.analyzeFomod(
      project.projectDirectory,
      source.sourcePath,
      selectedProjectProfileName,
      [],
      { operationId }
    );
    const planPromise = planInstallSource(source, project, operationId);
    watchInstallDetection(operationId, fallbackName, detectionPromise);
    watchInstallPlan(operationId, planPromise);
    watchStandardInstallReady(
      operationId,
      fallbackName,
      source,
      project,
      detectionPromise,
      planPromise
    );
  };

  function reopenInstallForReview(operation: FluxoraInstallOperation) {
    const project = selectedProject;
    if (!project || operation.state !== 'needsReview') {
      return;
    }

    const sourceEntry = downloadsWorkspace.items.find(
      (entry) => downloadPath(entry).toLocaleLowerCase() === operation.sourcePath.toLocaleLowerCase()
    );
    const source: InstallSource = {
      kind: operation.sourceKind,
      sourcePath: operation.sourcePath,
      displayName: sourceEntry ? downloadTitle(sourceEntry, appLocale) : operation.targetFolder,
      fileName: sourceEntry?.fileName || fileNameFromPath(operation.sourcePath)
    };
    const placementPayload = ((): {
      placementOverrides: PlacementOverrideMap;
      placementEdits: FluxoraPlacementEditsV2;
    } => {
      try {
        const saved = JSON.parse(operation.placementOverridesJson || '[]') as unknown;
        const files = Array.isArray(saved)
          ? saved
          : saved && typeof saved === 'object' && 'schemaVersion' in saved &&
              saved.schemaVersion === 2 && 'files' in saved && Array.isArray(saved.files)
            ? saved.files
            : [];
        const directories = saved && typeof saved === 'object' && !Array.isArray(saved) &&
            'schemaVersion' in saved && saved.schemaVersion === 2 &&
            'directories' in saved && Array.isArray(saved.directories)
          ? saved.directories.flatMap((candidate) =>
              candidate && typeof candidate === 'object' &&
              'target' in candidate && typeof candidate.target === 'string' &&
              (candidate.target === 'data' || candidate.target === 'gameRoot') &&
              'targetRelativePath' in candidate && typeof candidate.targetRelativePath === 'string'
                ? [{ target: candidate.target, targetRelativePath: candidate.targetRelativePath }]
                : [])
          : [];
        const excludedSourcePaths = saved && typeof saved === 'object' && !Array.isArray(saved) &&
            'schemaVersion' in saved && saved.schemaVersion === 2 &&
            'excludedSourcePaths' in saved && Array.isArray(saved.excludedSourcePaths)
          ? saved.excludedSourcePaths.filter((candidate): candidate is string => typeof candidate === 'string')
          : [];
        const validFiles = files.flatMap((candidate) => {
          if (
            !candidate || typeof candidate !== 'object' ||
            !('sourcePath' in candidate) || typeof candidate.sourcePath !== 'string' ||
            !('target' in candidate) || typeof candidate.target !== 'string' ||
            !('targetRelativePath' in candidate) || typeof candidate.targetRelativePath !== 'string'
          ) {
            return [];
          }
          return [{
            sourcePath: candidate.sourcePath,
            target: candidate.target,
            targetRelativePath: candidate.targetRelativePath
          }];
        });
        return {
          placementOverrides: Object.fromEntries(validFiles.map((candidate) => [candidate.sourcePath, {
            target: candidate.target,
            targetRelativePath: candidate.targetRelativePath
          }])),
          placementEdits: { schemaVersion: 2, files: validFiles, directories, excludedSourcePaths }
        };
      } catch {
        return {
          placementOverrides: {},
          placementEdits: { schemaVersion: 2, files: [], directories: [], excludedSourcePaths: [] }
        };
      }
    })();

    setMessage(t('app.message.installReview'));
    setInstallDialog({
      phase: 'detecting',
      source,
      operationId: operation.operationId,
      installerKind: 'pending',
      fomodInstaller: null,
      selectedFomodOptionIds: operation.selectedOptionIds ?? [],
      manualFomodDecisions: operation.manualDecisions ?? [],
      isRecalculatingFomod: false,
      fomodStepIndex: 0,
      activeFomodOptionId: null,
      layoutPreview: null,
      installPlan: null,
      modName: operation.targetFolder,
      modNameSource: 'user',
      modOrderPlacement: null,
      existingModMode: operation.existingModMode,
      placementOverrides: placementPayload.placementOverrides,
      placementEdits: placementPayload.placementEdits,
      placementValidationPending: false,
      draggedSourcePath: null,
      validationMessage: null,
      errorMessage: null,
      isSubmitting: false
    });

    const detectionPromise = window.fluxora.downloads.analyzeFomod(
      project.projectDirectory,
      source.sourcePath,
      operation.profileName,
      operation.manualDecisions ?? [],
      { operationId: operation.operationId }
    );
    const planPromise = planInstallSource(
      source,
      project,
      operation.operationId,
      operation.profileName,
      operation.targetFolder
    );
    watchInstallDetection(operation.operationId, operation.targetFolder, detectionPromise);
    watchInstallPlan(operation.operationId, planPromise);
    watchStandardInstallReady(
      operation.operationId,
      operation.targetFolder,
      source,
      project,
      detectionPromise,
      planPromise
    );
  }

  const resolveInstallDialogPlan = async (
    currentDialog: InstallDialogState
  ): Promise<InstallDialogState | null> => {
    if (currentDialog.installPlan) {
      return currentDialog;
    }

    const pendingPlan = installPlanPromiseRef.current;
    if (!pendingPlan || pendingPlan.operationId !== currentDialog.operationId) {
      restoreInstallDialog(currentDialog, {
        phase: 'error',
        errorMessage: t('app.error.installerPreparationUnavailable'),
        isSubmitting: false
      });
      return null;
    }

    const plan = await pendingPlan.promise;
    return attachBackgroundInstallPlan(currentDialog, plan);
  };

  const openInstallDetails = () => {
    const currentDialog = installDialog;
    if (!currentDialog || !currentDialog.layoutPreview) {
      return;
    }

    setArchiveTreeScrollTop(0);
    setInstallDialogPatchForOperation(currentDialog.operationId, {
      phase: 'details',
      validationMessage: null
    });
  };

  const updateInstallPlacementEdits = (placementEdits: FluxoraPlacementEditsV2) => {
    const currentDialog = installDialog;
    const project = selectedProject;
    if (!currentDialog || !project || currentDialog.installerKind !== 'standard') {
      return;
    }
    const generation = ++installPlacementValidationGenerationRef.current;
    setInstallDialogPatchForOperation(currentDialog.operationId, {
      placementEdits,
      placementValidationPending: true,
      validationMessage: null
    });
    void analyzeInstallLayout(
      currentDialog.source,
      currentDialog.operationId,
      project,
      placementEdits
    ).then(
      (layoutPreview) => {
        if (installPlacementValidationGenerationRef.current !== generation) {
          return;
        }
        setInstallDialog((current) =>
          current?.operationId === currentDialog.operationId
            ? {
                ...current,
                placementEdits,
                layoutPreview,
                placementValidationPending: false,
                validationMessage: null,
                errorMessage: null
              }
            : current
        );
      },
      (error) => {
        if (installPlacementValidationGenerationRef.current !== generation) {
          return;
        }
        setInstallDialogPatchForOperation(currentDialog.operationId, {
          placementEdits,
          placementValidationPending: false,
          validationMessage: errorMessage(error)
        });
      }
    );
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
    const capabilities = downloadCapabilityView(project, bridgeStatus, appLocale);
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
      setDownloadsBusyLabel(t('app.busy.loadingDownloads'));
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
        downloadListVirtualizerRef.current?.scrollTo(0);
      }
      return true;
    } catch (error) {
      if (!isCurrentWorkspaceStoreLoad('downloads', loadSequence)) {
        return false;
      }
      const message = errorMessage(error);
      dispatchDownloadsWorkspace({ type: 'load-failed', message, silent: !showLoading });
      if (!options.suppressError) {
        setMessage(message);
      }
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

  const openModRenameDialog = (item: FluxoraModOrderItem) => {
    if (!selectedProject || !item.isMod || modsActionsBusy) {
      return;
    }

    const currentName = normalizeInstallModName(modItemTitle(item, appLocale));
    setItemRenameDialog({
      currentName,
      isSubmitting: false,
      kind: 'mod',
      maxNameLength: 255,
      name: currentName,
      project: selectedProject,
      targetPath: item.id,
      validationMessage: null
    });
  };

  const openDownloadRenameDialog = (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canInstall || downloadsActionsBusy) {
      return;
    }

    const fileName = entry.fileName || fileNameFromPath(downloadPath(entry));
    const currentName = downloadRenameBaseName(fileName);
    const suffix = downloadArchiveSuffix(fileName);
    setItemRenameDialog({
      currentName,
      isSubmitting: false,
      kind: 'download',
      maxNameLength: Math.max(1, 255 - suffix.length),
      name: currentName,
      project: selectedProject,
      targetPath: downloadPath(entry),
      validationMessage: null
    });
  };

  const updateItemRenameDialogName = (name: string) => {
    setItemRenameDialog((current) =>
      current
        ? {
            ...current,
            name,
            validationMessage: null
          }
        : current
    );
  };

  const submitItemRenameDialog = async () => {
    const request = itemRenameDialog;
    if (!request || request.isSubmitting) {
      return;
    }

    const newName = normalizeInstallModName(request.name);
    const validationMessage =
      newName.length > request.maxNameLength
        ? t('app.message.nameTooLong', { count: request.maxNameLength })
        : validateInstallModName(newName, appLocale);
    const copy = itemRenameDialogCopy(bridgeStatus?.language, request.kind);
    if (validationMessage || newName === request.currentName) {
      setItemRenameDialog((current) =>
        current
          ? {
              ...current,
              validationMessage: validationMessage || copy.unchangedMessage
            }
          : current
      );
      return;
    }

    setItemRenameDialog((current) =>
      current ? { ...current, isSubmitting: true, name: newName, validationMessage: null } : current
    );

    try {
      const operationId = createRendererOperationId(
        request.kind === 'mod' ? 'mods_rename_installed' : 'downloads_rename'
      );
      if (request.kind === 'mod') {
        await window.fluxora.mods.renameInstalled(
          request.project.projectDirectory,
          request.targetPath,
          newName,
          { operationId }
        );
        setItemRenameDialog(null);
        if (selectedProject?.id === request.project.id) {
          await Promise.all([
            loadModsWorkspace(request.project, {
              operationId,
              resetScroll: false,
              showBusy: false,
              showLoading: false
            }),
            loadPluginsWorkspace(request.project, {
              operationId,
              resetScroll: false,
              showBusy: false,
              showLoading: false
            })
          ]);
        }
      } else {
        await window.fluxora.downloads.rename(
          request.project.projectDirectory,
          request.targetPath,
          newName,
          { operationId }
        );
        setItemRenameDialog(null);
        if (selectedProject?.id === request.project.id) {
          await loadDownloadsWorkspace(request.project, {
            operationId,
            resetScroll: false,
            showBusy: false,
            showLoading: false
          });
        }
      }
      setMessage(`${copy.renameLabel}: ${newName}`);
    } catch (error) {
      setItemRenameDialog((current) =>
        current
          ? {
              ...current,
              isSubmitting: false,
              validationMessage: errorMessage(error)
            }
          : current
      );
    }
  };

  const copyDownloadPath = async (entry: FluxoraDownloadEntry) => {
    const path = downloadPath(entry);
    const copy = itemRenameDialogCopy(bridgeStatus?.language, 'download');
    try {
      await window.fluxora.clipboard.writeText(path);
      setMessage(`${copy.copyPathLabel}: ${path}`);
    } catch (error) {
      setMessage(errorMessage(error));
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
      downloadsActionsBusy ||
      downloadDropCueRef.current === 'importing'
    ) {
      scheduleDownloadDropIdle();
      return;
    }

    showDownloadDropCue('importing');
    await runDownloadMutation(
      t('app.message.importingDropped', { count: paths.length }),
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
          setMessage(t('app.message.importedArchives', { count: paths.length }));
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
    await runDownloadMutation(t('app.busy.importingArchive'), async (operationId) => {
      const imported = await window.fluxora.downloads.importFile(
        selectedProject.projectDirectory,
        archivePath,
        { operationId }
      );
      dispatchDownloadsWorkspace({ type: 'selected', id: imported.id });
      setMessage(t('app.message.importedArchive', { name: downloadTitle(imported, appLocale) }));
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
      setMessage(t('app.message.downloadNotInstallable'));
      return;
    }

    const source: InstallSource = {
      kind: 'download',
      sourcePath: downloadPath(entry),
      displayName: downloadTitle(entry, appLocale),
      fileName: entry.fileName || fileNameFromPath(downloadPath(entry))
    };
    await startInstallFlow(source, placement);
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

    const deletedDownloadTitle = downloadTitle(targets[0] ?? entry, appLocale);
    setDeletionConfirmation({
      kind: 'download',
      itemName: deletedDownloadTitle,
      itemCount: targets.length,
      description:
        t('app.message.downloadDeleteDescription'),
      onConfirm: () => deleteDownloads(targets)
    });
  };

  const deleteDownload = async (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canDelete) {
      return;
    }

    const project = selectedProject;
    const deletedDownloadTitle = downloadTitle(entry, appLocale);

    const operationId = createRendererOperationId('downloads_delete');
    beginOperationOverlay({
      operationId,
      kind: 'download-delete',
      title: t('app.operation.deleteFile'),
      statusText: t('app.operation.deleteFileStatus'),
      currentItem: deletedDownloadTitle,
      percent: 8
    });
    setDownloadsBusyLabel(t('app.busy.deletingDownload'));
    setMessage(null);

    try {
      await window.fluxora.downloads.delete(project.projectDirectory, downloadPath(entry), {
        operationId
      });
      setOperationOverlay((current) =>
        current && current.operationId === operationId
          ? {
              ...current,
              statusText: t('app.operation.refreshingDownloads'),
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
    const targetLabel = deletionSubjectLabel(
      'download',
      '',
      targets.length,
      bridgeStatus?.language
    );
    beginOperationOverlay({
      operationId,
      kind: 'download-delete',
      title: t('app.operation.deleteFiles'),
      statusText: t('app.operation.deleteFilesStatus'),
      currentItem: targetLabel,
      percent: 8
    });
    setDownloadsBusyLabel(t('app.busy.deletingDownloads'));
    setMessage(null);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const entry = targets[index]!;
        const currentPercent = Math.min(82, 8 + Math.round((index / targets.length) * 72));
        setOperationOverlay((current) =>
          current && current.operationId === operationId
            ? {
                ...current,
                currentItem: downloadTitle(entry, appLocale),
                statusText: t('app.operation.deleteFileProgress', {
                  current: index + 1,
                  total: targets.length
                }),
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
              statusText: t('app.operation.refreshingDownloads'),
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

    await runDownloadMutation(t('app.busy.cancellingDownload'), (operationId) =>
      window.fluxora.downloads.cancel(selectedProject.projectDirectory, downloadPath(entry), {
        operationId
      })
    );
  };

  const resumeDownload = async (entry: FluxoraDownloadEntry) => {
    if (!selectedProject || !entry.canResume) {
      return;
    }

    await runDownloadMutation(t('app.busy.resumingDownload'), (operationId) =>
      window.fluxora.downloads.resume(selectedProject.projectDirectory, downloadPath(entry), {
        operationId
      })
    );
  };

  const resolveDownloadDuplicateDecision = async (
    choice: FluxoraDownloadDuplicateChoice
  ) => {
    const project = selectedProject;
    const entry = activeDownloadDuplicateDecision;
    const decision = entry?.duplicateDecision;
    if (!project || !entry || !decision || downloadDuplicateDecisionResolving) {
      return;
    }

    const operationId = createRendererOperationId('downloads_resolve_duplicate_decision');
    setDownloadDuplicateDecisionResolving(true);
    setDownloadDuplicateDecisionError(null);
    try {
      const updated = await window.fluxora.downloads.resolveDuplicateDecision(
        project.projectDirectory,
        downloadPath(entry),
        decision.decisionId,
        choice,
        { operationId }
      );
      if (updated) {
        if (updated.id !== entry.id) {
          dispatchDownloadsWorkspace({ type: 'item-removed', id: entry.id });
        }
        dispatchDownloadsWorkspace({ type: 'items-upserted', items: [updated] });
      } else {
        dispatchDownloadsWorkspace({ type: 'item-removed', id: entry.id });
      }
      void window.fluxora.ui.log({
        level: 'info',
        category: 'NxmDuplicate',
        message: `Duplicate archive decision resolved: ${choice}.`,
        operationId
      });
    } catch (error) {
      const message = errorMessage(error);
      setDownloadDuplicateDecisionError(message);
      setMessage(message);
    } finally {
      setDownloadDuplicateDecisionResolving(false);
    }
  };

  const openDownloadInShell = async (entry: FluxoraDownloadEntry) => {
    const path = downloadPath(entry);
    const result = await window.fluxora.shell.showItemInFolder(path);
    if (!result.ok) {
      setMessage(result.message ?? t('app.message.downloadLocationOpenFailed'));
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
      setDownloadsBusyLabel(t('app.busy.registeringNxm'));
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
    event: Pick<FluxoraNxmInboundLinksCaptured, 'count' | 'operationId'>
  ) => {
    const operationId = event.operationId || createRendererOperationId('nxm_inbound_event');

    try {
      const imported = await window.fluxora.nxm.importInboundDownloads(
        project.projectDirectory,
        { operationId }
      );
      if (imported.length > 0) {
        dispatchDownloadsWorkspace({ type: 'items-upserted', items: imported });
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const importInboundDownloads = async () => {
    if (!selectedProject || isImportingNxmManually) {
      return;
    }

    const operationId = createRendererOperationId('nxm_manual_import');
    setIsImportingNxmManually(true);
    setMessage(null);
    try {
      const imported = await window.fluxora.nxm.importInboundDownloads(
        selectedProject.projectDirectory,
        { operationId }
      );
      if (imported.length > 0) {
        dispatchDownloadsWorkspace({ type: 'items-upserted', items: imported });
      }
      setMessage(imported.length === 0
        ? t('app.message.noInboundNxm')
        : t('app.message.importedNxm', { count: imported.length }));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setIsImportingNxmManually(false);
    }
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

  const recalculateFomodSmartSelection = async (resetManualDecisions: boolean) => {
    const currentDialog = installDialog;
    const project = selectedProject;
    if (!currentDialog?.fomodInstaller || !project || currentDialog.isRecalculatingFomod) {
      return;
    }

    const manualDecisions = resetManualDecisions
      ? []
      : sanitizeFomodManualDecisions(
          currentDialog.fomodInstaller,
          currentDialog.manualFomodDecisions ?? []
        );
    setInstallDialogPatchForOperation(currentDialog.operationId, {
      isRecalculatingFomod: true,
      validationMessage: null
    });

    try {
      const fomodInstaller = await window.fluxora.downloads.analyzeFomod(
        project.projectDirectory,
        currentDialog.source.sourcePath,
        selectedProjectProfileName,
        manualDecisions,
        { operationId: currentDialog.operationId }
      );
      if (!fomodInstaller.isFomod) {
        throw new Error(t('app.error.fomodUnavailable'));
      }

      const validManualDecisions = sanitizeFomodManualDecisions(
        fomodInstaller,
        manualDecisions
      );
      const selectedFomodOptionIds = initialFomodSelection(fomodInstaller);
      const nextEvaluation = evaluateFomodWizard(fomodInstaller, selectedFomodOptionIds, appLocale);
      const optionIds = new Set(
        fomodInstaller.steps.flatMap((step) =>
          step.groups.flatMap((group) => group.options.map((option) => option.id))
        )
      );
      setInstallDialog((current) =>
        current?.operationId === currentDialog.operationId
          ? {
              ...current,
              fomodInstaller,
              selectedFomodOptionIds,
              manualFomodDecisions: validManualDecisions,
              activeFomodOptionId:
                current.activeFomodOptionId && optionIds.has(current.activeFomodOptionId)
                  ? current.activeFomodOptionId
                  : null,
              fomodStepIndex: Math.min(
                current.fomodStepIndex,
                Math.max(0, nextEvaluation.visibleSteps.length - 1)
              ),
              isRecalculatingFomod: false,
              validationMessage: null,
              errorMessage: null
            }
          : current
      );
      setMessage(null);
    } catch (error) {
      const message = errorMessage(error);
      setInstallDialogPatchForOperation(currentDialog.operationId, {
        isRecalculatingFomod: false,
        validationMessage: message
      });
      setMessage(message);
    }
  };

  const continueFromFomod = async () => {
    if (!selectedProject || !installDialog?.fomodInstaller || !installFomodEvaluation) {
      return;
    }

    if (installDialog.fomodInstaller.autoSelection?.installBlocked) {
      setInstallDialogPatch({
        validationMessage: t('app.message.fomodRequirementsNotMet')
      });
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

    const selectedOptionIds = installFomodEvaluation.selectedOptionIds;
    const fallbackName =
      installDialog.fomodInstaller.moduleName.trim() ||
      defaultInstallModName(installDialog.source.displayName, installDialog.source.sourcePath);
    const fomodDialog: InstallDialogState = {
      ...installDialog,
      phase: 'fomod',
      installerKind: 'fomod',
      layoutPreview: null,
      selectedFomodOptionIds: selectedOptionIds,
      modName: installDialog.modName.trim() || fallbackName,
      validationMessage: null
    };
    await submitInstallDialog(fomodDialog);
  };

  async function submitInstallDialog(
    installDialog: InstallDialogState,
    selectedConflictDecision?: 1 | 2 | 'installNew'
  ) {
    const project = selectedProject;
    if (!project) {
      return;
    }

    const installSourceKey = installDialog.source.sourcePath.trim().toLocaleLowerCase();
    if (installSubmitSourcesRef.current.has(installSourceKey)) {
      const activeOperation = [...installSourceByOperationRef.current.entries()].find(
        ([, sourcePath]) => sourcePath === installSourceKey
      );
      const resumesReview = activeOperation?.[0] === installDialog.operationId &&
        installOperationsRef.current.get(installDialog.operationId)?.state === 'needsReview';
      if (resumesReview) {
        installOperationsRef.current.delete(installDialog.operationId);
      } else {
        const activeSession = activeOperation
          ? pendingInstallOrchestrator.sessions.get(activeOperation[0])
          : undefined;
        if (activeSession) {
          dispatchModsWorkspace({
            type: 'item-reveal-requested',
            orderId: activeSession.rowOrderId
          });
          requestPostInstallModReveal({
            installedId: activeSession.pendingOrderId,
            installedName: installDialog.modName,
            orderId: activeSession.rowOrderId,
            animate: false
          });
        }
        setMessage(t('app.message.installAlreadyRunning'));
        return;
      }
    }
    installSubmitSourcesRef.current.add(installSourceKey);
    let submissionDialog = installDialog;
    let pendingInstallStarted = false;
    let installAccepted = false;

    try {
      const initialModName = normalizeInstallModName(installDialog.modName);
      const nameValidation = validateInstallModName(initialModName, appLocale);
      if (nameValidation) {
        setInstallDialogPatchForOperation(installDialog.operationId, {
          phase: 'options',
          validationMessage: nameValidation,
          isSubmitting: false
        });
        return;
      }

      setInstallDialogPatchForOperation(installDialog.operationId, { isSubmitting: true });

      let resolvedDialog = await resolveInstallDialogPlan(installDialog);
      if (!resolvedDialog) {
        return;
      }
      if (installPlanNeedsUserNameReplan(resolvedDialog)) {
        const userNamePlan = await planInstallSource(
          resolvedDialog.source,
          project,
          resolvedDialog.operationId,
          selectedProjectProfileName,
          initialModName
        );
        const replannedDialog = attachBackgroundInstallPlan(resolvedDialog, userNamePlan);
        resolvedDialog = {
          ...replannedDialog,
          fomodInstaller: userNamePlan.fomodInstaller.isFomod
            ? userNamePlan.fomodInstaller
            : replannedDialog.fomodInstaller
        };
      }
      submissionDialog = {
        ...resolvedDialog,
        existingModMode:
          typeof selectedConflictDecision === 'number'
            ? selectedConflictDecision
            : 0,
        isSubmitting: true
      };

      const modName = normalizeInstallModName(submissionDialog.modName);
      const resolvedNameValidation = validateInstallModName(modName, appLocale);
      if (resolvedNameValidation) {
        restoreInstallDialog(submissionDialog, {
          phase: 'options',
          validationMessage: resolvedNameValidation,
          isSubmitting: false
        });
        return;
      }

      const layoutPreview = submissionDialog.layoutPreview;
      if (
        submissionDialog.installerKind === 'standard' &&
        (submissionDialog.placementValidationPending ||
          Boolean(submissionDialog.validationMessage) ||
          !layoutPreview?.canInstall)
      ) {
        restoreInstallDialog(submissionDialog, {
          phase: 'details',
          validationMessage: submissionDialog.validationMessage ||
            t('app.error.archivePlacementBlocked'),
          isSubmitting: false
        });
        return;
      }

      const installPlan = submissionDialog.installPlan;
      if (!installPlan) {
        throw new Error(t('app.error.installerPlanUnavailable'));
      }
      const matchedTarget = matchedInstallTargetForCurrentName(submissionDialog);
      const existingModNameForPrompt = matchedTarget?.displayName ?? null;
      if (selectedConflictDecision === undefined && existingModNameForPrompt) {
        restoreInstallDialog(submissionDialog, {
          phase: 'conflict',
          existingModMode: 0,
          validationMessage: null,
          isSubmitting: false
        });
        return;
      }

      const useMatchedTarget = typeof selectedConflictDecision === 'number';
      if (useMatchedTarget && !matchedTarget) {
        throw new Error(t('app.error.matchedModChanged'));
      }
      const existingModMode: FluxoraExistingModInstallMode =
        typeof selectedConflictDecision === 'number'
        ? selectedConflictDecision
        : 0;
      const identitySelection = {
        resolutionId: installPlan.resolutionId,
        identityDecision: useMatchedTarget ? 'use-match' as const : 'install-new' as const,
        targetModUuid: useMatchedTarget ? matchedTarget!.modUuid : undefined,
        newNamePolicy: 'first-free-copy-suffix' as const
      };

      const placementOverridesJson =
        submissionDialog.installerKind === 'standard'
          ? JSON.stringify(submissionDialog.placementEdits)
          : undefined;
      const fomodContextId =
        submissionDialog.fomodInstaller?.autoSelection?.contextId ||
        submissionDialog.fomodInstaller?.profileContext?.contextId ||
        undefined;
      const manualFomodDecisions = submissionDialog.fomodInstaller
        ? sanitizeFomodManualDecisions(
            submissionDialog.fomodInstaller,
            submissionDialog.manualFomodDecisions ?? []
          )
        : [];

      const pendingInstallDraft = {
        operationId: submissionDialog.operationId,
        modName,
        mode: existingModMode,
        targetModUuid: identitySelection.targetModUuid
      };
      const modOrderTargetIndex = pendingInstallTargetIndexForPlacement(
        modsWorkspace.items,
        pendingInstallDraft,
        submissionDialog.modOrderPlacement
      );
      const pendingAlreadyExists = pendingInstallOrchestrator.sessions.has(
        submissionDialog.operationId
      );
      const pendingSession = pendingInstallOrchestrator.begin({
        projectDirectory: project.projectDirectory,
        ...pendingInstallDraft,
        targetIndex: modOrderTargetIndex
      });
      pendingInstallStarted = true;
      dispatchModsWorkspace({
        type: 'item-reveal-requested',
        orderId: pendingSession.rowOrderId
      });
      requestPostInstallModReveal({
        installedId: pendingSession.pendingOrderId,
        installedName: modName,
        orderId: pendingSession.rowOrderId,
        animate: !pendingAlreadyExists
      });

      setInstallDialog((current) =>
        current?.operationId === submissionDialog.operationId ? null : current
      );

      if (submissionDialog.source.kind === 'download') {
        const installingEntry = downloadsWorkspace.items.find(
          (entry) => downloadPath(entry) === submissionDialog.source.sourcePath
        );
        if (installingEntry) {
          dispatchDownloadsWorkspace({
            type: 'items-upserted',
            items: [{ ...installingEntry, buildStatus: 'Installing' }]
          });
        }
      }

      const anchorItems = modsWorkspace.items;
      const beforeOrderId = modOrderTargetIndex > 0
        ? anchorItems[modOrderTargetIndex - 1]?.orderId
        : undefined;
      const afterOrderId = anchorItems[modOrderTargetIndex]?.orderId;
      installSourceByOperationRef.current.set(
        submissionDialog.operationId,
        installSourceKey
      );
      const workspaceDeltaBaseline = await ensureWorkspaceDeltaBaseline(
        project,
        selectedProjectProfileName,
        submissionDialog.operationId
      );
      if (!workspaceDeltaBaseline) {
        throw new Error(t('app.error.workspaceRevisionUnavailable'));
      }
      const acceptedOperation = await window.fluxora.installs.submit(
        {
          operationId: submissionDialog.operationId,
          projectDirectory: project.projectDirectory,
          sourceKind: submissionDialog.source.kind,
          sourcePath: submissionDialog.source.sourcePath,
          isFomod: submissionDialog.installerKind === 'fomod',
          modName,
          profileName: selectedProjectProfileName,
          templateId: project.templateId,
          workspaceRevision: workspaceDeltaBaseline.revision,
          modOrderTargetIndex,
          beforeOrderId,
          afterOrderId,
          existingModMode,
          selectedOptionIds: submissionDialog.installerKind === 'fomod'
            ? submissionDialog.selectedFomodOptionIds
            : [],
          fomodContextId,
          manualDecisions: manualFomodDecisions,
          placementOverridesJson,
          ...identitySelection
        },
        { operationId: submissionDialog.operationId }
      );
      const observedOperation = installOperationsRef.current.get(
        acceptedOperation.operationId
      );
      if (shouldAcceptInstallOperation(observedOperation, acceptedOperation)) {
        installOperationsRef.current.set(acceptedOperation.operationId, acceptedOperation);
        pendingInstallOrchestrator.progressStore.setOperation(acceptedOperation);
      }
      installAccepted = true;
      setMessage(t('app.message.queuedInstall', { name: modName }));
    } catch (error) {
      if (pendingInstallStarted) {
        pendingInstallOrchestrator.rollback(submissionDialog.operationId);
      }
      void loadDownloadsWorkspace(project, {
        operationId: submissionDialog.operationId,
        resetScroll: false,
        showBusy: false,
        showLoading: false
      });
      const errorCode = error && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : null;
      if (errorCode === 'install.fomodContextChanged' && submissionDialog.fomodInstaller) {
        try {
          const retainedManualDecisions = sanitizeFomodManualDecisions(
            submissionDialog.fomodInstaller,
            submissionDialog.manualFomodDecisions ?? []
          );
          const fomodInstaller = await window.fluxora.downloads.analyzeFomod(
            project.projectDirectory,
            submissionDialog.source.sourcePath,
            selectedProjectProfileName,
            retainedManualDecisions,
            { operationId: submissionDialog.operationId }
          );
          if (!fomodInstaller.isFomod) {
            throw new Error(t('app.error.fomodUnavailable'));
          }
          const manualFomodDecisions = sanitizeFomodManualDecisions(
            fomodInstaller,
            retainedManualDecisions
          );
          const selectedFomodOptionIds = initialFomodSelection(fomodInstaller);
          const optionIds = new Set(
            fomodInstaller.steps.flatMap((step) =>
              step.groups.flatMap((group) => group.options.map((option) => option.id))
            )
          );
          submissionDialog = {
            ...submissionDialog,
            phase: 'fomod',
            installerKind: 'fomod',
            fomodInstaller,
            selectedFomodOptionIds,
            manualFomodDecisions,
            activeFomodOptionId:
              submissionDialog.activeFomodOptionId &&
              optionIds.has(submissionDialog.activeFomodOptionId)
                ? submissionDialog.activeFomodOptionId
                : null,
            validationMessage:
              t('app.message.profileChangedValidation'),
            errorMessage: null,
            isSubmitting: false,
            isRecalculatingFomod: false
          };
          restoreInstallDialog(submissionDialog);
          setMessage(t('app.message.profileChanged'));
          return;
        } catch (refreshError) {
          error = refreshError;
        }
      }
      if (errorCode === 'install.identityPlanStale') {
        try {
          const plan = await planInstallSource(
            submissionDialog.source,
            project,
            submissionDialog.operationId,
            selectedProjectProfileName,
            submissionDialog.modNameSource === 'user'
              ? normalizeInstallModName(submissionDialog.modName)
              : undefined
          );
          const suggestionSource = plan.matchedTarget
            ? 'identity'
            : plan.fomodInstaller.isFomod
              ? 'fomod'
              : 'source';
          const nameState = applyInstallNameSuggestion(
            submissionDialog,
            plan.suggestedModName,
            suggestionSource
          );
          const replannedDialog: InstallDialogState = {
            ...submissionDialog,
            ...nameState,
            installPlan: plan,
            fomodInstaller: plan.fomodInstaller.isFomod
              ? plan.fomodInstaller
              : submissionDialog.fomodInstaller,
            validationMessage: null,
            errorMessage: null,
            isSubmitting: false
          };
          submissionDialog = {
            ...replannedDialog,
            phase: matchedInstallTargetForCurrentName(replannedDialog)
              ? 'conflict'
              : submissionDialog.installerKind === 'fomod'
                ? 'fomod'
                : 'options'
          };
          restoreInstallDialog(submissionDialog);
          setMessage(null);
          return;
        } catch (replanError) {
          error = replanError;
        }
      }
      restoreInstallDialog(submissionDialog, {
        phase: 'error',
        errorMessage: errorMessage(error),
        isSubmitting: false
      });
      setMessage(errorMessage(error));
    } finally {
      if (!installAccepted) {
        installSubmitSourcesRef.current.delete(installSourceKey);
        installSourceByOperationRef.current.delete(installDialog.operationId);
      }
    }
  }

  const submitInstallOptions = async (
    selectedConflictDecision?: 1 | 2 | 'installNew'
  ) => {
    if (!installDialog) {
      return;
    }
    await submitInstallDialog(installDialog, selectedConflictDecision);
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
        dispatchAppLanguage({
          type: 'native-loaded',
          language: nextBridgeStatus.language ?? 'en-us'
        });
        setThemeMode(normalizeThemeMode(nextBridgeStatus.theme));

        if (nextBridgeStatus.ready) {
          if (!isSecondaryWindow) {
            try {
              await connectionCoordinator.bootstrap();
            } catch (error) {
              void window.fluxora.ui.log({
                level: 'warning',
                category: 'Connections',
                message: `Startup connection restoration continued offline: ${errorMessage(error)}`,
                operationId
              });
            }
          }
          if (isMounted) {
            await loadCatalog();
          }
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
        dispatchAppLanguage({ type: 'native-load-failed' });
      }
    );

    return () => {
      isMounted = false;
      connectionCoordinator.stop();
    };
  }, []);

  useEffect(() => {
    if (isSecondaryWindow) {
      return undefined;
    }
    const retry = (reason: 'focus' | 'online' | 'visible') => {
      void connectionCoordinator.retryNow(reason).catch(() => undefined);
    };
    const handleOnline = () => retry('online');
    const handleFocus = () => retry('focus');
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        retry('visible');
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connectionCoordinator, isSecondaryWindow]);

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

    if (isFilePreviewWindow && filePreviewProjectId) {
      setSelectedProjectId(filePreviewProjectId);
    }
  }, [
    buildSettingsProjectId,
    filePreviewProjectId,
    isBuildSettingsWindow,
    isFilePreviewWindow,
    isModDetailsWindow,
    modDetailsProjectId
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.platform = chromePlatform;
  }, [chromePlatform]);

  useEffect(() => {
    if (window.localStorage.getItem(aiRollbackCheckpointResetMarker) === 'ready') {
      setAiRollbackStoreReady(true);
      return;
    }
    const operationId = createRendererOperationId('ai_file_rollback_checkpoints_reset');
    void window.fluxora.ai.resetFileRollbackCheckpoints(operationId).then(
      () => {
        window.localStorage.setItem(aiRollbackCheckpointResetMarker, 'ready');
        setAiRollbackStoreReady(true);
      },
      () => undefined
    );
  }, []);

  useEffect(() => {
    activeAiRunsRef.current.forEach((run) => {
      run.handle?.dispose();
      requestNativeAiRunCancel(run.operationId);
    });
    activeAiRunsRef.current.clear();
    const restoredSession = loadAiSession(window.localStorage, aiSessionScope, appLocale);
    dispatchAiChat({
      type: 'restore-session',
      session: restoredSession
    });
    if (selectedProject && aiRollbackStoreReady) {
      restoredSession.chats.forEach((chat) => {
        const operationId = createRendererOperationId('ai_file_rollback_states_restore');
        void window.fluxora.ai.getFileRollbackStates(chat.id, operationId).then(
          (states) => dispatchAiChat({
            type: 'restore-file-rollback-states',
            chatId: chat.id,
            states
          }),
          () => undefined
        );
      });
    }
  }, [aiRollbackStoreReady, aiSessionScope, selectedProjectId]);

  useEffect(() => {
    saveAiSession(window.localStorage, aiChat.session);
  }, [aiChat.session]);

  useEffect(() => {
    if (!aiChat.isOpen || (isSecondaryWindow && !isSettingsWindow)) {
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
          quota: {
            schema: 'fluxora.ai.quota.v1',
            availability: 'temporaryServerError',
            available: false,
            eligibility: false,
            reason: 'ai.host.unavailable',
            periodStart: null,
            resetAt: null,
            rollover: false,
            limit: 0,
            used: 0,
            reserved: 0,
            remaining: 0,
            remainingInputTokenEquivalent: 0,
            search: { limit: 0, used: 0, reserved: 0, remaining: 0 },
            model: 'gemini-3.1-flash-lite',
            priceVersion: null
          },
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
  }, [aiChat.isOpen, isSecondaryWindow, isSettingsWindow]);

  useEffect(
    () => () => {
      activeAiRunsRef.current.forEach((run) => run.handle?.dispose());
      activeAiRunsRef.current.clear();
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
        if (
          selectedProject &&
          buildScopedAiRoutes.has(activeRoute) &&
          !isCreateOpen &&
          !isTransferPageOpen
        ) {
          dispatchAiChat({ type: 'toggle-open' });
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeRoute, isCreateOpen, isSecondaryWindow, isTransferPageOpen, selectedProject]);

  useEffect(() => {
    if (!selectedProject && aiChat.isOpen) {
      dispatchAiChat({ type: 'close' });
    }
  }, [aiChat.isOpen, selectedProject]);

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
    modDetailsContentCacheRef.current.clear();
  }, [selectedProject?.projectDirectory]);

  useEffect(() => {
    if (
      isModDetailsWindow ||
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
    isModDetailsWindow,
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
    const bootstrapItem = initialModDetailsBootstrap?.item;
    if (
      !isModDetailsWindow ||
      !bridgeStatus?.ready ||
      !modDetailsModId ||
      (bootstrapItem?.isMod && modOrderItemMatchesLookup(bootstrapItem, modDetailsModId))
    ) {
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
    initialModDetailsBootstrap?.item?.id,
    initialModDetailsBootstrap?.item?.orderId,
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
        return Promise.reject(new Error(t('app.error.buildContentFoldersUnavailable')));
      }

      const key = buildContentWatchKeyForProject(project, profileName);
      if (key === null) {
        return Promise.reject(new Error(t('app.error.buildContentFoldersUnavailable')));
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
            throw new Error(t('app.error.buildContentWatcherSuperseded'));
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
      if (buildContentRefreshCoordinator.isRunning()) {
        // An observed watcher event already owns this revision. Avoid a second
        // exact scan while the event reconciliation is publishing plugins and
        // rebuilding the mod workspace.
        return;
      }
      const watchGeneration = buildContentWatchGenerationRef.current;
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
    buildContentRefreshCoordinator,
    ensureBuildContentWatch,
    isSecondaryWindow,
    loadedWorkspaceProjectId,
    selectedProject,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    if (isSecondaryWindow) {
      buildContentRefreshCoordinator.stop();
      pluginBuildContentRefreshCoordinator.stop();
      return undefined;
    }
    buildContentRefreshCoordinator.resume();
    pluginBuildContentRefreshCoordinator.resume();
    return () => {
      buildContentRefreshCoordinator.stop();
      pluginBuildContentRefreshCoordinator.stop();
      buildContentWatchKeyRef.current = null;
      buildContentWatchPromiseRef.current = null;
      buildContentWatchGenerationRef.current += 1;
      exactWorkspaceWatchCoverageRef.current = null;
      void window.fluxora.buildContent
        .unwatch({ operationId: createRendererOperationId('build_content_unwatch') })
        .catch(() => undefined);
    };
  }, [
    buildContentRefreshCoordinator,
    isSecondaryWindow,
    pluginBuildContentRefreshCoordinator
  ]);

  useEffect(() => {
    if (
      isSecondaryWindow ||
      !selectedProject ||
      !bridgeStatus?.ready ||
      !pluginCapabilities.projectSupported ||
      modsWorkspace.loadState !== 'ready' ||
      pluginsWorkspace.loadState !== 'ready'
    ) {
      return;
    }
    void ensureWorkspaceDeltaBaseline(
      selectedProject,
      selectedProjectProfileName
    );
  }, [
    bridgeStatus?.ready,
    isSecondaryWindow,
    modsWorkspace.loadState,
    pluginCapabilities.projectSupported,
    pluginsWorkspace.loadState,
    selectedProject?.projectDirectory,
    selectedProject?.templateId,
    selectedProjectProfileName
  ]);

  useEffect(() => {
    if (isSecondaryWindow) {
      return undefined;
    }

    return window.fluxora.downloads.onChanged((event: FluxoraDownloadsChangedEvent) => {
      if (!selectedProject || event.projectDirectory !== selectedProject.projectDirectory) {
        return;
      }
      const cursor = downloadsDeltaCursorRef.current;
      if (
        cursor?.projectDirectory === event.projectDirectory &&
        (event.sequence <= cursor.sequence || event.revision === cursor.revision)
      ) {
        return;
      }
      downloadsDeltaCursorRef.current = {
        projectDirectory: event.projectDirectory,
        revision: event.revision,
        sequence: event.sequence
      };
      if (event.fullResyncRequired) {
        if (downloadsDeltaResyncInFlightRef.current) {
          return;
        }
        downloadsDeltaResyncInFlightRef.current = true;
        void loadDownloadsWorkspace(selectedProject, {
          operationId:
            event.operationId ?? createRendererOperationId('downloads_delta_full_resync'),
          resetScroll: false,
          showBusy: false,
          showLoading: false
        }).finally(() => {
          downloadsDeltaResyncInFlightRef.current = false;
        });
        return;
      }
      startTransition(() => {
        dispatchDownloadsWorkspace({
          type: 'delta-applied',
          upserts: event.upserts,
          removedIds: event.removedIds,
          placements: event.placements
        });
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
        modDetailsContentCacheRef.current.clear();
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
      const refreshTask = async () => {
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
              throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
            }
            return;
          }
          try {
            await watchPromise;
          } catch {
            if (failedScopes.length > 0) {
              throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
            }
            return;
          }
          // A grouped drag can require multiple sequential native moves while
          // the renderer already shows their final optimistic order. Reconcile
          // only after that durable save settles so a watcher delta cannot
          // expose a partially persisted order between those moves.
          await waitForPendingOrderSavesQuietly();
          const watchedScope = selectedWorkspaceScopeRef.current;
          if (
            watchedScope.project?.projectDirectory !== event.projectDirectory ||
            watchedScope.profileName !== reconciliationProfileName ||
            buildContentWatchPromiseRef.current !== watchPromise ||
            buildContentWatchKeyRef.current !== eventWatchKey
          ) {
            if (failedScopes.length > 0) {
              throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
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
              throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
            }
            return;
          }
          if (eventScopeFailed) {
            throw new Error(t('app.error.buildContentInvalidationActive'));
          }
          if (invalidatedRevision < reconciliationRevision) {
            throw new Error(t('app.error.buildContentRevisionPending'));
          }
          // Native reconciliation computes one revisioned mod/plugin delta
          // after cache invalidation, so the renderer never decodes or commits
          // complete background lists.
          const workspaceReconciled = await refreshWorkspaceDelta(
            reconciliationProject,
            reconciliationProfileName,
            createRendererOperationId('build_content_workspace_delta')
          );
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
              throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
            }
            return;
          }
          if (!workspaceReconciled) {
            // A revision/sequence gap has queued exactly one full fallback. It
            // will run after both list surfaces leave active scrolling.
            return;
          }
          if (refreshEffectiveFileTree) {
            await loadEffectiveFileTree(reconciliationProject, reconciliationProfileName, {
              force: true,
              requestKey: effectiveFileTreeRequestKey
            });
          }
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
              throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
            }
            return;
          }
          exactWorkspaceWatchCoverageRef.current = {
            contentRevision: reconciliationRevision,
            watchGeneration: reconciliationWatchGeneration,
            watchKey: eventWatchKey
          };
          currentEventReconciled = true;
          if (failedScopes.length > 0) {
            throw new Error(t('app.error.buildContentInvalidationPending', { count: failedScopes.length }));
          }
      };
      if (installCommitOperationsRef.current.size > 0) {
        deferredBuildContentRefreshRef.current = async () => {
          await refreshTask();
        };
        void window.fluxora.ui.log({
          level: 'info',
          category: 'ModInstall',
          message: 'Watcher reconciliation deferred while an install commit is active.',
          operationId: [...installCommitOperationsRef.current][0]
        });
        return;
      }
      void buildContentRefreshCoordinator.schedule(refreshTask).catch(() => undefined);
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
    pluginBuildContentRefreshCoordinator,
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
      const project = selectedWorkspaceScopeRef.current.project;
      const readiness = inboundNxmReadinessRef.current;
      const queuedText = t('app.message.nxmQueued', { count: event.count });
      if (!project || !readiness.bridgeReady || !readiness.downloadBridgeAvailable) {
        pendingInboundNxmEventRef.current = event;
        setMessage(queuedText);
        return;
      }

      pendingInboundNxmEventRef.current = null;
      void importInboundDownloadsForProject(project, event);
    });
  }, [isSecondaryWindow]);

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
      setMessage(t('app.message.buildPathsSavedFor', { name: project.name }));
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
      setManualModUpdateSplash((current) =>
        current ? applyModUpdateCheckProgress(current, progress) : current
      );
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
    const bootstrapMatches =
      isModDetailsWindow && fileTreeItem?.id === initialModDetailsBootstrap?.modPath;
    const bootstrapFileTree =
      bootstrapMatches && initialModDetailsBootstrap?.content
        ? modDetailsContentFileTree(initialModDetailsBootstrap.content)
        : bootstrapMatches && initialModDetailsBootstrap?.rootFileTree
          ? { '': initialModDetailsBootstrap.rootFileTree }
          : null;
    setFileTreeCache(bootstrapFileTree ?? {});
    setExpandedFileTree(
      bootstrapMatches
        ? expandedParentsForRelativePath(initialModDetailsBootstrap?.highlightRelativePath)
        : {}
    );
    setModDetailsConflictScanState(
      bootstrapMatches && initialModDetailsBootstrap?.content ? 'ready' : 'idle'
    );
    setModDetailsConflictPage(
      bootstrapMatches ? (initialModDetailsBootstrap?.content?.conflictTree ?? null) : null
    );

    if ((activeRoute !== 'build' && activeRoute !== 'mods') || !fileTreeItem?.isMod) {
      setFileTreeState('idle');
      return;
    }

    if (bootstrapFileTree && Object.hasOwn(bootstrapFileTree, '')) {
      setFileTreeState('ready');
      return;
    }

    void loadModFileTree('', fileTreeItem);
  }, [
    activeRoute,
    initialModDetailsBootstrap?.content,
    initialModDetailsBootstrap?.modPath,
    initialModDetailsBootstrap?.highlightRelativePath,
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
      modDetailsConflictScanState !== 'idle' ||
      !conflictItem?.isMod
    ) {
      return;
    }

    void loadModDetailsConflictTree(conflictItem);
  }, [
    isModDetailsWindow,
    modDetailsConflictScanState,
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
      setMessage(t('app.message.openBuildCancelled'));
    }

    if (isTransferRunning && route !== 'home') {
      setIsTransferPageOpen(true);
      setActiveRoute('home');
      setMessage(t('app.message.transferRunning'));
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
        setMessage(t('app.message.orderNotSaved'));
        return;
      }

      await window.fluxora.windowControls.close();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const startCreate = () => {
    createWizard.open();
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
            statusText: t('common.operationFailed'),
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
        throw new Error(t('app.error.workspaceLoadIncomplete'));
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
      buildName: pendingProject?.name ?? t('app.ui.build'),
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
      setMessage(t('app.message.openedBuild', { name: opened.name }));
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
    setMessage(t('app.message.openBuildCancelled'));
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

  const openBuildRenameDialog = (project: FluxoraProject) => {
    setBuildRenameDialog({
      currentName: project.name,
      gameName: project.gameName || project.templateId,
      isSubmitting: false,
      name: project.name,
      project,
      validationMessage: null
    });
  };

  const updateBuildRenameDialogName = (name: string) => {
    setBuildRenameDialog((current) =>
      current
        ? {
            ...current,
            name: name.slice(0, BUILD_RENAME_NAME_MAX_LENGTH),
            validationMessage: null
          }
        : current
    );
  };

  const closeBuildRenameDialog = () => {
    setBuildRenameDialog((current) => (current?.isSubmitting ? current : null));
  };

  const submitBuildRenameDialog = async () => {
    if (!buildRenameDialog || buildRenameDialog.isSubmitting) {
      return;
    }

    const request = buildRenameDialog;
    const copy = buildRenameDialogCopy(bridgeStatus?.language);
    const newName = request.name.trim();
    if (!newName || newName === request.currentName) {
      setBuildRenameDialog((current) =>
        current
          ? {
              ...current,
              validationMessage: newName ? copy.unchangedMessage : copy.requiredMessage
            }
          : current
      );
      return;
    }

    setBuildRenameDialog((current) =>
      current ? { ...current, isSubmitting: true, validationMessage: null } : current
    );
    setMessage(null);

    try {
      const { project: renamed } = await renameProjectConfig(request.project, newName);
      setCatalog((current) => ({
        ...current,
        projects: replaceRenamedProject(current.projects, request.project, renamed)
      }));
      setProjects((current) => replaceRenamedProject(current, request.project, renamed));
      setSelectedProjectId(renamed.id);
      setLoadedWorkspaceProjectId((current) =>
        current && projectMatchesSelection(request.project, current) ? renamed.id : current
      );
      setBuildRenameDialog(null);
      setMessage(t('app.message.renamedTo', { name: renamed.name }));
    } catch (error) {
      const validationMessage = errorMessage(error);
      setBuildRenameDialog((current) =>
        current?.project.configPath === request.project.configPath
          ? { ...current, isSubmitting: false, validationMessage }
          : current
      );
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
      title: t('app.operation.deleteBuild'),
      statusText: t('app.operation.preparingDeletion'),
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
      setMessage(result.message ?? t('app.message.projectDirectoryOpenFailed'));
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
      setMessage(result.message ?? t('app.message.namedPathOpenFailed', {
        name: effectiveVirtualPathLabel(entry)
      }));
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
      t('app.dialog.selectGameExecutable'),
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
      'modsDirectory' | 'profilesDirectory' | 'overwriteDirectory'
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

  const openBuildDownloadsDirectory = async () => {
    const path = buildPathDraft.downloadsDirectory.trim();
    if (!path) {
      setMessage(t('app.message.downloadsDirectoryMissing'));
      return;
    }

    try {
      const result = await window.fluxora.shell.openPath(path);
      if (!result.ok) {
        setMessage(result.message ?? t('app.message.downloadsDirectoryOpenFailed'));
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const saveBuildPathSettings = async () => {
    if (!selectedProject) {
      return;
    }

    const validationMessage = validateBuildPathDraft(
      buildPathDraft,
      bridgeStatus?.capabilities?.platform ?? appInfo?.platform ?? 'unknown',
      appLocale
    );
    if (validationMessage) {
      setBuildPathsError(validationMessage);
      setMessage(validationMessage);
      return;
    }

    const operationId = createRendererOperationId('build_paths_save');
    setBuildPathsBusyLabel(t('app.busy.savingBuildPaths'));
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
      setMessage(t('app.message.buildPathsSaved'));
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
      t('app.dialog.saveFluxPack')
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
      title: t('app.operation.packageBuild'),
      statusText: t('app.operation.inspectingBuild'),
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
      setMessage(t('app.message.buildPackagedPath', { path: summary.outputPath }));
      finishOperationOverlay(operationId, t('app.message.buildPackaged', {
        name: summary.buildName || selectedProject.name
      }));
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
    setBusyLabel(t('app.busy.inspectingFluxPack'));
    setMessage(null);

    try {
      const summary = await window.fluxora.fluxPack.inspect(result.path, { operationId });
      setFluxPackSummary(summary);
      setFluxPackInstallResult(null);
      activateRightPane('build');
      setMessage(t('app.message.fluxPackReady', { name: summary.buildName }));
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
      title: isDeltaUpdate ? t('app.operation.updateBuild') : t('app.operation.installBuild'),
      statusText: isDeltaUpdate ? t('app.operation.matchingDelta') : t('app.operation.preparingInstall'),
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
        const resultLabel = result.updatedExistingProject
          ? t('app.message.buildUpdated')
          : t('app.message.fluxPackInstalled');
        const resultVerb = result.updatedExistingProject
          ? t('app.message.updated')
          : t('app.message.installed');
        setMessage(t('app.message.fluxPackWorkspaceFailed', {
          result: resultLabel,
          error: errorMessage(workspaceLoadError)
        }));
        finishOperationOverlay(
          operationId,
          t('app.message.namedBuildResult', {
            result: resultVerb,
            name: result.buildName || opened.name
          })
        );
        await loadCatalog();
        return;
      }

      setLoadedWorkspaceProjectId(opened.id);
      setMessage(result.updatedExistingProject
        ? t('app.message.buildUpdateSummary', {
            name: result.buildName || opened.name,
            sources: result.reusedSourceCount,
            downloads: result.reusedDownloadCount,
            files: result.reusedFileCount
          })
        : t('app.message.fluxPackInstalledNamed', { name: result.buildName || opened.name }));
      finishOperationOverlay(
        operationId,
        t('app.message.namedBuildResult', {
          result: result.updatedExistingProject
            ? t('app.message.updated')
            : t('app.message.installed'),
          name: result.buildName || opened.name
        })
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
        t('app.dialog.chooseBuildFolder'),
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
    setBusyLabel(t('app.busy.checkingLocalFiles'));
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
        setMessage(t('app.message.unsupportedSources', { count: unavailableSources.length }));
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
    setBusyLabel(t('app.busy.inspectingFluxPack'));
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
      setMessage(t('app.message.downloadPageUnavailable', { name: source.displayName }));
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
      setMessage(t('app.message.manualArchivesRequired'));
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
            statusText: t('app.operation.cancellingCreation'),
            currentItem: t('app.operation.cleaningCreatedFiles'),
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
      setMessage(t('app.message.creationCancelledRemoved', { name: project.name }));
      setOperationOverlay((current) =>
        current && current.operationId === sourceOperationId
          ? {
              ...current,
              statusText: t('app.operation.creationCancelled'),
              currentItem: t('app.operation.createdFilesCleaned'),
              percent: 0,
              isRunning: false,
              canClose: true,
              cancelRequested: false,
              createdProject: null,
              resultText: t('app.operation.creationCancelledCleaned'),
              errorText: null
            }
          : current
      );
    } catch (error) {
      const nextMessage = t('app.message.cleanupFailed', { error: errorMessage(error) });
      setMessage(nextMessage);
      setOperationOverlay((current) =>
        current && current.operationId === sourceOperationId
          ? {
              ...current,
              statusText: t('app.operation.cleanupFailed'),
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
              statusText: t('app.operation.cancellingCreation'),
              currentItem: t('app.operation.waitingCore'),
              cancelRequested: true
            }
          : current
      );
      setMessage(t('app.message.creationCleanupPending'));

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
          ? t('app.message.operationCancelRequested')
          : t('app.message.operationCancelUnsupported')
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const createProject = async () => {
    if (!createWizard.validateAll()) {
      return;
    }

    const draft = createWizard.draft;
    const operationId = createRendererOperationId('projects_create');
    beginOperationOverlay({
      operationId,
      kind: 'build-create',
      title: t('app.operation.creatingBuild'),
      statusText: t('app.operation.creatingProjectStructure'),
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
      createWizard.close();
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
        setMessage(t('app.message.creationWorkspaceFailed', {
          error: errorMessage(workspaceLoadError)
        }));
        closeOperationOverlay(operationId);
        return;
      }

      setLoadedWorkspaceProjectId(created.id);
      closeOperationOverlay(operationId);
    } catch (error) {
      if (createCancelRequestsRef.current.has(operationId)) {
        createCancelRequestsRef.current.delete(operationId);
        setMessage(t('app.message.creationCancelled'));
        finishOperationOverlay(operationId, t('app.operation.creationCancelledCleaned'), 0);
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
    const previousLanguage = appLanguage.language ?? bridgeStatus?.language ?? 'en-us';
    dispatchAppLanguage({ type: 'save-requested', language });
    setBridgeStatus((current) => current ? { ...current, language, operationId } : current);
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
      dispatchAppLanguage({ type: 'language-confirmed', language: result.language });
      setBridgeStatus((current) => current
        ? { ...current, language: result.language, operationId: result.operationId }
        : current);
      setMessage(translateForLanguage(result.language, 'app.message.languageSaved', {
        language: result.language
      }));
    } catch (error) {
      dispatchAppLanguage({ type: 'save-failed' });
      setBridgeStatus((current) => current
        ? { ...current, language: previousLanguage, operationId }
        : current);
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
      const bridgeRequest = window.fluxora.bridge.getStatus({ operationId }).then((nextStatus) => {
        const nextThemeMode = normalizeThemeMode(nextStatus.theme);
        setBridgeStatus({ ...nextStatus, theme: nextThemeMode, operationId });
        setThemeMode(nextThemeMode);
      });
      const connectionRequest = window.fluxora.connections.listStatus({ operationId }).then((snapshot) => {
        connectionCoordinator.acceptSnapshot(snapshot);
      });
      const apiLimitsRequest = window.fluxora.apiLimits.list({ operationId }).then((status) => {
        rememberApiLimitProviders(status.providers);
      });
      const [bridgeResult, connectionResult, apiLimitsResult] = await Promise.allSettled([
        bridgeRequest,
        connectionRequest,
        apiLimitsRequest
      ]);

      const failures: unknown[] = [];
      if (bridgeResult.status === 'rejected') {
        failures.push(bridgeResult.reason);
      }
      if (connectionResult.status === 'rejected') {
        failures.push(connectionResult.reason);
      }
      if (apiLimitsResult.status === 'rejected') {
        failures.push(apiLimitsResult.reason);
      }

      if (failures.length > 0) {
        setMessage(errorMessage(failures[0]));
      }
    } finally {
      setApiLimitsBusy(false);
    }
  };

  const toggleConnection = async (providerId: string) => {
    const provider = providerFromSnapshot(connectionSnapshot, providerId);
    const providerAvailable = providerId === 'nexus'
      ? settingsCapabilities.nexusAvailable
      : settingsCapabilities.settingsAvailable;
    const shouldCancelConnect = providerId === 'moddingflow' && (
      provider?.state === 'connecting'
      || (
        connectionBusyProviderId === providerId
        && connectionBusyAction === 'connect'
      )
    );
    if (
      (connectionBusyProviderId && !shouldCancelConnect) ||
      !connectionCanToggle(provider, providerAvailable) ||
      !provider
    ) {
      return;
    }

    const shouldDisconnect = connectionIsReady(provider);
    const action = shouldCancelConnect
      ? 'cancel'
      : shouldDisconnect
        ? 'disconnect'
        : 'connect';
    const operationId = createRendererOperationId(
      action === 'cancel' ? 'connection_cancel_connect' : `connection_${action}`
    );
    const actionGeneration = ++connectionActionGenerationRef.current;
    setConnectionBusyProviderId(providerId);
    setConnectionBusyAction(action);
    setMessage(null);

    try {
      const status = action === 'cancel'
        ? await window.fluxora.connections.cancelConnect(providerId, { operationId })
        : action === 'disconnect'
          ? await window.fluxora.connections.disconnect(providerId, { operationId })
          : await window.fluxora.connections.connect(providerId, { operationId });
      if (actionGeneration !== connectionActionGenerationRef.current) {
        return;
      }
      connectionCoordinator.acceptSnapshot(mergeConnectionStatus(connectionSnapshot, status));
      setMessage(status.message || (
        status.state === 'ready'
          ? t('app.message.providerConnected', { provider: status.label })
          : t('app.message.providerDisconnected', { provider: status.label })
      ));
      if (action !== 'cancel') {
        setApiLimitsBusy(true);
        void window.fluxora.apiLimits.list({ operationId }).then((nextApiLimits) => {
          rememberApiLimitProviders(nextApiLimits.providers);
        }).catch(() => undefined).finally(() => setApiLimitsBusy(false));
      }
    } catch (error) {
      if (actionGeneration === connectionActionGenerationRef.current) {
        setMessage(errorMessage(error));
      }
    } finally {
      if (actionGeneration === connectionActionGenerationRef.current) {
        setConnectionBusyProviderId(null);
        setConnectionBusyAction(null);
      }
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

    createWizard.close();
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
    const path = await pickTransferFolder(t('transfer.source.choose'), transferSourceDirectory);
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
      setTransferError(t('app.message.transferDirectoriesRequired'));
      return null;
    }

    const requestKey = `${sourceDirectory}\n${destinationRootDirectory}`;
    const existingRequest = transferAnalysisRequestRef.current;
    if (existingRequest?.key === requestKey) {
      return existingRequest.promise;
    }

    const operationId = createRendererOperationId('transfer_analyze_mo2');
    setSettingsBusyLabel(t('app.busy.checkingTransfer'));
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
        setMessage(normalizedAnalysis.statusMessage || t('app.message.transferAnalysisComplete'));
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
      setMessage(t('app.message.mo2ImportRunning'));
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
    createWizard.close();
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
          t('app.message.transferUnavailable')
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
    createWizard.close();
    setTransferSourceDirectory(sourceDirectory);
    setTransferDestinationRootDirectory(importDestinationRootDirectory);
    setTransferAnalysis(normalizedAnalysis);
    setTransferRunningOperationId(operationId);
    setTransferCancelRequested(false);
    setTransferProgress({
      operationId,
      phase: 'preparing',
      currentStep: t('transfer.progress.preparing'),
      currentItem: normalizedAnalysis.projectName,
      overallPercent: 0,
      copyPercent: 0,
      databasePercent: 0,
      copiedBytes: 0,
      totalBytes: normalizedAnalysis.totalBytes
    });
    setTransferError(null);
    setTransferResult(null);
    setSettingsBusyLabel(t('app.busy.transferringBuild'));
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
              currentStep: t('transfer.progress.done'),
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
      setMessage(t('app.message.transferComplete', { name: imported.name }));
      await loadCatalog({
        mergeProject: imported,
        preferredProjectId: imported.id,
        keepMergedProjectOnError: true
      });
      setMessage(t('app.message.transferComplete', { name: imported.name }));
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
        const message = t('app.message.transferCancelledCleaned');
        setTransferError(message);
        setTransferProgress((current) =>
          current
            ? {
                ...current,
                phase: 'cancelled',
                currentStep: t('transfer.progress.cancelled'),
                currentItem: t('transfer.progress.tempCleaned'),
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
          ? t('app.message.transferCancelRequested')
          : t('app.message.transferCancelUnsupported')
      );
      if (result.accepted) {
        setTransferError(null);
        setTransferProgress((current) =>
          current
            ? {
                ...current,
                phase: 'canceling',
                currentStep: t('transfer.progress.cancelling'),
                currentItem: current.currentItem || t('transfer.progress.tempFolder')
              }
            : current
        );
      }
      if (!result.accepted) {
        setTransferCancelRequested(false);
        setTransferError(t('app.message.transferCancelBridgeUnsupported'));
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
        aria-label={t('app.ui.namedBuildActions', { name: project.name })}
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
            openBuildRenameDialog(project);
          }}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>{t('app.ui.rename')}</span>
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
          <span>{t('app.ui.openFolder')}</span>
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
          <span>{t('app.ui.delete')}</span>
        </button>
      </div>,
      document.body
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
          buildProjectLibraryStats(
            project,
            isSelected ? selectedProjectRuntimeSummary : undefined,
            bridgeStatus?.language
          )
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
    const sourcePageUrl = item.isMod ? resolveModSourcePageUrl(item) : null;

    if (isModOverwriteItem(item)) {
      return createPortal(
        <div
          className="mod-row-menu mod-row-menu--context"
          role="menu"
          aria-label={t('app.ui.namedActions', { name: modItemTitle(item, appLocale) })}
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
            <span>{t('app.ui.clearOverwrite')}</span>
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
              <span>{t('app.ui.openExplorer')}</span>
            </button>
          ) : null}
        </div>,
        document.body
      );
    }

    const isCollapsed =
      item.isSeparator && modsWorkspace.collapsedSeparatorOrderIds.has(item.orderId);
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
        aria-label={t('app.ui.namedActions', { name: modItemTitle(item, appLocale) })}
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
              <span>{item.isEnabled ? t('app.ui.disable') : t('app.ui.enable')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={modsActionsBusy}
              onClick={() => {
                setModMenuOrderId(null);
                void setAllModsEnabled(true);
              }}
            >
              <MenuIcon source={menuCircleCheckIcon} />
              <span>{t('app.ui.enableAllMods')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={modsActionsBusy}
              onClick={() => {
                setModMenuOrderId(null);
                void setAllModsEnabled(false);
              }}
            >
              <MenuIcon source={menuCircleXIcon} />
              <span>{t('app.ui.disableAllMods')}</span>
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
              <span>{isCollapsed ? t('app.ui.expandSeparator') : t('app.ui.collapseSeparator')}</span>
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
              <span>{t('app.ui.collapseAll')}</span>
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
              <span>{t('app.ui.expandAll')}</span>
            </button>
          </>
        ) : null}
        {item.isMod && !hasMultipleSelectedModRows ? (
          <>
            {sourcePageUrl ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setModMenuOrderId(null);
                  void openInstalledModSource(item);
                }}
              >
                <MenuIcon source={menuOpenExternalIcon} />
                <span>{t('app.ui.openSource')}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setModMenuOrderId(null);
                void openInstalledMod(item);
              }}
            >
              <MenuIcon source={menuFolderOpenIcon} />
              <span>{t('app.ui.openFolder')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={modsActionsBusy}
              onClick={() => {
                setModMenuOrderId(null);
                setModMenuPosition(null);
                openModRenameDialog(item);
              }}
            >
              <Pencil size={14} aria-hidden="true" />
              <span>{itemRenameDialogCopy(bridgeStatus?.language, 'mod').menuRenameLabel}</span>
            </button>
          </>
        ) : null}
        {item.isSeparator ? (
          <button
            className="mod-row-menu__danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setModMenuOrderId(null);
              requestDeleteModSeparatorSelection(item);
            }}
            aria-keyshortcuts="Delete"
          >
            <MenuIcon source={menuTrashIcon} />
            <span>{t('app.ui.deleteSeparator')}</span>
          </button>
        ) : (
          <button
            className="mod-row-menu__danger"
            type="button"
            role="menuitem"
            aria-keyshortcuts="Delete"
            onClick={() => {
              setModMenuOrderId(null);
              requestDeleteInstalledMod(item);
            }}
          >
            <MenuIcon source={menuTrashIcon} />
            <span>{t('app.ui.delete')}</span>
            <span className="mod-row-menu__shortcut" aria-hidden="true">
              {t('common.key.deleteShort')}
            </span>
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
      !nexusConnectionReady ||
      modsActionsBusy ||
      Boolean(operationOverlay?.isRunning);
    const installFluxPackDisabled = !bridgeStatus?.ready || Boolean(operationOverlay?.isRunning);
    const modCreationDisabled =
      !selectedProject ||
      !bridgeStatus?.ready ||
      modsActionsBusy ||
      Boolean(operationOverlay?.isRunning);

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label={t('app.ui.buildActions')}
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
          title={t('app.ui.separatorBottom')}
          disabled={modCreationDisabled}
          onClick={() => openModCreationDialog('separator')}
        >
          <MenuIcon source={menuLayersIcon} />
          <span>{t('app.ui.createSeparator')}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title={t('app.ui.createEmptyMod')}
          disabled={modCreationDisabled}
          onClick={() => openModCreationDialog('empty-mod')}
        >
          <MenuIcon source={menuPlusIcon} />
          <span>{t('app.ui.createEmptyMod')}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title={buildHeaderCapabilities.refreshReason || t('app.ui.checkModUpdates')}
          disabled={checkUpdatesDisabled}
          onClick={() => {
            setModsToolbarMenuPosition(null);
            void checkModUpdates();
          }}
        >
          <MenuIcon source={menuCircleCheckIcon} />
          <span>{t('app.ui.checkUpdates')}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title={buildHeaderCapabilities.packageReason || t('app.ui.exportBuildFluxPack')}
          disabled={packageBuildDisabled}
          onClick={() => {
            setModsToolbarMenuPosition(null);
            void packageFluxPack();
          }}
        >
          <MenuIcon source={menuPackagePlusIcon} />
          <span>{t('app.ui.package')}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          title={t('app.ui.installFluxPack')}
          disabled={installFluxPackDisabled}
          onClick={() => {
            setModsToolbarMenuPosition(null);
            void installFluxPack();
          }}
        >
          <MenuIcon source={menuHardDriveDownloadIcon} />
          <span>{t('app.ui.install')}</span>
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
      aria-label={t('app.ui.loadingMods')}
    >
      <span className="sr-only" role="status">
        {t('app.ui.loadingMods')}
      </span>
      <div className="mod-list__head" role="row">
        <span className="mod-list__head-priority" role="columnheader">
          {t('app.ui.priority')}
        </span>
        <span className="mod-list__head-name" role="columnheader">
          {t('app.ui.name')}
        </span>
        <span role="columnheader">{t('app.ui.version')}</span>
        <span role="columnheader">{t('app.ui.latest')}</span>
        <span role="columnheader">{t('app.ui.status')}</span>
      </div>
      <div className="mod-list__body mod-list__body--loading" role="rowgroup">
        {modLoadingSkeletonRows.map((index) => (
          <div
            aria-hidden="true"
            className="mod-list-row mod-list-row--skeleton"
            key={`mod-skeleton-${index}`}
            role="row"
          >
            <Skeleton className="workspace-skeleton--priority" role="cell" />
            <div className="mod-list-row__identity" role="cell">
              <Skeleton className="workspace-skeleton--toggle" />
              <div className="mod-list-row__title">
                <Skeleton
                  className="workspace-skeleton--title"
                  style={{ width: skeletonWidth(index) }}
                />
                <Skeleton
                  className="workspace-skeleton--meta"
                  style={{ width: skeletonWidth(index, 2) }}
                />
              </div>
            </div>
            <Skeleton className="workspace-skeleton--cell" role="cell" />
            <Skeleton className="workspace-skeleton--cell" role="cell" />
            <Skeleton className="workspace-skeleton--status" role="cell" />
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
          title={t('app.ui.modsUnavailable')}
          description={modsWorkspace.errorMessage ?? t('app.ui.modsLoadFailed')}
          tone="error"
        />
      );
    }

    if (displayedModItems.length === 0) {
      return (
        <EmptyState
          icon={<Box size={18} aria-hidden="true" />}
          title={modsWorkspace.items.length === 0
            ? t('app.ui.noInstalledMods')
            : t('app.ui.noMatchingMods')}
          description={
            modsWorkspace.items.length === 0
              ? t('app.ui.noModsDescription')
              : t('app.ui.noMatchingModsDescription')
          }
        />
      );
    }

    return (
      <div className="mod-list mod-list--table" role="table" aria-label={t('app.ui.modOrder')}>
        <div className="mod-list__head" role="row">
          <span className="mod-list__head-priority" role="columnheader">
            {t('app.ui.priority')}
          </span>
          <span className="mod-list__head-name" role="columnheader">
            {t('app.ui.name')}
          </span>
          <span role="columnheader">{t('app.ui.version')}</span>
          <span role="columnheader">{t('app.ui.latest')}</span>
          <span role="columnheader">{t('app.ui.status')}</span>
        </div>
        <ModsListSurface
          items={displayedModItems}
          presentationRevision={modsListPresentationRevision}
          rowHeight={modRowHeight}
          scrollContainerRef={setModListScrollContainerRef}
          virtualizerRef={modListVirtualizerRef}
          onPointerMove={updateRowReorderDrag}
          onPointerUp={endRowReorderDrag}
          onPointerCancel={cancelRowReorderDrag}
          onScrollActivityChange={handleModsScrollActivityChange}
          renderItem={(item) => {
            const isSelected = modsWorkspace.selectedOrderIds.has(item.orderId);
            const isMenuOpen = item.orderId === modMenuOrderId;
            const isOverwrite = isModOverwriteItem(item);
            const rowView = modRowViewIndex.byOrderId.get(item.orderId);
            const pendingInstallSession = pendingInstallSessionByOrderId.get(item.orderId);
            const isPendingInstall = Boolean(pendingInstallSession);
            const isNested = rowView?.isNested ?? false;
            const isCollapsed = rowView?.isCollapsed ?? false;
            const status = rowView?.status ?? modTableStatusView(item, appLocale);
            const updateFreshness =
              rowView?.updateFreshness ?? modUpdateFreshnessView(
                item,
                currentModUpdateResult,
                bridgeStatus?.language
              );
            const visibleConflictHighlight =
              rowView?.visibleConflictHighlight ?? 'none';
            const visibleConflictMarkerStates =
              rowView?.visibleConflictMarkerStates ?? [];
            const separatorModCount = rowView?.separatorChildCount ?? 0;
            const priority = rowView?.priority;
            const isDragging = draggedModOrderIds.has(item.orderId);
            const isOrderDropTarget =
              modDropTarget?.orderId === item.orderId && !draggedModOrderIds.has(item.orderId);
            const isInstallDropTarget =
              downloadInstallDropTarget?.orderId === item.orderId && !isOverwrite;
            const isDropTarget = isOrderDropTarget || isInstallDropTarget;
            const dropPlacement = isInstallDropTarget
              ? downloadInstallDropTarget?.placement
              : modDropTarget?.placement;
            const canDragModRow = !modsActionsBusy && !isOverwrite;
            const rowPresentationKey = [
              modOrderItemPresentationKey(item),
              rowView ? modRowViewPresentationKey(rowView) : '',
              listPresentationToken(pendingInstallSession),
              isSelected ? 1 : 0,
              isMenuOpen ? 1 : 0,
              isDragging ? 1 : 0,
              isDropTarget ? dropPlacement ?? 'drop' : '',
              isInstallDropTarget ? 1 : 0,
              canDragModRow ? 1 : 0,
              postInstallRevealOrderId === item.orderId ? 1 : 0
            ].join(':');

            return (
              <ModRow orderId={item.orderId} presentationKey={rowPresentationKey}>
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
                data-state={postInstallRevealOrderId === item.orderId ? 'post-install-reveal' : undefined}
                key={item.orderId}
                aria-label={`${modItemTitle(item, appLocale)} ${isOverwrite
                  ? t('mod.status.overwriteFolder')
                  : item.isSeparator
                    ? t('mod.overwrite.separator')
                    : t('app.ui.mod')}${visibleConflictMarkerStates.length > 0
                      ? ` ${visibleConflictMarkerStates.map((state) => t(modConflictMarkerKeys[state])).join(' · ')}`
                      : ''}`}
                aria-expanded={item.isSeparator && separatorModCount > 0 ? !isCollapsed : undefined}
                aria-selected={isSelected}
                onClick={(event) => {
                  if (consumeSuppressedRowClick()) {
                    return;
                  }

                  const shouldOpenModDetails =
                    event.detail === 2 && !isInteractiveRowDragTarget(event.target);
                  event.currentTarget.focus({ preventScroll: true });
                  handleModRowSelection(event, item);
                  if (item.isMod && !isOverwrite && !isPendingInstall) {
                    if (shouldOpenModDetails) {
                      void openModDetailsWindow(item);
                    } else {
                      void preloadModDetailsContent(item).catch(() => undefined);
                    }
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (isPendingInstall) {
                    return;
                  }
                  if (!modsWorkspace.selectedOrderIds.has(item.orderId)) {
                    dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  }
                  setModMenuPosition(
                    rowContextMenuPositionFromPointer(
                      event.clientX,
                      event.clientY,
                      modRowMenuEstimatedHeight(item, modsWorkspace.selectedOrderIds)
                    )
                  );
                  setModMenuOrderId(item.orderId);
                }}
                onPointerDown={(event) => {
                  if (!beginRowReorderDrag(event, 'mod', item.orderId, canDragModRow)) {
                    return;
                  }

                  if (!modsWorkspace.selectedOrderIds.has(item.orderId)) {
                    dispatchModsWorkspace({ type: 'selected', orderId: item.orderId });
                  }
                  setModMenuOrderId(null);
                }}
                onPointerMove={updateRowReorderDrag}
                onPointerUp={endRowReorderDrag}
                onPointerCancel={cancelRowReorderDrag}
                onKeyDown={(event) => {
                  handleModRowKeyDown(event, item);
                }}
                onAnimationEnd={(event) =>
                  handlePostInstallModRevealAnimationEnd(item.orderId, event)
                }
              >
                {isDropTarget && dropPlacement !== 'inside' ? (
                  <span className="row-drop-target-chip" aria-hidden="true">
                    {isInstallDropTarget ? t('app.ui.installHere') : t('app.ui.moveHere')}
                  </span>
                ) : null}
                {isOverwrite ? (
                  <>
                    <div className="mod-overwrite-cell" role="cell">
                      <span className="mod-overwrite-icon" aria-hidden="true">
                        <FolderOpen size={16} />
                      </span>
                      <div className="mod-overwrite-title">
                        <strong>{modItemTitle(item, appLocale)}</strong>
                        <span>{item.id || t('app.ui.overwrite')}</span>
                      </div>
                      <span className="mod-overwrite-state-cell" data-status="local">
                        <StatusDot
                          label={t('app.ui.overwriteOutputFolder')}
                          size={20}
                          state="none"
                          title={t('app.ui.generatedFiles')}
                        />
                      </span>
                    </div>
                    {isMenuOpen ? renderModRowMenu(item) : null}
                  </>
                ) : item.isSeparator ? (
                  <>
                    <span className="mod-list-row__priority" role="cell" />
                    <div className="mod-separator-cell" role="cell">
                      {separatorModCount > 0 ? (
                        <button
                          className="separator-toggle-button mod-separator-toggle-button"
                          type="button"
                          title={isCollapsed ? t('app.ui.expandSeparator') : t('app.ui.collapseSeparator')}
                          aria-label={`${isCollapsed
                            ? t('app.ui.expandSeparator')
                            : t('app.ui.collapseSeparator')} ${modItemTitle(item, appLocale)}`}
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
                      ) : null}
                      <strong className="mod-separator-title">{modItemTitle(item, appLocale)}</strong>
                    </div>
                    <span className="mod-list-row__status mod-separator-status" role="cell">
                      <span className="mod-separator-count">
                        {t('app.ui.modCount', { count: separatorModCount })}
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
                    <span className="mod-list-row__priority" role="cell">
                      {priority}
                    </span>
                    <div className="mod-list-row__identity" role="cell">
                      <label
                        className="mod-enable-checkbox"
                        title={item.isEnabled ? t('app.ui.disableMod') : t('app.ui.enableMod')}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          className="flx-checkbox__native"
                          type="checkbox"
                          checked={item.isEnabled}
                          disabled={modsActionsBusy || isPendingInstall}
                          aria-label={`${item.isEnabled
                            ? t('app.ui.disableMod')
                            : t('app.ui.enableMod')} ${modItemTitle(item, appLocale)}`}
                          title={item.isEnabled ? t('app.ui.disableMod') : t('app.ui.enableMod')}
                          onChange={(event) => void setModEnabled(item, event.currentTarget.checked)}
                        />
                        <span aria-hidden="true" className="flx-checkbox__box" />
                      </label>
                      <div className="mod-list-row__title">
                        <strong>{modItemTitle(item, appLocale)}</strong>
                        <span>{item.sourceIsNexus
                          ? t('app.ui.nexusMods')
                          : item.isLocal
                            ? t('app.ui.local')
                            : t('app.ui.managed')}</span>
                      </div>
                    </div>
                    <span className="mod-list-row__version" role="cell">
                      {modVersionText(item, appLocale)}
                    </span>
                    <span
                      className="mod-list-row__latest"
                      data-version-mismatch={modLatestVersionDiffers(item)}
                      role="cell"
                      title={updateFreshness.title || undefined}
                    >
                      <span className="mod-list-row__latest-value">
                        {modLatestVersionText(item, appLocale)}
                      </span>
                      {updateFreshness.label ? (
                        <span
                          className="mod-list-row__latest-freshness"
                          data-tone={updateFreshness.tone}
                        >
                          {updateFreshness.label}
                        </span>
                      ) : null}
                    </span>
                    <span className="mod-list-row__status" role="cell">
                      <span
                        className="mod-overwrite-state-cell"
                        data-status={status.tone}
                        data-pending={isPendingInstall}
                        title={isPendingInstall ? undefined : status.overwrite.title}
                      >
                        {isPendingInstall && pendingInstallSession ? (
                          <ModInstallProgressLabel
                            fallbackLabel={item.version}
                            operationId={pendingInstallSession.operationId}
                            orderId={item.orderId}
                            progressStore={pendingInstallOrchestrator.progressStore}
                          />
                        ) : (
                          <StatusDot
                            className="mod-conflict-dot"
                            label={status.overwrite.title}
                            size={20}
                            state={status.overwrite.state}
                            title={status.overwrite.title}
                          />
                        )}
                      </span>
                    </span>
                    {isMenuOpen && !isPendingInstall ? renderModRowMenu(item) : null}
                  </>
                )}
                </div>
              </ModRow>
            );
          }}
        />
        <ModConflictScrollbar
          contentHeight={displayedModItems.length * modRowHeight}
          markers={modConflictScrollbarMarkers}
          scrollContainerRef={modListScrollContainerRef}
        />
      </div>
    );
  };

  const renderFileTreeEntries = (relativeDirectory = '', depth = 0): ReactElement[] => {
    const entries = fileTreeCache[relativeDirectory] ?? [];
    return entries.flatMap((entry) => {
      const isExpanded = Boolean(expandedFileTree[entry.relativePath]);
      const previewKind = entry.isDirectory ? null : previewKindForFile(entry.name);
      const canEditFile = !entry.isDirectory && isTextEditorFileName(entry.name);
      const canPreviewFile = !entry.isDirectory && previewKind !== null;
      const row = (
        <div
          className="file-tree-row"
          data-conflict={hasConflict(entry)}
          data-ai-highlight={
            initialModDetailsBootstrap?.highlightRelativePath?.replaceAll('\\', '/') ===
            entry.relativePath.replaceAll('\\', '/')
          }
          key={entry.relativePath || entry.name}
          role="treeitem"
          aria-expanded={entry.isDirectory && entry.hasChildren ? isExpanded : undefined}
          aria-level={depth + 1}
          style={{ paddingLeft: 10 + depth * 16 }}
        >
          <button
            className="icon-button"
            type="button"
            title={entry.isDirectory ? t('app.ui.toggleFolder') : t('app.ui.file')}
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
              title={isExpanded
                ? t('app.ui.closeNamed', { name: entry.name })
                : t('app.ui.openNamed', { name: entry.name })}
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
              title={t('app.ui.openNamed', { name: entry.name })}
            >
              {entry.name}
            </button>
          ) : (
            <button
              className="file-tree-file-link"
              type="button"
              onClick={() => void openTextEditorForFile(entry)}
              title={t('app.ui.openNamed', { name: entry.name })}
            >
              {entry.name}
            </button>
          )}
          <span className="file-tree-row__meta">
            <strong>{formatFileSize(entry.size)}</strong>
            {canEditFile ? (
              <button
                className="icon-button file-tree-row__action"
                type="button"
                title={t('app.ui.editNamed', { name: entry.name })}
                aria-label={t('app.ui.editNamed', { name: entry.name })}
                onClick={() => void openTextEditorForFile(entry)}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            ) : canPreviewFile ? (
              <button
                className="icon-button file-tree-row__action"
                type="button"
                title={t('app.action.openNamed', { name: entry.name })}
                aria-label={t('app.action.openNamed', { name: entry.name })}
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
    <aside className="inspector mods-inspector" aria-label={t('app.ui.selectedModDetails')}>
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">{t('app.ui.selectedMod')}</p>
          <h2>{selectedModItem ? modItemTitle(selectedModItem, appLocale) : t('app.ui.none')}</h2>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>{t('app.ui.installed')}</dt>
          <dd>{installedMods.length}</dd>
        </div>
        <div>
          <dt>{t('app.ui.visible')}</dt>
          <dd>{filteredModItems.length}</dd>
        </div>
        <div>
          <dt>{t('app.ui.status')}</dt>
          <dd>{modStatusText(selectedModItem, appLocale)}</dd>
        </div>
        <div>
          <dt>{t('app.ui.version')}</dt>
          <dd>{selectedModItem?.isMod
            ? selectedModItem.version || t('app.ui.local')
            : isModOverwriteItem(selectedModItem)
              ? t('app.source.overwrite')
              : t('mod.overwrite.separator')}</dd>
        </div>
        <div>
          <dt>{t('app.ui.files')}</dt>
          <dd>{selectedModItem?.isMod ? selectedModItem.fileCount : 0}</dd>
        </div>
        <div>
          <dt>{t('app.ui.conflicts')}</dt>
          <dd>
            {selectedModItem?.isMod
              ? selectedModItem.conflictingFileCount || selectedModItem.conflictStatus || t('app.ui.noConflicts')
              : t('app.ui.noConflicts')}
          </dd>
        </div>
      </dl>
      <div className="file-tree-panel">
        <div className="file-tree-panel__header">
          <FolderTree size={16} aria-hidden="true" />
          <strong>{t('app.ui.fileTree')}</strong>
          {selectedModItem?.isMod ? (
            <button
              className="icon-button"
              type="button"
              title={t('app.ui.reloadFileTree')}
              onClick={() => void loadModFileTree('', selectedModItem)}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="file-tree" role="tree" aria-label={t('app.ui.selectedModFileTree')}>
          {!selectedModItem?.isMod ? (
            <span className="file-tree-empty">{t('app.ui.selectInstalledMod')}</span>
          ) : fileTreeState === 'loading' ? (
            <span className="file-tree-empty">{t('app.ui.loadingTree')}</span>
          ) : fileTreeState === 'error' ? (
            <span className="file-tree-empty">{t('app.ui.fileTreeUnavailable')}</span>
          ) : (fileTreeCache[''] ?? []).length === 0 ? (
            <span className="file-tree-empty">{t('app.ui.noIndexedFiles')}</span>
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
    const modTitle = modItem
      ? modItemTitle(modItem, appLocale)
      : modDetailsInitialName || t('app.ui.mod');
    const overwrite = modItem ? modOverwriteView(modItem, appLocale) : null;
    const fileCount = initialModDetailsBootstrap?.content
      ? initialModDetailsBootstrap.content.directories.reduce(
          (total, directory) =>
            total + directory.entries.filter((entry) => !entry.isDirectory).length,
          0
        )
      : modItem
        ? modItem.fileCount
        : 0;
    const overwritesCount =
      modDetailsConflictPage?.totalOverwrites ?? (modItem ? modItem.overwritingFileCount : 0);
    const overwrittenCount =
      modDetailsConflictPage?.totalOverwritten ?? (modItem ? modItem.overwrittenFileCount : 0);
    const projectTitle = selectedProject?.name ?? initialModDetailsBootstrap?.projectName ?? t('app.ui.build');

    return (
      <section className="mod-details-window" aria-label={t('app.ui.modDetails')}>
        <header className="mod-details-header">
          <div className="mod-details-title">
            <span>{projectTitle}</span>
            <h2>{modTitle}</h2>
          </div>
          <dl className="mod-details-facts" aria-label={t('app.ui.modSummary')}>
            <div>
              <dt>{t('app.ui.files')}</dt>
              <dd>{modReady ? fileCount : '...'}</dd>
            </div>
            <div>
              <dt>{t('app.ui.overwrites')}</dt>
              <dd>{modReady ? overwritesCount : '...'}</dd>
            </div>
            <div>
              <dt>{t('app.ui.overwritten')}</dt>
              <dd>{modReady ? overwrittenCount : '...'}</dd>
            </div>
            <div>
              <dt>{t('app.ui.status')}</dt>
              <dd>{overwrite?.label || modStatusText(modItem, appLocale)}</dd>
            </div>
          </dl>
        </header>

        <div className="mod-details-tabs" role="tablist" aria-label={t('app.ui.modDetailsSections')}>
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
          aria-label={modDetailsTab === 'files' ? t('app.tab.files') : t('app.tab.conflicts')}
        >
          {modDetailsTab === 'files' ? (
            <div className="file-tree mod-details-file-tree" role="tree" aria-label={t('app.ui.modFileTree')}>
              {!modReady ? (
                <span className="file-tree-empty">{t('app.ui.modUnavailable')}</span>
              ) : fileTreeState === 'error' ? (
                <span className="file-tree-empty">{t('app.ui.fileTreeUnavailable')}</span>
              ) : fileTreeState === 'loading' && (fileTreeCache[''] ?? []).length === 0 ? null : (
                fileTreeCache[''] ?? []
              ).length === 0 ? (
                <span className="file-tree-empty">{t('app.ui.noIndexedFiles')}</span>
              ) : (
                renderFileTreeEntries()
              )}
            </div>
          ) : (
            <div className="mod-details-conflicts">
              <section aria-label={t('app.ui.overwrites')}>
                <header>
                  <strong>{t('app.ui.overwritesColon')}</strong>
                  <span>{overwritesCount}</span>
                </header>
                {modDetailsConflictScanState === 'error' ? (
                  <span className="mod-details-empty">{t('app.ui.conflictsUnavailable')}</span>
                ) : modDetailsConflictScanState === 'loading' && !modDetailsConflictPage ? null : (
                  renderModDetailsConflictList(
                    modDetailsConflictEntries.overwrites,
                    t('app.ui.noOverwrittenFiles')
                  )
                )}
              </section>
              <section aria-label={t('app.ui.overwrittenBy')}>
                <header>
                  <strong>{t('app.ui.overwrittenByColon')}</strong>
                  <span>{overwrittenCount}</span>
                </header>
                {modDetailsConflictScanState === 'error' ? (
                  <span className="mod-details-empty">{t('app.ui.conflictsUnavailable')}</span>
                ) : modDetailsConflictScanState === 'loading' && !modDetailsConflictPage ? null : (
                  renderModDetailsConflictList(
                    modDetailsConflictEntries.overwritten,
                    t('app.ui.noOverwritingFiles')
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
          <h2>{t('app.ui.noBuild')}</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            {t('app.ui.goHome')}
          </button>
        </section>
      );
    }

    return (
      <section className="mods-layout" aria-label={t('app.ui.buildModsWorkspace')}>
        <section
          className="work-surface mods-surface"
          data-download-install-active={Boolean(draggedDownloadInstallId)}
        >
          <div className="surface-header">
            <div>
              <p className="eyebrow">{t('app.ui.mods')}</p>
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
    const selectedPluginItems = pluginsWorkspace.items.filter(
      (candidate) =>
        candidate.isPlugin && pluginsWorkspace.selectedOrderIds.has(candidate.orderId)
    );
    const selectedPluginEnableTargets = selectedPluginItems.filter(
      (candidate) => !candidate.isLocked && !candidate.isEnabled
    );
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
    const separatorCopy = pluginSeparatorCopy(bridgeStatus?.language);

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label={t('app.ui.namedActions', { name: pluginItemTitle(item, appLocale) })}
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
            <button
              type="button"
              role="menuitem"
              disabled={
                pluginsActionsBusy ||
                !pluginCapabilities.loadOrderSupported
              }
              onClick={() => {
                setPluginMenuOrderId(null);
                openPluginSeparatorDialog(item);
              }}
            >
              <MenuIcon source={menuLayersIcon} />
              <span>{separatorCopy.menuLabel}</span>
            </button>
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
                <span>{t('app.ui.openExplorer')}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={
                pluginsActionsBusy ||
                !pluginCapabilities.bulkToggleSupported ||
                selectedPluginEnableTargets.length === 0
              }
              onClick={() => {
                setPluginMenuOrderId(null);
                void setSelectedPluginsEnabled(true);
              }}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>
                {t('app.ui.enableSelectedPlugin', { count: selectedPluginItems.length })}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={pluginsActionsBusy || !pluginCapabilities.bulkToggleSupported}
              onClick={() => {
                setPluginMenuOrderId(null);
                void setAllPluginsEnabled(true);
              }}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>{t('app.ui.enableAllPlugins')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={pluginsActionsBusy || !pluginCapabilities.bulkToggleSupported}
              onClick={() => {
                setPluginMenuOrderId(null);
                void setAllPluginsEnabled(false);
              }}
            >
              <XCircle size={14} aria-hidden="true" />
              <span>{t('app.ui.disableAllPlugins')}</span>
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
              <span>{isCollapsed ? t('app.ui.expandSeparator') : t('app.ui.collapseSeparator')}</span>
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
              <span>{t('app.ui.collapseAll')}</span>
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
              <span>{t('app.ui.expandAll')}</span>
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
              requestDeletePluginSeparatorSelection(item);
            }}
            aria-keyshortcuts="Delete"
          >
            <MenuIcon source={menuTrashIcon} />
            <span>{t('app.ui.deleteSeparator')}</span>
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
      aria-label={t('app.ui.loadingPlugins')}
    >
      <span className="sr-only" role="status">
        {t('app.ui.loadingPlugins')}
      </span>
      <div className="mod-row plugin-row mod-row--head" role="row">
        <span role="columnheader">{t('app.ui.order')}</span>
        <span role="columnheader">{t('app.ui.plugin')}</span>
        <span role="columnheader">{t('app.ui.source')}</span>
        <span role="columnheader">{t('app.ui.status')}</span>
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
              <Skeleton className="workspace-skeleton--hex" />
            </span>
            <div className="mod-row__main plugin-row__main" role="cell">
              <Skeleton className="workspace-skeleton--toggle" />
              <div className="plugin-row__title">
                <Skeleton
                  className="workspace-skeleton--title"
                  style={{ width: skeletonWidth(index, 1) }}
                />
                <Skeleton
                  className="workspace-skeleton--meta"
                  style={{ width: skeletonWidth(index, 3) }}
                />
              </div>
            </div>
            <Skeleton className="workspace-skeleton--cell" role="cell" />
            <Skeleton className="workspace-skeleton--status" role="cell" />
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
          title={t('app.ui.pluginsUnavailable')}
          description={pluginsWorkspace.errorMessage ?? t('app.ui.pluginsLoadFailed')}
          tone="error"
        />
      );
    }

    if (filteredPluginItems.length === 0) {
      return (
        <EmptyState
          icon={<MoreHorizontal size={18} aria-hidden="true" />}
          title={pluginsWorkspace.items.length === 0
            ? t('app.ui.noDetectedPlugins')
            : t('app.ui.noMatchingPlugins')}
          description={
            pluginsWorkspace.items.length === 0
              ? t('app.ui.noPluginsDescription')
              : t('app.ui.noMatchingPluginsDescription')
          }
        />
      );
    }

    return (
      <div className="mod-table plugin-table" role="table" aria-label={t('app.ui.pluginLoadOrder')}>
        <div className="mod-row plugin-row mod-row--head" role="row">
          <span role="columnheader">{t('app.ui.order')}</span>
          <span role="columnheader">{t('app.ui.plugin')}</span>
          <span role="columnheader">{t('app.ui.source')}</span>
          <span role="columnheader">{t('app.ui.status')}</span>
        </div>
        <PluginsListSurface
          items={filteredPluginItems}
          presentationRevision={pluginsListPresentationRevision}
          rowHeight={pluginRowHeight}
          virtualizerRef={pluginListVirtualizerRef}
          onPointerMove={updateRowReorderDrag}
          onPointerUp={endRowReorderDrag}
          onPointerCancel={cancelRowReorderDrag}
          onScrollActivityChange={handlePluginsScrollActivityChange}
          renderItem={(item) => {
            const isSelected = pluginsWorkspace.selectedOrderIds.has(item.orderId);
            const isMenuOpen = item.orderId === pluginMenuOrderId;
            const rowView = pluginRowViewIndex.byOrderId.get(item.orderId);
            const isNested = rowView?.isNested ?? false;
            const isCollapsed = rowView?.isCollapsed ?? false;
            const separatorPluginCount = rowView?.separatorChildCount ?? 0;
            const isDragging = draggedPluginOrderIds.has(item.orderId);
            const isDropTarget =
              pluginDropTarget?.orderId === item.orderId && !draggedPluginOrderIds.has(item.orderId);
            const blockedDropReason =
              isDropTarget ? pluginDropTarget?.blockedReason ?? null : null;
            const canDragPluginRow =
              pluginCapabilities.loadOrderSupported &&
              !pluginsActionsBusy &&
              canDragPluginOrderItem(pluginsWorkspace.items, item.orderId);
            const missingMasterSummary =
              rowView?.missingMasterSummary ??
              pluginMissingMasterSummary(null, pluginMissingMasterStatusLimit);
            const hasMissingMasters =
              showPluginMissingMastersStatus && missingMasterSummary.totalCount > 0;
            const missingMasterLabel = item.isSeparator
              ? t('app.ui.pluginMissingMasters', {
                  name: pluginItemTitle(item, appLocale),
                  masters: missingMasterSummary.visibleMasters.join(', '),
                  more: missingMasterSummary.hiddenCount > 0
                    ? t('app.ui.moreMasters', { count: missingMasterSummary.hiddenCount })
                    : ''
                })
              : undefined;
            const rowPresentationKey = [
              pluginOrderItemPresentationKey(item),
              rowView ? pluginRowViewPresentationKey(rowView) : '',
              isSelected ? 1 : 0,
              isMenuOpen ? 1 : 0,
              isDragging ? 1 : 0,
              isDropTarget ? pluginDropTarget?.placement ?? 'drop' : '',
              blockedDropReason ?? '',
              canDragPluginRow ? 1 : 0,
              hasMissingMasters ? 1 : 0
            ].join(':');

            return (
              <PluginRow orderId={item.orderId} presentationKey={rowPresentationKey}>
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
                data-drop-blocked={Boolean(blockedDropReason)}
                data-drop-placement={isDropTarget ? pluginDropTarget?.placement : undefined}
                data-reorder-disabled={!canDragPluginRow}
                data-menu-open={isMenuOpen}
                key={item.orderId}
                aria-label={`${pluginItemTitle(item, appLocale)} ${item.isSeparator
                  ? t('mod.overwrite.separator')
                  : t('app.ui.plugin')}${
                  hasMissingMasters ? ` ${t('app.ui.missingMastersSuffix')}` : ''
                }${blockedDropReason ? ` ${blockedDropReason}` : ''}`}
                aria-expanded={item.isSeparator && separatorPluginCount > 0 ? !isCollapsed : undefined}
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

                  if (!pluginsWorkspace.selectedOrderIds.has(item.orderId)) {
                    dispatchPluginsWorkspace({ type: 'selected', orderId: item.orderId });
                  }
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
                  <span
                    className={`row-drop-target-chip${
                      blockedDropReason ? ' row-drop-target-chip--blocked' : ''
                    }`}
                    aria-hidden={blockedDropReason ? undefined : true}
                    role={blockedDropReason ? 'status' : undefined}
                    title={blockedDropReason ?? undefined}
                  >
                    {blockedDropReason ? t('app.ui.cannotMove') : t('app.ui.moveHere')}
                  </span>
                ) : null}
                <span className="plugin-hex-index" role="cell">
                  {item.isSeparator && separatorPluginCount > 0 ? (
                    <button
                      className="separator-toggle-button"
                      type="button"
                      title={isCollapsed ? t('app.ui.expandSeparator') : t('app.ui.collapseSeparator')}
                      aria-label={`${isCollapsed
                        ? t('app.ui.expandSeparator')
                        : t('app.ui.collapseSeparator')} ${pluginItemTitle(item, appLocale)}`}
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
                      title={item.isEnabled ? t('app.ui.disablePlugin') : t('app.ui.enablePlugin')}
                      onClick={(event) => event.stopPropagation()}
                    >
                        <input
                          className="flx-checkbox__native"
                          type="checkbox"
                          checked={item.isEnabled}
                          disabled={item.isLocked || pluginsActionsBusy}
                          aria-label={
                            item.isEnabled
                              ? t('app.ui.disableNamed', { name: pluginItemTitle(item, appLocale) })
                              : t('app.ui.enableNamed', { name: pluginItemTitle(item, appLocale) })
                        }
                        title={item.isEnabled ? t('app.ui.disablePlugin') : t('app.ui.enablePlugin')}
                          onChange={(event) => void setPluginEnabled(item, event.currentTarget.checked)}
                        />
                      <span aria-hidden="true" className="flx-checkbox__box" />
                    </label>
                  ) : null}
                  <div className="plugin-row__title">
                    <strong>{pluginItemTitle(item, appLocale)}</strong>
                    <span>
                      {item.isSeparator
                        ? t('app.ui.pluginsCount', { count: separatorPluginCount })
                        : pluginSourceLabel(item, appLocale)}
                    </span>
                  </div>
                </div>
                <span role="cell">{item.isSeparator ? '' : item.sourceMod || t('app.ui.gameData')}</span>
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
              </PluginRow>
            );
          }}
        />
      </div>
    );
  };

  const renderPluginsInspector = () => (
    <aside className="inspector plugins-inspector" aria-label={t('app.ui.selectedPluginDetails')}>
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">{t('app.ui.selectedPlugin')}</p>
          <h2>{selectedPluginItem ? pluginItemTitle(selectedPluginItem, appLocale) : t('app.ui.none')}</h2>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>{t('app.ui.entries')}</dt>
          <dd>{pluginsWorkspace.items.length}</dd>
        </div>
        <div>
          <dt>{t('app.ui.visible')}</dt>
          <dd>{filteredPluginItems.length}</dd>
        </div>
        <div>
          <dt>{t('app.ui.status')}</dt>
          <dd>{pluginStatusText(selectedPluginItem, appLocale)}</dd>
        </div>
        <div>
          <dt>{t('app.ui.type')}</dt>
          <dd>{pluginTypeLabel(selectedPluginItem, appLocale)}</dd>
        </div>
        <div>
          <dt>{t('app.ui.sourceMod')}</dt>
          <dd>{selectedPluginItem?.isPlugin
            ? selectedPluginItem.sourceMod || t('app.ui.gameData')
            : t('app.ui.noConflicts')}</dd>
        </div>
        <div>
          <dt>{t('app.ui.missingMasters')}</dt>
          <dd>
            {selectedPluginItem?.isPlugin && selectedPluginItem.missingMasters.length > 0
              ? selectedPluginItem.missingMasters.join(', ')
              : t('app.ui.noConflicts')}
          </dd>
        </div>
        <div>
          <dt>{t('app.ui.lock')}</dt>
          <dd>{selectedPluginItem?.isLocked
            ? selectedPluginItem.lockReason || t('app.ui.locked')
            : t('app.ui.noConflicts')}</dd>
        </div>
      </dl>
      <div className="plugin-capability-panel">
        <strong>{t('app.ui.capability')}</strong>
        <span>
          {pluginCapabilities.loadOrderSupported
            ? t('app.ui.pluginEditingAvailable')
            : pluginCapabilities.reason || t('app.ui.pluginEditingUnavailable')}
        </span>
      </div>
    </aside>
  );

  const renderPluginsWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>{t('app.ui.noBuild')}</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            {t('app.ui.goHome')}
          </button>
        </section>
      );
    }

    if (!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported) {
      return (
        <section className="center-empty" aria-label={t('app.ui.pluginsCapability')}>
          <MoreHorizontal size={22} aria-hidden="true" />
          <h2>{t('app.ui.pluginsUnavailable')}</h2>
          <span>{pluginCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout plugins-layout" aria-label={t('app.ui.buildPluginsWorkspace')}>
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">{t('app.tab.plugins')}</p>
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

    return createPortal(
      <div
        className="mod-row-menu mod-row-menu--context"
        role="menu"
        aria-label={t('app.ui.namedActions', { name: downloadTitle(entry, appLocale) })}
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
          disabled={!entry.canInstall}
          onClick={() => {
            setDownloadMenuId(null);
            void installDownload(entry);
          }}
        >
          <MenuIcon source={menuPackagePlusIcon} />
          {t('app.ui.install')}
        </button>
        {entry.isDownloading ? (
          <button
            type="button"
            role="menuitem"
            disabled={downloadsActionsBusy}
            onClick={() => {
              setDownloadMenuId(null);
              void cancelDownload(entry);
            }}
          >
            <MenuIcon source={menuCircleXIcon} />
            {t('app.ui.cancel')}
          </button>
        ) : null}
        {entry.canResume ? (
          <button
            type="button"
            role="menuitem"
            disabled={downloadsActionsBusy}
            onClick={() => {
              setDownloadMenuId(null);
              void resumeDownload(entry);
            }}
          >
            <MenuIcon source={menuPlayIcon} />
            {t('app.ui.resume')}
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
          {t('app.ui.showInFolder')}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!entry.canInstall || downloadsActionsBusy}
          onClick={() => {
            setDownloadMenuId(null);
            setDownloadMenuPosition(null);
            openDownloadRenameDialog(entry);
          }}
        >
          <Pencil size={14} aria-hidden="true" />
          <span>{itemRenameDialogCopy(bridgeStatus?.language, 'download').menuRenameLabel}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setDownloadMenuId(null);
            setDownloadMenuPosition(null);
            void copyDownloadPath(entry);
          }}
        >
          <Copy size={14} aria-hidden="true" />
          <span>{itemRenameDialogCopy(bridgeStatus?.language, 'download').copyPathLabel}</span>
        </button>
        <button
          className="mod-row-menu__danger"
          type="button"
          role="menuitem"
          aria-keyshortcuts="Delete"
          disabled={downloadDeleteTargets.length === 0 || downloadsActionsBusy}
          onClick={() => {
            setDownloadMenuId(null);
            requestDeleteDownload(entry);
          }}
        >
          <MenuIcon source={menuTrashIcon} />
          <span>{t('app.ui.delete')}</span>
          <span className="mod-row-menu__shortcut" aria-hidden="true">
            {t('common.key.deleteShort')}
          </span>
        </button>
      </div>,
      document.body
    );
  };

  const renderDownloadSkeletonRows = () => (
    <div
      className="mod-table download-table download-table--skeleton"
      role="table"
      aria-label={t('app.ui.downloads')}
      aria-busy="true"
    >
      <div className="mod-row download-row mod-row--head" role="row">
        <span role="columnheader">{t('app.ui.file')}</span>
        <span role="columnheader">{t('app.ui.status')}</span>
        <span role="columnheader">{t('app.ui.size')}</span>
        <span role="columnheader">{t('app.ui.source')}</span>
      </div>
      <div className="mod-table__body" role="rowgroup">
        {downloadSkeletonRows.map((row) => (
          <div className="mod-row download-row download-row--skeleton" role="row" key={row.id}>
            <div className="mod-row__main" role="cell">
              <Skeleton
                className="download-skeleton--title"
                style={{ width: `${row.titleWidth}%` }}
              />
            </div>
            <div className="download-progress download-progress--skeleton" role="cell">
              <div
                className="download-progress__bar download-progress__bar--skeleton"
                aria-hidden="true"
              >
                <Skeleton
                  className="download-progress__fill-skeleton"
                  style={{ width: `${row.barWidth}%` }}
                />
              </div>
              <Skeleton
                className="download-skeleton--progress-text"
                style={{ width: `${row.progressWidth}%` }}
              />
            </div>
            <span role="cell">
              <Skeleton
                className="download-skeleton--size"
                style={{ width: `${row.sizeWidth}%` }}
              />
            </span>
            <span role="cell">
              <Skeleton
                className="download-skeleton--source"
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
        ? t('app.ui.addingArchiveStatus')
        : downloadDropCue === 'hover'
          ? t('app.ui.dropArchiveStatus')
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
                <strong>{downloadDropCue === 'importing'
                  ? t('app.ui.addingArchive')
                  : t('app.ui.dropArchive')}</strong>
                <span>{t('app.ui.downloads')}</span>
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
          title={t('app.ui.downloadsUnavailable')}
          description={downloadsWorkspace.errorMessage ?? t('app.ui.downloadsLoadFailed')}
          tone="error"
        />
      );
    }

    if (filteredDownloadItems.length === 0) {
      return (
        <EmptyState
          icon={<Download size={18} aria-hidden="true" />}
          title={downloadsWorkspace.items.length === 0
            ? t('app.ui.noDownloads')
            : t('app.ui.noMatchingDownloads')}
          description={
            downloadsWorkspace.items.length === 0
              ? t('app.ui.noDownloadsDescription')
              : t('app.ui.noMatchingDownloadsDescription')
          }
        />
      );
    }

    return (
      <div className="mod-table download-table" role="table" aria-label={t('app.ui.downloads')}>
        <div className="mod-row download-row mod-row--head" role="row">
          <span role="columnheader">{t('app.ui.file')}</span>
          <span role="columnheader">{t('app.ui.status')}</span>
          <span role="columnheader">{t('app.ui.size')}</span>
          <span role="columnheader">{t('app.ui.source')}</span>
        </div>
        <AdaptiveVirtualList
          className="mod-table__body"
          items={filteredDownloadItems}
          rowHeight={downloadRowHeight}
          getItemKey={(entry) => entry.id}
          virtualizerRef={downloadListVirtualizerRef}
          onPointerMove={updateRowReorderDrag}
          onPointerUp={endRowReorderDrag}
          onPointerCancel={cancelRowReorderDrag}
          renderItem={(entry) => {
            const isSelected = downloadsWorkspace.selectedIds.has(entry.id);
            const isMenuOpen = entry.id === downloadMenuId;
            const status = downloadStatusView(entry, appLocale);

            return (
              <div
                className="mod-row download-row"
                role="row"
                tabIndex={0}
                draggable={false}
                data-reorder-kind="download-install"
                data-reorder-disabled={!entry.canInstall}
                data-selected={isSelected}
                data-ready={entry.canInstall}
                data-awaiting-decision={entry.transferState === 'awaiting-decision'}
                data-dragging={draggedDownloadInstallId === entry.id}
                data-menu-open={isMenuOpen}
                aria-selected={isSelected}
                onClick={(event) => {
                  if (consumeSuppressedRowClick()) {
                    return;
                  }
                  event.currentTarget.focus();
                  handleDownloadRowSelection(event, entry);
                }}
                onDoubleClick={() => {
                  dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  if (entry.canInstall) {
                    void installDownload(entry);
                  }
                }}
                onPointerDown={(event) => {
                  if (
                    !beginRowReorderDrag(
                      event,
                      'download-install',
                      entry.id,
                      entry.canInstall
                    )
                  ) {
                    return;
                  }

                  dispatchDownloadsWorkspace({ type: 'selected', id: entry.id });
                  setDownloadMenuId(null);
                }}
                onPointerMove={updateRowReorderDrag}
                onPointerUp={endRowReorderDrag}
                onPointerCancel={cancelRowReorderDrag}
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
                  <strong title={downloadRawTitle(entry, appLocale)}>{downloadTitle(entry, appLocale)}</strong>
                </div>
                <div className="download-progress" role="cell" data-status={status.tone}>
                  {status.showProgress ? (
                    <div className="download-progress__bar" aria-hidden="true">
                      <span style={{ width: `${entry.hasKnownProgress ? status.progressValue : 0}%` }} />
                    </div>
                  ) : null}
                  <small title={status.text}>{status.text}</small>
                </div>
                <span role="cell">{entry.sizeText || '-'}</span>
                <span role="cell">{entry.source || t('app.ui.local')}</span>
                {isMenuOpen ? renderDownloadRowMenu(entry) : null}
              </div>
            );
          }}
        />
      </div>
    );
  };

  const renderEffectiveFileTreeRow = ({ entry, level }: EffectiveFileTreeRow) => {
    const isExpanded = Boolean(expandedEffectiveFileTree[entry.relativePath]);
    const sourceLabel = effectiveFileTreeSourceLabel(entry, appLocale);
    const canOpen = Boolean(entry.sourcePath);
    const rowName = entry.name || t('app.ui.gameRoot');

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
          title={isExpanded ? t('app.ui.collapse') : t('app.ui.expand')}
          aria-label={`${isExpanded ? t('app.ui.collapse') : t('app.ui.expand')} ${rowName}`}
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
        <span className="right-pane-data-row__label" title={effectiveVirtualPathLabel(entry, appLocale)}>
          {rowName}
        </span>
        <code title={entry.virtualPath}>{effectiveVirtualPathLabel(entry, appLocale)}</code>
        <span className="right-pane-data-row__source" title={sourceLabel}>
          {sourceLabel}
        </span>
        {canOpen ? (
          <span className="right-pane-data-row__actions">
            <button
              className="icon-button"
              type="button"
              title={t('app.action.openNamed', { name: effectiveVirtualPathLabel(entry, appLocale) })}
              aria-label={t('app.action.openNamed', { name: effectiveVirtualPathLabel(entry, appLocale) })}
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
        {t('app.ui.loadingData')}
      </span>
      {effectiveFileTreeSkeletonRows.map((index) => (
        <div
          aria-hidden="true"
          className="right-pane-data-row right-pane-data-row--skeleton"
          key={`effective-tree-skeleton-${index}`}
          role="treeitem"
          style={{ paddingLeft: `${6 + (index % 4) * 16}px` }}
        >
          <Skeleton className="workspace-skeleton--toggle" />
          <Skeleton className="workspace-skeleton--toggle" />
          <Skeleton
            className="workspace-skeleton--title"
            style={{ width: skeletonWidth(index) }}
          />
          <Skeleton
            className="workspace-skeleton--cell"
            style={{ width: skeletonWidth(index, 2) }}
          />
          <Skeleton
            className="workspace-skeleton--badge"
            style={{ width: skeletonWidth(index, 3) }}
          />
          <Skeleton className="workspace-skeleton--action" />
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
        aria-label={t('app.tab.data')}
      >
        <div
          className="right-pane-data-tree file-tree"
          role="tree"
          aria-label={t('app.ui.effectiveGameRoot')}
          aria-busy={showInitialSkeleton || effectiveFileTreeState === 'refreshing'}
          data-state={effectiveFileTreeState}
          onScroll={(event) => setEffectiveFileTreeScrollTop(event.currentTarget.scrollTop)}
        >
          {showInitialSkeleton ? (
            renderEffectiveFileTreeSkeletonRows()
          ) : showUnavailable ? (
            <div className="file-tree-empty file-tree-empty--actionable">
              <span>{effectiveFileTreeError || t('app.ui.dataUnavailable')}</span>
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
                {t('app.ui.retry')}
              </button>
            </div>
          ) : showEmpty ? (
            <span className="file-tree-empty">{t('app.ui.noTreeFiles')}</span>
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
      selectedExecutableItem?.executablePath || selectedProject?.gamePath || t('app.ui.notConfigured');
    const buildRows = [
      [t('app.ui.project'), selectedProject?.projectDirectory ?? t('app.ui.notConfigured')],
      [t('app.ui.gameDirectory'), selectedProject?.paths?.gameDirectory ?? t('app.ui.notConfigured')],
      [t('app.ui.mods'), selectedProject?.paths?.modsDirectory ?? t('app.ui.notConfigured')],
      [t('app.ui.profiles'), selectedProject?.paths?.profilesDirectory ?? t('app.ui.notConfigured')],
      [t('app.ui.downloads'), selectedProject?.paths?.downloadsDirectory ?? t('app.ui.notConfigured')],
      [t('app.ui.overwrite'), selectedProject?.paths?.overwriteDirectory ?? t('app.ui.notConfigured')]
    ] as const;

    return (
      <div
        key="build"
        className="right-pane-content right-pane-content--build"
        role="tabpanel"
        aria-label={t('app.ui.build')}
      >
        <section className="right-pane-section">
          <header>
            <FolderTree size={16} aria-hidden="true" />
            <div>
              <strong>{t('app.ui.buildPaths')}</strong>
              <span>{t('app.ui.coreOwnedLocations')}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title={buildHeaderCapabilities.settingsReason || t('app.ui.openBuildSettings')}
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
              <strong>{t('app.ui.buildPathsAttention')}</strong>
              <span>{buildPathsError}</span>
            </div>
          ) : null}
        </section>

        <section className="right-pane-section">
          <header>
            <Play size={16} aria-hidden="true" />
            <div>
              <strong>{t('app.ui.executableConfig')}</strong>
              <span>{selectedProjectProfileName}</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title={executableCapabilities.launchReason || t('app.ui.launchExecutable')}
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
              <dt>{t('app.ui.name')}</dt>
              <dd>{selectedExecutableItem?.displayName || t('app.ui.notConfigured')}</dd>
            </div>
            <div>
              <dt>{t('app.ui.path')}</dt>
              <dd title={selectedExecutablePath}>{selectedExecutablePath}</dd>
            </div>
            <div>
              <dt>{t('app.ui.arguments')}</dt>
              <dd>{selectedExecutableItem?.arguments || t('app.ui.noConflicts')}</dd>
            </div>
            <div>
              <dt>{t('app.ui.launch')}</dt>
              <dd>{executableCapabilities.launchAvailable
                ? t('app.ui.available')
                : executableCapabilities.launchReason}</dd>
            </div>
          </dl>
        </section>

        <section className="right-pane-section right-pane-section--fluxpack">
          <header>
            <File size={16} aria-hidden="true" />
            <div>
              <strong>{t('app.ui.fluxPackBrand')}</strong>
              <span>{fluxPackSummary ? fluxPackSummary.outputPath : t('app.ui.noPackageYet')}</span>
            </div>
          </header>
          <div className="right-pane-actionbar" aria-label={t('app.ui.fluxPackActions')}>
            <button
              className="tool-button"
              type="button"
              title={buildHeaderCapabilities.packageReason || t('app.ui.exportFluxPack')}
              disabled={!buildHeaderCapabilities.packageAvailable || Boolean(operationOverlay?.isRunning)}
              onClick={() => void packageFluxPack()}
            >
              <UploadCloud size={16} aria-hidden="true" />
              {t('app.ui.package')}
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={!bridgeStatus?.ready || Boolean(operationOverlay?.isRunning)}
              onClick={() => void inspectFluxPack()}
            >
              <File size={16} aria-hidden="true" />
              {t('app.ui.inspect')}
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={!bridgeStatus?.ready || Boolean(operationOverlay?.isRunning)}
              onClick={() => void installFluxPack()}
            >
              <Download size={16} aria-hidden="true" />
              {t('app.ui.install')}
            </button>
          </div>
          {fluxPackSummary ? (
            renderFluxPackSummary()
          ) : (
            <div className="empty-state empty-state--compact">
              <File size={18} aria-hidden="true" />
              <strong>{t('app.ui.noFluxPackSummary')}</strong>
              <span>{t('app.ui.fluxPackSummaryDescription')}</span>
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
      aria-label={t('app.tab.plugins')}
    >
      <div className="plugins-pane-toolbar">
        <label className="pane-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={pluginsWorkspace.searchText}
            onChange={(event) => {
              preparePluginSearchScroll(pluginsWorkspace.searchText, event.target.value);
              dispatchPluginsWorkspace({
                type: 'search-changed',
                searchText: event.target.value
              });
            }}
            placeholder={t('app.ui.searchPlugins')}
            aria-label={t('app.ui.searchPlugins')}
            disabled={!pluginCapabilities.bridgeAvailable || !pluginCapabilities.projectSupported}
          />
        </label>
        {showPluginMissingMastersStatus ? (
          <button
            className="plugins-info-trigger"
            type="button"
            aria-label={t('app.ui.pluginSlotInfo')}
            aria-describedby="skyrim-plugin-info-popover"
          >
            <AssetIcon source={infoCircleIcon} />
            <span
              className="plugins-info-popover"
              id="skyrim-plugin-info-popover"
              role="tooltip"
            >
              <span className="plugins-info-popover__row">
                <span>{t('app.ui.enabledPluginCount')}</span>
                <strong>{enabledPluginSlotCounts.enabled}</strong>
              </span>
              <span className="plugins-info-popover__row">
                <span>{t('app.ui.lightPluginCount')}</span>
                <strong>{enabledPluginSlotCounts.light} / 4096</strong>
              </span>
              <span className="plugins-info-popover__row">
                <span>{t('app.ui.fullPluginCount')}</span>
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
          <strong>{t('app.ui.pluginsUnavailable')}</strong>
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
      aria-label={t('app.tab.downloads')}
    >
      <label className="pane-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={downloadsWorkspace.searchText}
          onChange={(event) => {
            prepareDownloadSearchScroll(downloadsWorkspace.searchText, event.target.value);
            dispatchDownloadsWorkspace({
              type: 'search-changed',
              searchText: event.target.value
            });
          }}
          placeholder={t('app.ui.searchDownloads')}
          aria-label={t('app.ui.searchDownloads')}
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
          <strong>{t('app.ui.downloadsUnavailable')}</strong>
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
      language={bridgeStatus?.language}
      onArchiveTreeScrollTopChange={setArchiveTreeScrollTop}
      onClose={() => setInstallDialog(null)}
      onContinueFromFomod={() => void continueFromFomod()}
      onMoveFomodStep={(direction) => void moveInstallFomodStep(direction)}
      onOpenDetails={() => void openInstallDetails()}
      onPatch={setInstallDialogPatch}
      onPlacementEditsChange={updateInstallPlacementEdits}
      onRecalculateFomod={() => void recalculateFomodSmartSelection(false)}
      onResetFomod={() => void recalculateFomodSmartSelection(true)}
      onResolveExistingMod={(mode) => void submitInstallOptions(mode)}
      onSubmitInstallOptions={() => void submitInstallOptions()}
    />
  );

  const renderDownloadDuplicateDecision = () => (
    <DownloadDuplicateDecisionDialog
      entry={activeDownloadDuplicateDecision}
      errorMessage={downloadDuplicateDecisionError}
      isResolving={downloadDuplicateDecisionResolving}
      onResolve={(choice) => void resolveDownloadDuplicateDecision(choice)}
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

  const renderPluginSeparatorDialog = () => (
    <PluginSeparatorDialog
      language={bridgeStatus?.language}
      state={pluginSeparatorDialog}
      onCancel={() => setPluginSeparatorDialog(null)}
      onNameChange={updatePluginSeparatorDialogName}
      onSubmit={() => void submitPluginSeparatorDialog()}
    />
  );

  const renderBuildRenameDialog = () => (
    <BuildRenameDialog
      language={bridgeStatus?.language}
      state={buildRenameDialog}
      onCancel={closeBuildRenameDialog}
      onNameChange={updateBuildRenameDialogName}
      onSubmit={() => void submitBuildRenameDialog()}
    />
  );

  const renderItemRenameDialog = () => (
    <ItemRenameDialog
      language={bridgeStatus?.language}
      state={itemRenameDialog}
      onCancel={() => setItemRenameDialog(null)}
      onNameChange={updateItemRenameDialogName}
      onSubmit={() => void submitItemRenameDialog()}
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
        description={deletionConfirmation.description}
        itemCount={deletionConfirmation.itemCount}
        itemName={deletionConfirmation.itemName}
        kind={deletionConfirmation.kind}
        language={bridgeStatus?.language}
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
          <h2>{t('app.ui.noBuild')}</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            {t('app.ui.goHome')}
          </button>
        </section>
      );
    }

    if (!downloadCapabilities.bridgeAvailable) {
      return (
        <section className="center-empty" aria-label={t('app.ui.downloadsCapability')}>
          <Download size={22} aria-hidden="true" />
          <h2>{t('app.ui.downloadsUnavailable')}</h2>
          <span>{downloadCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout downloads-layout" aria-label={t('app.ui.buildDownloadsWorkspace')}>
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">{t('app.ui.downloads')}</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label={t('app.ui.downloadCommands')}>
              <button
                className="icon-button"
                type="button"
                title={t('app.ui.refreshDownloads')}
                disabled={downloadsActionsBusy}
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
                disabled={downloadsActionsBusy}
                onClick={() => void importDownloadArchive()}
              >
                <File size={16} aria-hidden="true" />
                {t('app.ui.import')}
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={downloadsActionsBusy}
                onClick={() => void installArchiveFromDialog()}
              >
                <Download size={16} aria-hidden="true" />
                {t('app.ui.installArchive')}
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={isImportingNxmManually}
                onClick={() => void importInboundDownloads()}
              >
                <ExternalLink size={16} aria-hidden="true" />
                {isImportingNxmManually ? t('app.ui.importingNxm') : t('app.ui.nxmQueue')}
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={downloadsActionsBusy}
                onClick={() => void registerNxmProtocol()}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                {t('app.ui.registerNxm')}
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
          aria-label={t('app.ui.profiles')}
          aria-busy="true"
        >
          <div className="mod-row profile-row mod-row--head" role="row">
            <span role="columnheader">{t('app.ui.profile')}</span>
            <span role="columnheader">{t('app.ui.role')}</span>
            <span role="columnheader">{t('app.ui.state')}</span>
            <span role="columnheader">{t('app.ui.actions')}</span>
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
                  <Skeleton
                    className="workspace-skeleton--title"
                    style={{ width: skeletonWidth(index) }}
                  />
                  <Skeleton
                    className="workspace-skeleton--meta"
                    style={{ width: skeletonWidth(index, 1) }}
                  />
                </div>
                <Skeleton className="workspace-skeleton--cell" role="cell" />
                <Skeleton className="workspace-skeleton--status" role="cell" />
                <Skeleton className="workspace-skeleton--action" role="cell" />
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
          title={t('app.ui.profilesUnavailable')}
          description={profilesWorkspace.errorMessage ?? t('app.ui.profilesLoadFailed')}
          tone="error"
        />
      );
    }

    if (filteredProfileItems.length === 0) {
      return (
        <EmptyState
          icon={<FolderOpen size={18} aria-hidden="true" />}
          title={profilesWorkspace.items.length === 0
            ? t('app.ui.noProfiles')
            : t('app.ui.noMatchingProfiles')}
          description={
            profilesWorkspace.items.length === 0
              ? t('app.ui.noProfilesDescription')
              : t('app.ui.noMatchingProfilesDescription')
          }
        />
      );
    }

    return (
      <div className="mod-table profile-table" role="table" aria-label={t('app.ui.profiles')}>
        <div className="mod-row profile-row mod-row--head" role="row">
          <span role="columnheader">{t('app.ui.profile')}</span>
          <span role="columnheader">{t('app.ui.role')}</span>
          <span role="columnheader">{t('app.ui.state')}</span>
          <span role="columnheader">{t('app.ui.actions')}</span>
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
                  <span>{isSelected ? t('app.ui.currentProfile') : t('app.ui.availableProfile')}</span>
                </div>
                <span role="cell">{isDefault ? t('app.ui.default') : t('app.ui.custom')}</span>
                <span role="cell" data-status={isSelected ? 'ready' : 'checking'}>
                  {isSelected ? t('app.ui.selected') : t('app.ui.ready')}
                </span>
                <div className="row-actions mod-actions" role="cell">
                  <button
                    className="icon-button"
                    type="button"
                    title={t('app.ui.selectProfile')}
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
                    title={t('app.ui.cloneProfile')}
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
                    title={t('app.ui.renameProfile')}
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
                        ? t('app.ui.confirmProfileDeletion')
                        : t('app.ui.deleteProfile')
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
    <aside className="inspector profiles-inspector" aria-label={t('app.ui.selectedProfileDetails')}>
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">{t('app.ui.selectedProfile')}</p>
          <h2>{selectedProjectProfileName}</h2>
        </div>
      </div>
      <div className="profile-editor">
        <label className="field">
          <span>{t('app.ui.profileName')}</span>
          <input
            value={profileDraftName}
            disabled={Boolean(profilesBusyLabel)}
            onChange={(event) => {
              setProfileDraftName(event.target.value);
              setProfileDeleteArmedName(null);
            }}
          />
        </label>
        <div className="profile-editor__actions" aria-label={t('app.ui.profileEditCommands')}>
          <button
            className="tool-button"
            type="button"
            disabled={Boolean(profilesBusyLabel)}
            onClick={() => void createProfile()}
          >
            <Plus size={16} aria-hidden="true" />
            {t('app.ui.create')}
          </button>
          <button
            className="tool-button"
            type="button"
            disabled={Boolean(profilesBusyLabel)}
            onClick={() => void cloneProfile()}
          >
            <Copy size={16} aria-hidden="true" />
            {t('app.ui.clone')}
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
            {t('app.ui.rename')}
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
            {profileDeleteArmedName === selectedProjectProfileName
              ? t('app.ui.confirm')
              : t('app.ui.delete')}
          </button>
        </div>
      </div>
      <dl className="fact-list">
        <div>
          <dt>{t('app.ui.profiles')}</dt>
          <dd>{profilesWorkspace.items.length}</dd>
        </div>
        <div>
          <dt>{t('app.ui.visible')}</dt>
          <dd>{filteredProfileItems.length}</dd>
        </div>
        <div>
          <dt>{t('app.ui.default')}</dt>
          <dd>{selectedProjectDefaultProfileName}</dd>
        </div>
        <div>
          <dt>{t('app.ui.protection')}</dt>
          <dd>
            {isDefaultProfileName(selectedProjectProfileName, selectedProjectDefaultProfileName)
              ? t('app.ui.profileLocked')
              : t('app.ui.editable')}
          </dd>
        </div>
        <div>
          <dt>{t('app.ui.modsPlugins')}</dt>
          <dd>{t('app.ui.profileScoped')}</dd>
        </div>
      </dl>
      <div className="plugin-capability-panel">
        <strong>{t('app.ui.profilesDirectory')}</strong>
        <span>{selectedProject?.paths?.profilesDirectory ?? t('app.ui.notReported')}</span>
      </div>
    </aside>
  );

  const renderProfilesWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>{t('app.ui.noBuild')}</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            {t('app.ui.goHome')}
          </button>
        </section>
      );
    }

    if (!profilesCapabilities.bridgeAvailable) {
      return (
        <section className="center-empty" aria-label={t('app.ui.profilesCapability')}>
          <FolderOpen size={22} aria-hidden="true" />
          <h2>{t('app.ui.profilesUnavailable')}</h2>
          <span>{profilesCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout profiles-layout" aria-label={t('app.ui.buildProfilesWorkspace')}>
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">{t('app.ui.profiles')}</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label={t('app.ui.profileCommands')}>
              <button
                className="icon-button"
                type="button"
                title={t('app.ui.refreshProfiles')}
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
                {t('app.ui.profile')}
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={Boolean(profilesBusyLabel)}
                onClick={() => void openProfilesDirectory()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                {t('app.ui.folder')}
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
          aria-label={t('app.ui.executables')}
          aria-busy="true"
        >
          <div className="mod-row executable-row mod-row--head" role="row">
            <span role="columnheader">{t('app.ui.executable')}</span>
            <span role="columnheader">{t('app.ui.path')}</span>
            <span role="columnheader">{t('app.ui.arguments')}</span>
            <span role="columnheader">{t('app.ui.workingDirectory')}</span>
            <span role="columnheader">{t('app.ui.actions')}</span>
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
                  <Skeleton
                    className="workspace-skeleton--title"
                    style={{ width: skeletonWidth(index) }}
                  />
                  <Skeleton
                    className="workspace-skeleton--meta"
                    style={{ width: skeletonWidth(index, 2) }}
                  />
                </div>
                <Skeleton className="workspace-skeleton--cell" role="cell" />
                <Skeleton className="workspace-skeleton--cell" role="cell" />
                <Skeleton className="workspace-skeleton--cell" role="cell" />
                <Skeleton className="workspace-skeleton--action" role="cell" />
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
          title={t('app.ui.executablesUnavailable')}
          description={
            executablesWorkspace.errorMessage ?? t('app.ui.executablesLoadFailed')
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
            executablesWorkspace.items.length === 0
              ? t('app.ui.noExecutables')
              : t('app.ui.noMatchingExecutables')
          }
          description={
            executablesWorkspace.items.length === 0
              ? t('app.ui.noExecutablesDescription')
              : t('app.ui.noMatchingExecutablesDescription')
          }
        />
      );
    }

    return (
      <div className="mod-table executable-table" role="table" aria-label={t('app.ui.executables')}>
        <div className="mod-row executable-row mod-row--head" role="row">
          <span role="columnheader">{t('app.ui.executable')}</span>
          <span role="columnheader">{t('app.ui.path')}</span>
          <span role="columnheader">{t('app.ui.arguments')}</span>
          <span role="columnheader">{t('app.ui.workingDirectory')}</span>
          <span role="columnheader">{t('app.ui.actions')}</span>
        </div>
        <div className="mod-table__body">
          {filteredExecutableItems.map((entry) => {
            const isSelected = entry.id === executablesWorkspace.selectedId;
            const managedDisplay = managedExecutableDisplay(
              entry.managedToolKind,
              selectedProject?.name ?? t('app.ui.build'),
              appLocale
            );
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
                  <strong>{executableTitle(entry, appLocale)}</strong>
                  <span>{entry.id}</span>
                  {managedDisplay ? (
                    <>
                      <Badge tone="accent">{managedDisplay.badgeLabel}</Badge>
                      <span>{managedDisplay.outputModName}</span>
                    </>
                  ) : null}
                </div>
                <span role="cell">{shortPath(entry.executablePath)}</span>
                <span role="cell">{entry.arguments || '-'}</span>
                <span role="cell">{entry.workingDirectory
                  ? shortPath(entry.workingDirectory)
                  : t('app.ui.executableFolder')}</span>
                <div className="row-actions mod-actions" role="cell">
                  <button
                    className="icon-button"
                    type="button"
                    title={t('app.ui.launchExecutable')}
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
                        ? t('app.ui.confirmExecutableDeletion')
                        : t('app.ui.deleteExecutable')
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

  const renderExecutablesInspector = () => {
    const managedDisplay = managedExecutableDisplay(
      selectedExecutableItem?.managedToolKind,
      selectedProject?.name ?? t('app.ui.build'),
      appLocale
    );
    return (
      <aside className="inspector executables-inspector" aria-label={t('app.ui.selectedExecutableDetails')}>
      <div className="surface-header surface-header--compact">
        <div>
          <p className="eyebrow">{t('app.ui.executableEditor')}</p>
          <h2>{executableTitle(selectedExecutableItem, appLocale)}</h2>
        </div>
      </div>
      {!executableDraft ? (
        <EmptyState
          className="empty-state--compact"
          compact
          icon={<Play size={18} aria-hidden="true" />}
          title={t('app.ui.selectExecutable')}
          description={t('app.ui.selectExecutableDescription')}
        />
      ) : (
        <div className="executable-editor">
          <label className="field">
            <span>{t('app.ui.displayName')}</span>
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
            <span>{t('app.ui.executablePath')}</span>
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
                {t('app.ui.browse')}
              </button>
            </div>
          </label>
          <label className="field">
            <span>{t('app.ui.arguments')}</span>
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
            <span>{t('app.ui.workingDirectory')}</span>
            <div className="path-picker">
              <input
                value={executableDraft.workingDirectory}
                onChange={(event) =>
                  setExecutableDraft((current) =>
                    current ? { ...current, workingDirectory: event.target.value } : current
                  )
                }
                placeholder={t('app.ui.executableFolder')}
              />
              <button
                className="tool-button"
                type="button"
                onClick={() => void browseExecutableWorkingDirectory()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                {t('app.ui.browse')}
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
              {t('app.ui.icon')}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(executablesBusyLabel)}
              onClick={() => void saveExecutableDraft()}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              {t('app.ui.save')}
            </button>
          </div>
          <dl className="fact-list">
            <div>
              <dt>{t('app.ui.icon')}</dt>
              <dd>{executableDraft.iconPath
                ? shortPath(executableDraft.iconPath)
                : t('app.ui.notResolved')}</dd>
            </div>
            <div>
              <dt>{t('app.ui.profile')}</dt>
              <dd>{selectedProjectProfileName}</dd>
            </div>
            <div>
              <dt>{t('app.ui.launch')}</dt>
              <dd>
                {managedDisplay
                  ? managedDisplay.badgeLabel
                  : executableCapabilities.launchAvailable
                    ? t('app.ui.available')
                    : t('app.ui.limited')}
              </dd>
            </div>
            {managedDisplay ? (
              <div>
                <dt>{t('app.ui.output')}</dt>
                <dd>
                  {executableLaunchResult?.outputMod?.displayName ??
                    managedDisplay.outputModName}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      )}
      {!executableCapabilities.launchAvailable ? (
        <div className="plugin-capability-panel">
          <strong>{t('app.ui.launchCapability')}</strong>
          <span>{executableCapabilities.launchReason}</span>
        </div>
      ) : null}
      {executableLaunchResult ? (
        <div className="plugin-capability-panel">
          <strong>{t('app.ui.lastLaunch')}</strong>
          <span>
            {executableLaunchResult.processId
              ? t('app.ui.processId', { id: executableLaunchResult.processId })
              : executableLaunchResult.launchTrackingKind}
          </span>
          {executableLaunchResult.outputMod ? (
            <span>{t('app.ui.outputNamed', { name: executableLaunchResult.outputMod.displayName })}</span>
          ) : null}
        </div>
      ) : null}
      </aside>
    );
  };

  const renderExecutablesWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>{t('app.ui.noBuild')}</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            {t('app.ui.goHome')}
          </button>
        </section>
      );
    }

    if (!executableCapabilities.bridgeAvailable) {
      return (
        <section className="center-empty" aria-label={t('app.ui.executablesCapability')}>
          <Play size={22} aria-hidden="true" />
          <h2>{t('app.ui.executablesUnavailable')}</h2>
          <span>{executableCapabilities.reason}</span>
        </section>
      );
    }

    return (
      <section className="mods-layout executables-layout" aria-label={t('app.ui.buildExecutablesWorkspace')}>
        <section className="work-surface mods-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">{t('app.ui.executables')}</p>
              <h2>{selectedProject.name}</h2>
            </div>
            <div className="mods-toolbar" aria-label={t('app.ui.executableCommands')}>
              <button
                className="icon-button"
                type="button"
                title={t('app.ui.refreshExecutables')}
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
                {t('app.ui.executable')}
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
                {t('app.ui.launch')}
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
      projectName={selectedProject?.name ?? t('app.ui.paths')}
      onBrowseDirectory={(title, field) => void browseBuildPathDirectory(title, field)}
      onBrowseGameExecutable={() => void browseBuildGameExecutable()}
      onOpenDownloadsDirectory={() => void openBuildDownloadsDirectory()}
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
      projectName={selectedProject?.name ?? (buildSettingsInitialName || t('app.ui.build'))}
      onBrowseDirectory={(title, field) => void browseBuildPathDirectory(title, field)}
      onBrowseGameExecutable={() => void browseBuildGameExecutable()}
      onOpenDownloadsDirectory={() => void openBuildDownloadsDirectory()}
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
      <div className="fluxpack-panel" aria-label={t('app.ui.fluxPackSummary')}>
        <div className="fluxpack-panel__header">
          <File size={17} aria-hidden="true" />
          <div>
            <strong>{fluxPackSummary.buildName || t('app.ui.fluxPackBrand')}</strong>
            <span>{fluxPackSummary.outputPath}</span>
          </div>
        </div>
        <dl className="settings-facts">
          {fluxPackSummaryFacts(fluxPackSummary, appLocale).map(([label, value]) => (
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
                  ? t('app.ui.fluxpackDeltaWarnings')
                  : t('app.ui.fluxpackDeltaComplete')
                : fluxPackInstallResult.hasWarnings
                  ? t('app.ui.fluxpackInstallWarnings')
                  : t('app.ui.fluxpackInstallComplete')}
            </strong>
            <span>
              {fluxPackInstallResult.updatedExistingProject
                ? t('app.ui.fluxpackDeltaFacts', {
                    sources: fluxPackInstallResult.reusedSourceCount,
                    downloads: fluxPackInstallResult.reusedDownloadCount,
                    files: fluxPackInstallResult.reusedFileCount,
                    materialized: fluxPackInstallResult.materializedFileCount
                  })
                : t('app.ui.fluxpackInstallFacts', {
                    sources: fluxPackInstallResult.installedSourceCount,
                    configs: fluxPackInstallResult.appliedConfigCount
                  })}
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

    const outputName = t('app.ui.grassOutput', { name: selectedProject.name });
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
            <span>{t('app.ui.ngioBrand')}</span>
            <h2 id="grass-cache-confirmation-title">{t('app.operation.grassTitle')}</h2>
            <p>{t('app.dialog.grassDescription')}</p>
            <strong>{outputName}</strong>
          </div>
          <div className="grass-cache-dialog__actions">
            <Button
              onClick={() => setGrassCacheConfirmationOpen(false)}
              size="sm"
              variant="secondary"
            >
              {t('app.ui.cancel')}
            </Button>
            <Button onClick={() => void generateNgioGrassCache()} size="sm">
              {t('app.dialog.start')}
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
      cancelLabel={t('app.ui.cancel')}
      cancelTitle={t('app.ui.openingCancelTitle')}
      detail={t('app.ui.openingProgress')}
      messages={openingBuildMessages}
      onCancel={() => cancelOpeningBuild()}
      open={Boolean(openingBuildSplash)}
      progress={openingBuildSplash?.progress ?? 0}
      subtitle={openingBuildSplash?.buildName}
    />
  );

  const renderOverwriteClearSplash = () => (
    <LoadingSplash
      aria-label={t('app.ui.overrideClear')}
      buildName={overwriteClearSplash?.buildName}
      detail={t('app.ui.overrideProgress')}
      messages={overwriteClearMessages}
      open={Boolean(overwriteClearSplash)}
      progress={overwriteClearSplash?.progress ?? 0}
      subtitle={overwriteClearSplash?.buildName}
      title={t('app.ui.overrideClear')}
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

  const setDeveloperMode = (enabled: boolean) => {
    setDeveloperModeEnabled(enabled);
    saveDeveloperModeSetting(window.localStorage, enabled);
  };

  const resetMicrophonePermission = async () => {
    if (microphonePermissionBusy) return;
    const operationId = createRendererOperationId('ai_microphone_permission_reset');
    setMicrophonePermissionBusy(true);
    setSettingsBusyLabel(null);
    resetAiMicrophonePermission(window.localStorage);
    setMicrophoneAllowed(false);
    window.dispatchEvent(new Event(aiMicrophonePermissionChangedEvent));
    try {
      await window.fluxora.ai.resetMicrophonePermission({ operationId });
      setSettingsBusyLabel(null);
    } catch {
      setSettingsBusyLabel(t('app.message.microphoneResetFailed'));
    } finally {
      setMicrophonePermissionBusy(false);
    }
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
      microphoneAllowed={microphoneAllowed}
      microphonePermissionBusy={microphonePermissionBusy}
      lastBuildDate={rendererBuildDate}
      connectionBusyAction={connectionBusyAction}
      connectionBusyProviderId={connectionBusyProviderId}
      connectionProviders={connectionSnapshot.providers}
      onDeveloperModeChange={setDeveloperMode}
      onOpenManagerDefaultApps={() =>
        window.fluxora.managerHandoff.openDefaultAppSettings()}
      onOpenRepository={openOriginalRepository}
      onResetMicrophonePermission={() => void resetMicrophonePermission()}
      section={settingsSection}
      settingsBusyLabel={settingsBusyLabel}
      settingsCapabilities={settingsCapabilities}
      onOpenTransfer={() => void openMo2TransferFromSettings()}
      onSectionChange={setSettingsSection}
      onSetLanguage={(language) => void setLanguage(language)}
      onToggleConnection={(providerId) => void toggleConnection(providerId)}
    />
  );
  const renderBuildWorkspace = () => {
    if (!selectedProject) {
      return (
        <section className="center-empty">
          <FolderOpen size={22} aria-hidden="true" />
          <h2>{t('app.ui.noBuild')}</h2>
          <button className="primary-button" type="button" onClick={() => changeRoute('home')}>
            {t('app.ui.goHome')}
          </button>
        </section>
      );
    }

    return (
      <section className="build-page" aria-label={t('app.ui.selectedBuild')}>
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

        <section className="build-workbench" aria-label={t('app.ui.modOrganizerWorkspace')}>
          <section
            className="build-pane build-pane--mods"
            aria-label={t('app.ui.mods')}
            data-download-install-active={Boolean(draggedDownloadInstallId)}
          >
            <header className="build-pane__header build-pane__header--mods">
              <div>
                <h3>{t('app.ui.mods')}</h3>
                <span>
                  {t('app.ui.modCountSummary', {
                    enabled: enabledModCount,
                    total: totalModCount,
                    visible: filteredModItems.length
                  })}
                </span>
              </div>
            </header>
            <div className="mods-pane-toolbar">
              <label className="pane-search">
                <Search size={15} aria-hidden="true" />
                <input
                  value={modsWorkspace.searchText}
                  onChange={(event) => {
                    prepareModSearchScroll(modsWorkspace.searchText, event.target.value);
                    dispatchModsWorkspace({
                      type: 'search-changed',
                      searchText: event.target.value
                    });
                  }}
                  placeholder={t('app.ui.searchMods')}
                  aria-label={t('app.ui.searchMods')}
                />
              </label>
              <button
                className="pane-menu-trigger"
                type="button"
                data-row-context-menu-trigger="true"
                aria-haspopup="menu"
                aria-expanded={Boolean(modsToolbarMenuPosition)}
                aria-label={t('app.ui.buildActions')}
                title={t('app.ui.buildActions')}
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
            aria-label={t('app.ui.rightPane')}
          >
            <header className="build-pane__header build-pane__header--tabs">
              <div
                className="right-pane-tabs"
                role="tablist"
                aria-label={t('app.ui.rightPaneTabs')}
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
      <span>{selectedProject?.name ?? t('app.ui.openBuildFirst')}</span>
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

  const aiChatProviderDiagnostic = aiProviderDiagnostic(aiHostStatus, bridgeStatus?.language);

  const refreshAiQuotaStatus = () => {
    const operationId = createRendererOperationId('ai_quota_refresh');
    void window.fluxora.ai.getStatus({ operationId }).then(setAiHostStatus, () => undefined);
  };

  const finishAiRunAsStopped = (run: Pick<AiRun, 'id' | 'operationId'>) => {
    const event = createAiStreamEvent(run, 'run-cancelled', { status: 'stopped' });
    dispatchAiChat({
      type: 'cancel-run',
      message: createAiMessage('assistant', t('app.message.aiStopped'), new Date(), run.id, {
        agentStatus: 'stopped'
      }),
      event
    });
  };

  const finishAiRunAsBlocked = (run: Pick<AiRun, 'id' | 'operationId'>, error: unknown) => {
    const messageText = t('app.message.aiBlocked', { error: errorMessage(error) });
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

  const sendAiChatMessageAsync = async (
    promptOverride?: string,
    operationIdOverride?: string
  ): Promise<boolean> => {
    const prompt = (promptOverride ?? aiChat.draft).trim();
    if (!prompt || aiChat.isRunning || !aiHostStatus?.ready || aiChatProviderDiagnostic?.level === 'error') {
      return false;
    }

    const operationId = operationIdOverride ?? createRendererOperationId('ai_chat_run');
    const requestSession = aiChat.session;
    const run = createAiRunForPrompt(requestSession, operationId, prompt);
    const runControl: ActiveAiRunControl = {
      cancelled: false,
      chatId: run.sessionId,
      handle: null,
      operationId,
      runId: run.id
    };
    activeAiRunsRef.current.set(run.sessionId, runControl);
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

    try {
      const runSettings = {
        ...aiChatSettings,
        fileWorkspace: selectedProject
          ? {
              schema: 'fluxora.ai.file-workspace-envelope.v1' as const,
              chatId: requestSession.activeChatId,
              projectId: selectedProject.id,
              templateId: selectedProject.templateId,
              buildLabel: selectedProject.name,
              projectDirectory: selectedProject.projectDirectory,
              game: selectedProject.gameName,
              profile: selectedProjectProfileName,
              counts: {
                mods: installedMods.length,
                plugins: pluginsWorkspace.items.length,
                downloads: downloadsWorkspace.items.length
              },
              dirtyFileRefs: []
            }
          : undefined
      };
      const chatRequest = createAiHostChatRequest(run, requestSession, prompt, runSettings);

      const estimateAiContextUsage = async () => {
        try {
          const contextUsage = await window.fluxora.ai.estimateContext(chatRequest);
          if (activeAiRunsRef.current.get(run.sessionId) !== runControl || runControl.cancelled) {
            return;
          }
          dispatchAiChat({
            type: 'set-context-estimate',
            runId: run.id,
            estimateState: 'ready',
            contextUsage
          });
        } catch (error) {
          if (activeAiRunsRef.current.get(run.sessionId) !== runControl || runControl.cancelled) {
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

      if (activeAiRunsRef.current.get(run.sessionId) !== runControl || runControl.cancelled) {
        return false;
      }

      runControl.handle = startHostAiRun(
        run,
        requestSession,
        prompt,
        window.fluxora.ai,
        {
          ...runSettings,
          cancelledText: t('app.message.aiStopped'),
          errorText: t('ai.diagnostic.unavailable.message'),
          preparedRequest: chatRequest
        },
        {
          onEvent: (event) => dispatchAiChat({ type: 'apply-stream-event', event }),
          onRunEvent: (event) => dispatchAiChat({ type: 'apply-run-event', event }),
          onFinish: (message, event, status) => {
            refreshAiQuotaStatus();
            if (activeAiRunsRef.current.get(run.sessionId) === runControl) {
              activeAiRunsRef.current.delete(run.sessionId);
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
              status
            });
            if (message.fileChangeSet) {
              const operationId = createRendererOperationId('ai_file_rollback_states_after_run');
              void window.fluxora.ai
                .getFileRollbackStates(message.fileChangeSet.chatId, operationId)
                .then(
                  (states) => dispatchAiChat({
                    type: 'restore-file-rollback-states',
                    chatId: message.fileChangeSet!.chatId,
                    states
                  }),
                  () => undefined
                );
            }
          },
          onLog: logAiRuntimeEntry
        }
      );
      if (runControl.cancelled) {
        runControl.handle.cancel();
        return false;
      }
      void estimateAiContextUsage();
      return true;
    } catch (error) {
      if (activeAiRunsRef.current.get(run.sessionId) !== runControl || runControl.cancelled) {
        return false;
      }

      activeAiRunsRef.current.delete(run.sessionId);
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
      return false;
    }
  };

  const sendAiChatMessage = () => {
    void sendAiChatMessageAsync();
  };

  const cancelAiChatRun = () => {
    const runControl = activeAiRunsRef.current.get(aiChat.activeChatId);
    if (!runControl || runControl.cancelled) {
      return;
    }

    runControl.cancelled = true;
    requestNativeAiRunCancel(runControl.operationId);
    if (runControl.handle) {
      runControl.handle.cancel();
      return;
    }

    activeAiRunsRef.current.delete(runControl.chatId);
    finishAiRunAsStopped({
      id: runControl.runId,
      operationId: runControl.operationId
    });
  };

  const openAiSource = (url: string) => {
    const sourceUrl = safeAiSourceUrl(url);
    if (!sourceUrl) {
      setMessage(t('app.message.aiSourceBlocked'));
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
      setMessage(t('app.message.aiContextSource', { id: sourceId }));
      return;
    }

    void window.fluxora.links.openExternal(sourceUrl);
  };

  const openAiFileChange = (
    change: FluxoraAiFileChange,
    _firstChangedLine: number,
    _changeSet: FluxoraAiFileChangeSet
  ) => {
    if (!selectedProject) {
      setMessage(t('app.message.openBuildForOverrideEditor'));
      return;
    }
    const location = resolveAiManagedFileLocation(selectedProject, change);
    if (!location) {
      setMessage(t('app.message.overrideLocationMissing'));
      return;
    }
    const fileName = change.relativePath.replaceAll('\\', '/').split('/').filter(Boolean).pop()
      ?? t('app.ui.editor');
    void window.fluxora.windowControls.openTextEditor(
      selectedProject.configPath,
      selectedProject.projectDirectory,
      location.modPath,
      location.relativePath,
      fileName,
    ).catch((error) => setMessage(errorMessage(error)));
  };

  const revealAiFileChange = (
    change: FluxoraAiFileChange,
    _changeSet: FluxoraAiFileChangeSet
  ) => {
    if (!selectedProject) {
      setMessage(t('app.message.openBuildForOverrideReveal'));
      return;
    }
    const location = resolveAiManagedFileLocation(selectedProject, change);
    if (!location) {
      setMessage(t('app.message.overrideLocationMissing'));
      return;
    }
    void window.fluxora.shell.showItemInFolder(location.absolutePath).then((result) => {
      if (!result.ok) {
        setMessage(result.message ?? t('app.message.overrideOpenFailed'));
      }
    }).catch((error) => setMessage(errorMessage(error)));
  };

  const rollbackAiFileRun = async (changeSet: FluxoraAiFileChangeSet) => {
    try {
      const result = await window.fluxora.ai.rollbackRun(
        changeSet.chatId,
        changeSet.runId,
        { operationId: createRendererOperationId('ai_file_run_rollback') }
      );
      dispatchAiChat({
        type: 'update-file-change-set',
        changeSet: {
          ...changeSet,
          files: changeSet.files.map((file) =>
            result.files.find((candidate) => candidate.fileRef === file.fileRef) ?? file
          ),
          rollbackState: result.state,
          rollbackReason: result.reason,
          rollbackMode: result.mode,
          preservedNewerChanges: result.preservedNewerChanges
        }
      });
      const stateOperationId = createRendererOperationId('ai_file_rollback_states_after_undo');
      const states = await window.fluxora.ai.getFileRollbackStates(changeSet.chatId, stateOperationId);
      dispatchAiChat({
        type: 'restore-file-rollback-states',
        chatId: changeSet.chatId,
        states
      });
      setMessage(result.state === 'conflict'
        ? t('app.message.undoReview')
        : result.preservedNewerChanges
          ? t('app.message.undoComplete')
          : t('app.message.aiRunUndone'));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const rollbackAiCapability = async (compensationToken: string) => {
    dispatchAiChat({
      type: 'update-capability-rollback',
      compensationToken,
      rollbackState: 'rolling-back'
    });
    try {
      await window.fluxora.ai.undoCapability(compensationToken, {
        operationId: createRendererOperationId('ai_capability_undo')
      });
      dispatchAiChat({
        type: 'update-capability-rollback',
        compensationToken,
        rollbackState: 'rolled-back'
      });
      setMessage(t('app.message.aiRollbackComplete'));
    } catch (error) {
      dispatchAiChat({
        type: 'update-capability-rollback',
        compensationToken,
        rollbackState: 'blocked'
      });
      setMessage(errorMessage(error));
    }
  };

  const titlebarAiVisible =
    !isSecondaryWindow &&
    Boolean(selectedProject) &&
    !isCreateOpen &&
    !isTransferPageOpen &&
    buildScopedAiRoutes.has(activeRoute);

  const renderTitlebar = (showSettingsButton: boolean) => (
    <AppTitlebar
      homeActive={activeRoute === 'home' && !isTransferPageOpen}
      aiActive={aiChat.isOpen}
      mode={isSecondaryWindow ? 'settings' : 'main'}
      settingsActive={isSettingsWindow}
      showShortcuts={showSettingsButton}
      showAi={showSettingsButton && titlebarAiVisible}
      title={windowTitle}
      update={appUpdate.toolbar}
      onClose={() => void closeWindow()}
      onHome={() => changeRoute('home')}
      onMinimize={() => void minimizeWindow()}
      onOpenSettings={() => void openSettingsWindow()}
      onRefresh={() => void refreshCurrentView()}
      onToggleAi={() => dispatchAiChat({ type: 'toggle-open' })}
      onToggleMaximize={() => void toggleMaximizeWindow()}
    />
  );

  if (!appLanguage.ready) {
    return <main className="desktop-shell" aria-busy="true" />;
  }

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
      <LocalizationProvider language={appLanguage.language}>
        <main className="desktop-shell desktop-shell--settings-window">
          {renderTitlebar(false)}
          <section className="settings-window">
            {renderSettingsWorkspace()}
          </section>
        </main>
      </LocalizationProvider>
    );
  }

  if (isBuildSettingsWindow) {
    return (
      <LocalizationProvider language={appLanguage.language}>
        <main className="desktop-shell desktop-shell--settings-window">
          {renderTitlebar(false)}
          <section className="settings-window">
            {renderBuildSettingsWorkspace()}
          </section>
        </main>
      </LocalizationProvider>
    );
  }

  if (isModDetailsWindow) {
    return (
      <LocalizationProvider language={appLanguage.language}>
        <main className="desktop-shell desktop-shell--settings-window desktop-shell--mod-details-window">
          {renderTitlebar(false)}
          {renderModDetailsWindow()}
        </main>
      </LocalizationProvider>
    );
  }

  if (isFilePreviewWindow) {
    return (
      <LocalizationProvider language={appLanguage.language}>
        <main className="desktop-shell desktop-shell--settings-window desktop-shell--file-preview-window">
          {renderTitlebar(false)}
          <Suspense
            fallback={
              <section className="file-preview-window" aria-busy="true" aria-label={t('app.ui.loadingFilePreview')} />
            }
          >
            <FilePreviewWorkspace
              projectDirectory={filePreviewProjectDirectory || selectedProject?.projectDirectory || ''}
              initialModPath={filePreviewModId}
              initialRelativePath={filePreviewInitialPath}
              initialFileName={filePreviewInitialName}
              initialProfileName={filePreviewProfileName}
              initialKind={filePreviewKind}
            />
          </Suspense>
        </main>
      </LocalizationProvider>
    );
  }

  return (
    <LocalizationProvider language={appLanguage.language}>
      <main className="desktop-shell">
      {renderTitlebar(true)}
      <ModUpdateCheckSplash state={manualModUpdateSplash} />
      {manualModUpdateNotice ? (
        <div className="transient-notice" role="status" aria-live="polite">
          {manualModUpdateNotice}
        </div>
      ) : null}
      <ModdingFlowActivationConfirmationHost
        activationCapabilityState={
          bridgeStatus?.capabilities?.features.moddingFlowActivation?.state
        }
        api={window.fluxora.moddingFlowActivations}
        connectAccount={async (operationId) => {
          const status = await window.fluxora.connections.connect('moddingflow', {
            operationId
          });
          connectionCoordinator.acceptSnapshot(
            mergeConnectionStatus(connectionSnapshot, status)
          );
          return status;
        }}
        isSecondaryWindow={isSecondaryWindow}
        projects={projects}
        selectedProjectId={selectedProject?.id ?? null}
        selectedProjectProfiles={buildProfileOptions}
      />

      <section
        className="workspace-with-ai"
        data-ai-collapsed={aiChat.isCollapsed ? 'true' : undefined}
        data-ai-open={aiChat.isOpen ? 'true' : undefined}
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
                {isCreateOpen ? (
                  <section className="create-flow">
                    <CreateBuildWizard
                      activeStepIndex={createWizard.activeStepIndex}
                      busy={Boolean(busyLabel)}
                      draft={createWizard.draft}
                      error={createWizard.error}
                      furthestStepIndex={createWizard.furthestStepIndex}
                      onBack={createWizard.back}
                      onBrowseExecutable={createWizard.browseExecutable}
                      onBrowseInstallRoot={createWizard.browseInstallRoot}
                      onCancel={createWizard.close}
                      onChangeInstallRoot={createWizard.changeInstallRoot}
                      onChangeName={createWizard.changeName}
                      onCreate={createProject}
                      onNext={createWizard.next}
                      onSelectStep={createWizard.selectStep}
                      onSelectTemplate={createWizard.selectTemplate}
                      previewBusy={createWizard.previewBusy}
                      previewDirectory={createWizard.previewDirectory}
                      selectedTemplate={createWizard.selectedTemplate}
                      templates={templates}
                    />
                  </section>
                ) : null}
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
                {renderDownloadDuplicateDecision()}
                {renderBuildRenameDialog()}
                {renderItemRenameDialog()}
                {renderModCreationDialog()}
                {renderPluginSeparatorDialog()}
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

        {aiChat.isOpen && selectedProject && titlebarAiVisible ? (
          <AiChatPanel
            hostReady={aiHostStatus?.ready ?? false}
            language={bridgeStatus?.language ?? 'en-us'}
            providerDiagnostic={aiChatProviderDiagnostic}
            quota={aiHostStatus?.quota}
            showCheckedSites={developerModeEnabled}
            showDeveloperDiagnostics={developerModeEnabled}
            state={aiChat}
            voiceContextTerms={aiVoiceBuildTerms}
            onCancel={cancelAiChatRun}
            onClose={() => dispatchAiChat({ type: 'close' })}
            onCloseChat={(chatId) => {
              const runControl = activeAiRunsRef.current.get(chatId);
              if (runControl && !runControl.cancelled) {
                runControl.cancelled = true;
                requestNativeAiRunCancel(runControl.operationId);
                if (runControl.handle) {
                  runControl.handle.cancel();
                } else {
                  activeAiRunsRef.current.delete(chatId);
                  finishAiRunAsStopped({ id: runControl.runId, operationId: runControl.operationId });
                }
              }
              void window.fluxora.ai.endFileChat(chatId, {
                operationId: createRendererOperationId('ai_file_chat_close')
              }).catch(() => undefined);
              dispatchAiChat({ type: 'close-chat', chatId });
            }}
            onConnectAccount={async () => {
              const operationId = createRendererOperationId('ai_moddingflow_connect');
              const status = await window.fluxora.connections.connect('moddingflow', {
                operationId
              });
              connectionCoordinator.acceptSnapshot(
                mergeConnectionStatus(connectionSnapshot, status)
              );
              if (status.providerId !== 'moddingflow' || status.state !== 'ready') {
                throw new Error(status.message || t('app.error.moddingFlowAuthorizationIncomplete'));
              }
              const nextStatus = await window.fluxora.ai.getStatus({ operationId });
              setAiHostStatus(nextStatus);
              if (nextStatus.quota.availability === 'connectionRequired') {
                throw new Error(t('app.error.managedAiAccessDenied'));
              }
            }}
            onCreateAccount={() => openModdingFlowRegistration(
              window.fluxora.links.openExternal,
              appLocale
            )}
            onCreateChat={() => dispatchAiChat({ type: 'create-chat' })}
            onDraftChange={(value) => dispatchAiChat({ type: 'set-draft', value })}
            onOpenSource={openAiSource}
            onOpenFileChange={openAiFileChange}
            onRevealFileChange={revealAiFileChange}
            onRollbackFileRun={rollbackAiFileRun}
            onUndoCapability={(compensationToken) => void rollbackAiCapability(compensationToken)}
            onSend={sendAiChatMessage}
            onSelectChat={(chatId) => dispatchAiChat({ type: 'select-chat', chatId })}
            onToggleCollapse={() => dispatchAiChat({ type: 'toggle-collapse' })}
            onVoiceSend={(prompt, operationId) => sendAiChatMessageAsync(prompt, operationId)}
          />
        ) : null}
      </section>
      </main>
    </LocalizationProvider>
  );
};
