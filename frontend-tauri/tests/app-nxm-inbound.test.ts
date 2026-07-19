import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readApp = (): string =>
  fs.readFileSync(path.join(repoRoot, 'frontend-tauri', 'src', 'renderer', 'App.tsx'), 'utf8');

describe('App NXM inbound handling', () => {
  it('keeps ordinary download refreshes list-only', () => {
    const app = readApp();
    const loadDownloadsWorkspace =
      app.match(/const loadDownloadsWorkspace[\s\S]*?\n  const runDownloadMutation/)?.[0] ?? '';

    expect(loadDownloadsWorkspace).toContain('window.fluxora.downloads.list');
    expect(loadDownloadsWorkspace).not.toContain('window.fluxora.nxm.importInboundDownloads');
  });

  it('defers captured inbound NXM events until the selected project can import downloads', () => {
    const app = readApp();

    expect(app).toContain('const pendingInboundNxmEventRef = useRef<FluxoraNxmInboundLinksCaptured | null>(null);');
    expect(app).toContain('pendingInboundNxmEventRef.current = event;');
    expect(app).toContain('const pendingEvent = pendingInboundNxmEventRef.current;');
    expect(app).toContain('void importInboundDownloadsForProject(selectedProject, pendingEvent);');
  });

  it('preserves the inbound event operation id when importing the queued NXM links', () => {
    const app = readApp();
    const importer =
      app.match(/const importInboundDownloadsForProject[\s\S]*?\n  const importInboundDownloads/)?.[0] ?? '';

    expect(importer).toContain("const operationId = event.operationId || createRendererOperationId('nxm_inbound_event');");
    expect(importer).toContain('window.fluxora.nxm.importInboundDownloads');
    expect(importer).toContain("dispatchDownloadsWorkspace({ type: 'items-upserted', items: imported });");
    expect(importer).not.toContain('await loadDownloadsWorkspace(project, {');
    expect(importer).not.toContain('window.fluxora.downloads.list');
    expect(importer).not.toContain('setDownloadsBusyLabel');
    expect(importer).not.toContain('setMessage(null)');
    expect(importer).not.toContain('Imported ${imported.length} NXM link(s).');
  });

  it('keeps manual NXM import local to its own button state', () => {
    const app = readApp();
    const importer =
      app.match(/const importInboundDownloads = async[\s\S]*?\n  const moveInstallFomodStep/)?.[0] ?? '';

    expect(importer).toContain('setIsImportingNxmManually(true);');
    expect(importer).toContain('setIsImportingNxmManually(false);');
    expect(importer).not.toContain('runDownloadMutation');
    expect(importer).not.toContain('setDownloadsBusyLabel');
    expect(app).toContain('disabled={isImportingNxmManually}');
    expect(app).not.toContain('disabled={downloadsActionsBusy || isImportingNxmManually}');
  });
});
