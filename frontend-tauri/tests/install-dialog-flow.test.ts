import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const sliceBetween = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) {
    return '';
  }

  return source.slice(startIndex, endIndex);
};

describe('install dialog flow', () => {
  it('routes downloaded mod installs through the preflight dialog before bridge install', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const installDownload =
      app.match(/const installDownload = async[\s\S]*?\n  const deleteDownload = async/)?.[0] ??
      '';

    expect(installDownload).toContain('await startInstallFlow(source, placement)');
    expect(installDownload).toContain("kind: 'download'");
    expect(installDownload).not.toContain('window.fluxora.downloads.install');
    expect(installDownload).not.toContain("phase: 'installing'");
  });

  it('keeps the MO2-style install actions visible without loading-only phases', () => {
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'install',
      'InstallDialog.tsx'
    );

    expect(dialog).toContain('const dialogTitle =');
    expect(dialog).toContain('<strong>{dialogTitle}</strong>');
    expect(dialog).toContain('Закрыть окно установки');
    expect(dialog).toContain('Подробнее');
    expect(dialog).toContain('Установить');
    expect(dialog).not.toContain('Analyzing installer');
    expect(dialog).not.toContain('Installing mod</strong>');
    expect(dialog).not.toContain("| 'analyzing'");
    expect(dialog).not.toContain("| 'installing'");
  });

  it('keeps the simple install step focused on actionable controls only', () => {
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'install',
      'InstallDialog.tsx'
    );
    const optionsStep = sliceBetween(
      dialog,
      'const renderInstallOptions',
      'const renderExistingModConflict'
    );

    expect(optionsStep).toContain('install-name-field');
    expect(optionsStep).not.toContain('if (!installDialog.layoutPreview)');
    expect(optionsStep).not.toContain('Уже есть мод с таким же названием');
    expect(optionsStep).not.toContain('onResolveExistingMod');
    expect(dialog).not.toContain('Existing mod detected');
    expect(dialog).not.toContain('install-simple-identity');
    expect(dialog).not.toContain('install-meta-list');
    expect(dialog).not.toContain('install-preview-lines');
    expect(dialog).not.toContain('buildPlacementSummaryText');
    expect(dialog).not.toContain('buildPlacementPreviewLines');
    expect(dialog).not.toContain('installDestinationPreview');
    expect(dialog).not.toContain('installSourceLabel');
    expect(dialog).not.toContain('installCategoryLabel');
  });

  it('runs fast FOMOD detection separately from the background identity plan', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const startInstallFlow = sliceBetween(
      app,
      'const startInstallFlow = async',
      '  const resolveInstallDialogPlan = async'
    );

    expect(startInstallFlow).toContain("phase: 'detecting'");
    expect(startInstallFlow).toContain("installerKind: 'pending'");
    expect(startInstallFlow).toContain(
      'defaultInstallModName(source.displayName, source.sourcePath)'
    );
    expect(startInstallFlow).toContain('const detectionPromise = window.fluxora.downloads.analyzeFomod(');
    expect(startInstallFlow).toContain('const planPromise = planInstallSource(');
    expect(startInstallFlow).toContain('watchInstallDetection(operationId, fallbackName, detectionPromise)');
    expect(startInstallFlow).toContain('watchInstallPlan(operationId, planPromise)');
    expect(startInstallFlow).not.toContain('analyzeInstallLayout(');
  });

  it('reapplies an already resolved install plan after late FOMOD detection', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const detectionTransition = sliceBetween(
      app,
      'const installDialogWithDetection =',
      '  const watchInstallDetection ='
    );
    const fomodStart = detectionTransition.indexOf('if (fomodInstaller.isFomod)');
    const standardStart = detectionTransition.lastIndexOf(
      'const detectedDialog: InstallDialogState'
    );
    const fomodBranch = detectionTransition.slice(fomodStart, standardStart);

    expect(fomodBranch).toContain('attachBackgroundInstallPlan');
  });

  it('keeps an active installation non-visual while blocking another install action', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog(',
      '  const submitInstallOptions = async'
    );

    expect(app).toContain(
      'const downloadsActionsBusy = Boolean(downloadsBusyLabel) || installMutationInFlight;'
    );
    expect(submitInstallDialog).toContain('setInstallMutationInFlight(true)');
    expect(submitInstallDialog).toContain('setInstallMutationInFlight(false)');
    expect(submitInstallDialog).not.toContain('setDownloadsBusyLabel');
    expect(submitInstallDialog).not.toContain('Updating in background');
    expect(submitInstallDialog).not.toContain('Installing in background');
  });

  it('submits the final FOMOD choices without reopening the simple verification step', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'install',
      'InstallDialog.tsx'
    );
    const continueFromFomod = sliceBetween(
      app,
      'const continueFromFomod = async',
      '  async function submitInstallDialog('
    );
    const fomodStep = sliceBetween(
      dialog,
      'const renderInstallFomodStep',
      'const renderInstallOptions'
    );

    expect(continueFromFomod).toContain('await submitInstallDialog(fomodDialog)');
    expect(continueFromFomod).toContain("installerKind: 'fomod'");
    expect(continueFromFomod).not.toContain("phase: 'installing'");
    expect(continueFromFomod).not.toContain('analyzeInstallLayout(');
    expect(continueFromFomod).not.toContain("phase: 'options'");
    expect(fomodStep).toContain('Установить');
    expect(fomodStep).not.toContain('Review install');
  });

  it('keeps Smart Select in the current FOMOD step and refreshes stale context before any retry', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'install',
      'InstallDialog.tsx'
    );
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(dialog).toContain('Автовыбор · ${evaluation.selectedOptionIds.length} выбрано');
    expect(dialog).toContain('Пересчитать');
    expect(dialog).toContain('Вернуть автоподбор');
    expect(dialog).toContain('Почему выбрано');
    expect(submitInstallDialog).toContain("errorCode === 'install.fomodContextChanged'");
    expect(submitInstallDialog).toContain('retainedManualDecisions');
    expect(submitInstallDialog).toContain('selectedProjectProfileName');
    expect(submitInstallDialog).toContain('fomodContextId');
    expect(submitInstallDialog).toContain("phase: 'fomod'");
    expect(submitInstallDialog).toContain('нажмите «Установить» ещё раз');
  });

  it('keeps Details usable before the background placement preview resolves', () => {
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'install',
      'InstallDialog.tsx'
    );
    const detailsStep = sliceBetween(
      dialog,
      'const renderInstallDetails',
      'const dialogTitle ='
    );

    expect(detailsStep).toContain("className={`archive-tree${preview ? '' : ' archive-tree--pending'}`}");
    expect(detailsStep).toContain("<small>archive</small>");
    expect(detailsStep).not.toContain('return null');
  });

  it('moves existing mod handling into a dedicated install dialog phase', () => {
    const dialog = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'install',
      'InstallDialog.tsx'
    );
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const conflictStep = sliceBetween(
      dialog,
      'const renderExistingModConflict',
      'const renderInstallDetails'
    );

    expect(dialog).toContain("| 'conflict'");
    expect(dialog).toContain("installDialog.phase === 'conflict' ? renderExistingModConflict() : null");
    expect(conflictStep).toContain('Уже есть мод с таким же названием');
    expect(conflictStep).toContain('Заменить');
    expect(conflictStep).toContain('Полностью заменяет мод.');
    expect(conflictStep).toContain('Объединить');
    expect(conflictStep).toContain('Перезаписывает только файлы с одинаковыми названиями.');
    expect(conflictStep).toContain('Это другой мод');
    expect(conflictStep).toContain('onResolveExistingMod(1)');
    expect(conflictStep).toContain('onResolveExistingMod(2)');
    expect(conflictStep).toContain("onResolveExistingMod('installNew')");
    expect(styles).toContain('.install-dialog[data-phase="conflict"]');
    expect(styles).toContain('.install-existing-mod__choices');
  });

  it('uses the native identity plan for conflict choice and carries it into every mutation', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(app).not.toContain('findExistingInstalledModName');
    expect(app).toContain('const resolveInstallDialogPlan = async');
    expect(app).toContain('existingModMode: 0,');
    expect(app).toContain('onResolveExistingMod={(mode) => void submitInstallOptions(mode)}');
    expect(submitInstallDialog).toContain('let resolvedDialog = await resolveInstallDialogPlan');
    expect(submitInstallDialog).toContain(
      'const matchedTarget = matchedInstallTargetForCurrentName(submissionDialog);'
    );
    expect(submitInstallDialog).toContain(
      'const existingModNameForPrompt = matchedTarget?.displayName ?? null;'
    );
    expect(submitInstallDialog).toContain("phase: 'conflict'");
    expect(submitInstallDialog).toContain(
      'const existingModMode: FluxoraExistingModInstallMode ='
    );
    expect(submitInstallDialog).toContain('resolutionId: installPlan.resolutionId');
    expect(submitInstallDialog).toContain(
      "identityDecision: useMatchedTarget ? 'use-match' as const : 'install-new' as const"
    );
    expect(submitInstallDialog).toContain(
      'targetModUuid: useMatchedTarget ? matchedTarget!.modUuid : undefined'
    );
    expect(submitInstallDialog).toContain("newNamePolicy: 'first-free-copy-suffix' as const");
    expect(submitInstallDialog.match(/\.\.\.identitySelection/g)).toHaveLength(4);
    expect(submitInstallDialog).not.toContain("phase: 'installing'");
    expect(submitInstallDialog).not.toContain('mods.listInstalled');
  });

  it('replans a user-edited final name before deciding whether to show the conflict dialog', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const planInstallSource = sliceBetween(
      app,
      'const planInstallSource =',
      '  const startInstallFlow = async'
    );
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(planInstallSource).toContain('requestedModName?: string');
    expect(planInstallSource.match(/requestedModName,\s*\{ operationId \}/g)).toHaveLength(2);
    expect(submitInstallDialog).toContain('if (installPlanNeedsUserNameReplan(resolvedDialog))');
    expect(submitInstallDialog).toContain('const userNamePlan = await planInstallSource(');
    expect(submitInstallDialog).toContain('initialModName');
    expect(submitInstallDialog).toContain(
      'attachBackgroundInstallPlan(resolvedDialog, userNamePlan)'
    );
  });

  it('replans a stale identity decision without overwriting a user-edited name', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(submitInstallDialog).toContain("errorCode === 'install.identityPlanStale'");
    expect(submitInstallDialog).toContain('await planInstallSource(');
    expect(submitInstallDialog).toContain('applyInstallNameSuggestion(');
    expect(submitInstallDialog).toContain('submissionDialog,');
    expect(submitInstallDialog).toContain('const replannedDialog: InstallDialogState =');
    expect(submitInstallDialog).toContain('matchedInstallTargetForCurrentName(replannedDialog)');
    expect(submitInstallDialog).not.toContain('phase: plan.matchedTarget');
    expect(submitInstallDialog).toContain("submissionDialog.installerKind === 'fomod'");
  });

  it('creates the pending row before mutation and completes it from the authoritative result', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(submitInstallDialog).toContain('installSubmitInFlightRef.current');
    expect(submitInstallDialog).toContain('setInstallDialog((current) =>');
    expect(submitInstallDialog).toContain('pendingInstallOrchestrator.begin({');
    expect(submitInstallDialog).toContain('pendingInstallOrchestrator.complete(installed)');
    expect(submitInstallDialog).toContain('mergeOptimisticInstalledMod(current, installed)');
    expect(submitInstallDialog).toContain('pendingInstallOrchestrator.rollback(');
    expect(submitInstallDialog).not.toContain("phase: 'installing'");
    expect(submitInstallDialog).not.toContain('await loadModsWorkspace(selectedProject)');
    expect(submitInstallDialog).not.toContain('await loadPluginsWorkspace(selectedProject)');
  });

  it('reveals the pending row before mutation and the permanent row from the common success tail', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );
    const lastInstallBranchIndex = submitInstallDialog.lastIndexOf(
      'window.fluxora.archives.install('
    );
    const pendingRevealIndex = submitInstallDialog.indexOf('requestPostInstallModReveal({');
    const completedRevealIndex = submitInstallDialog.lastIndexOf('requestPostInstallModReveal({');
    const catchIndex = submitInstallDialog.indexOf('} catch (error)');

    expect(submitInstallDialog.match(/requestPostInstallModReveal\(\{/g)).toHaveLength(2);
    expect(lastInstallBranchIndex).toBeGreaterThan(-1);
    expect(pendingRevealIndex).toBeLessThan(lastInstallBranchIndex);
    expect(completedRevealIndex).toBeGreaterThan(lastInstallBranchIndex);
    expect(completedRevealIndex).toBeLessThan(catchIndex);
    expect(submitInstallDialog).toContain('installedId: pendingSession.pendingOrderId');
    expect(submitInstallDialog).toContain('installedId: installed.id');
    expect(submitInstallDialog).toContain('animate: false');
    expect(submitInstallDialog).toContain('animate: true');
    expect(submitInstallDialog.match(/\.\.\.identitySelection/g)).toHaveLength(4);
  });
});
