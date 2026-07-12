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

  it('keeps the MO2-style install actions visible in the dialog chrome', () => {
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
    expect(dialog).not.toContain('Analyzing archive');
    expect(dialog).not.toContain("| 'analyzing'");
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

  it('opens install options immediately and moves archive analysis into the background', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const startInstallFlow = sliceBetween(
      app,
      'const startInstallFlow = async',
      '  const loadDownloadsWorkspace = async'
    );

    expect(startInstallFlow).toContain("phase: 'options'");
    expect(startInstallFlow).toContain(
      'defaultInstallModName(source.displayName, source.sourcePath)'
    );
    expect(startInstallFlow).toContain('const analysisPromise = (async (): Promise<InstallAnalysisResult>');
    expect(startInstallFlow).toContain('watchInstallAnalysis(operationId, analysisPromise)');
    expect(startInstallFlow).not.toContain("phase: 'analyzing'");
    expect(startInstallFlow).not.toContain('Analyzing archive');
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

  it('checks duplicate mod names only after install is submitted', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallOptions = sliceBetween(
      app,
      'const submitInstallOptions = async',
      '  useEffect(() => {'
    );

    expect(app).toContain('const resolveExistingModNameForInstall = async');
    expect(app).toContain('const waitForInstallLayoutPreview = async');
    expect(app).toContain('existingModMode: 0,');
    expect(app).toContain('onResolveExistingMod={(mode) => void submitInstallOptions(mode)}');
    expect(submitInstallOptions).toContain(
      'const layoutPreview = await waitForInstallLayoutPreview(installDialog);'
    );
    expect(submitInstallOptions).toContain(
      'const existingModNameForPrompt = await resolveExistingModNameForInstall'
    );
    expect(submitInstallOptions).toContain("phase: 'conflict'");
    expect(submitInstallOptions).toContain(
      'const existingModMode: FluxoraExistingModInstallMode = selectedExistingModMode ?? 0;'
    );
    expect(submitInstallOptions.indexOf('waitForInstallLayoutPreview')).toBeLessThan(
      submitInstallOptions.indexOf('resolveExistingModNameForInstall')
    );
    expect(submitInstallOptions.indexOf('resolveExistingModNameForInstall')).toBeLessThan(
      submitInstallOptions.indexOf("phase: 'installing'")
    );
  });

  it('commits the installed row immediately and reconciles native state in the background', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const submitInstallOptions = sliceBetween(
      app,
      'const submitInstallOptions = async',
      '  useEffect(() => {'
    );

    expect(submitInstallOptions).toContain('installSubmitInFlightRef.current');
    expect(submitInstallOptions).toContain('applyOptimisticInstalledMod(');
    expect(submitInstallOptions).toContain('void reconcileInstalledModAfterInstall(');
    expect(submitInstallOptions).not.toContain('await loadModsWorkspace(selectedProject)');
    expect(submitInstallOptions).not.toContain('await loadPluginsWorkspace(selectedProject)');
  });
});
