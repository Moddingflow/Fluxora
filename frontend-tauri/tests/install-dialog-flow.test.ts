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

  it('keeps the MO2-style install actions visible after a dedicated analysis state', () => {
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
    expect(dialog).toContain("onPatch({ phase: 'details' })");
    expect(dialog).toContain('Analyzing installer');
    expect(dialog).toContain("| 'analyzing'");
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

  it('shows neutral analysis progress until the archive installer kind is known', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const startInstallFlow = sliceBetween(
      app,
      'const startInstallFlow = async',
      '  const loadDownloadsWorkspace = async'
    );

    expect(startInstallFlow).toContain("phase: 'analyzing'");
    expect(startInstallFlow).toContain(
      'defaultInstallModName(source.displayName, source.sourcePath)'
    );
    expect(startInstallFlow).toContain('const analysisPromise = (async (): Promise<InstallAnalysisResult>');
    expect(startInstallFlow).toContain('watchInstallAnalysis(operationId, analysisPromise)');
    expect(startInstallFlow).toContain('void primeInstalledModNamesForInstall(project, operationId)');
    expect(startInstallFlow).not.toContain('await primeInstalledModNamesForInstall(project, operationId)');
    expect(startInstallFlow.indexOf('await window.fluxora.downloads.analyzeFomod')).toBeLessThan(
      startInstallFlow.indexOf('void primeInstalledModNamesForInstall(project, operationId)')
    );
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
      '  const waitForInstallLayoutPreview = async'
    );
    const fomodStep = sliceBetween(
      dialog,
      'const renderInstallFomodStep',
      'const renderInstallOptions'
    );

    expect(continueFromFomod).toContain("phase: 'installing'");
    expect(continueFromFomod).toContain('await submitInstallDialog(fomodDialog)');
    expect(continueFromFomod).not.toContain("phase: 'options'");
    expect(fomodStep).toContain('Установить');
    expect(fomodStep).not.toContain('Review install');
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
    expect(conflictStep).toContain('onResolveExistingMod(1)');
    expect(conflictStep).toContain('onResolveExistingMod(2)');
    expect(styles).toContain('.install-dialog[data-phase="conflict"]');
    expect(styles).toContain('.install-existing-mod__choices');
  });

  it('deduplicates the conflict snapshot and claims submit before async preflight', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(app).toContain('const installModNamesLookupRef = useRef<InstallModNamesLookup | null>(null)');
    expect(app).toContain('const primeInstalledModNamesForInstall = (');
    expect(app).toContain('const resolveExistingModNameForInstall = async');
    expect(app).toContain('const waitForInstallLayoutPreview = async');
    expect(app).toContain('existingModMode: 0,');
    expect(app).toContain('onResolveExistingMod={(mode) => void submitInstallOptions(mode)}');
    expect(submitInstallDialog).toContain(
      'const layoutPreview = await waitForInstallLayoutPreview(installDialog);'
    );
    expect(submitInstallDialog).toContain(
      'const existingModNameForPrompt = await resolveExistingModNameForInstall'
    );
    expect(submitInstallDialog).toContain("phase: 'conflict'");
    expect(submitInstallDialog).toContain(
      'const existingModMode: FluxoraExistingModInstallMode = selectedExistingModMode ?? 0;'
    );
    expect(submitInstallDialog.indexOf('installSubmitInFlightRef.current = installDialog.operationId')).toBeLessThan(
      submitInstallDialog.indexOf('waitForInstallLayoutPreview')
    );
    expect(submitInstallDialog.indexOf('waitForInstallLayoutPreview')).toBeLessThan(
      submitInstallDialog.indexOf('resolveExistingModNameForInstall')
    );
    expect(submitInstallDialog.indexOf('resolveExistingModNameForInstall')).toBeLessThan(
      submitInstallDialog.lastIndexOf("phase: 'installing'")
    );
  });

  it('commits the installed row immediately and reconciles native state in the background', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallDialog = sliceBetween(
      app,
      'async function submitInstallDialog',
      '  const submitInstallOptions = async'
    );

    expect(submitInstallDialog).toContain('installSubmitInFlightRef.current');
    expect(submitInstallDialog).toContain('applyOptimisticInstalledMod(');
    expect(submitInstallDialog).toContain('void reconcileInstalledModAfterInstall(');
    expect(submitInstallDialog).not.toContain('await loadModsWorkspace(selectedProject)');
    expect(submitInstallDialog).not.toContain('await loadPluginsWorkspace(selectedProject)');
  });
});
