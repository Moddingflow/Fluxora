import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('downloads drag and drop affordance', () => {
  it('renders a drop surface over the existing downloads table without bypassing the facade', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('download-drop-surface');
    expect(app).toContain("data-drop-state={downloadDropCue}");
    expect(app).toContain('renderDownloadDropSurface(renderDownloadRows())');
    expect(app).toContain('window.fluxora.fileDrop');
    expect(app).toContain('window.fluxora.downloads.importFile');
    expect(app).not.toContain('@tauri-apps/api/webview');
  });

  it('keeps the drag/drop animation in downloads-specific CSS', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toContain('.download-drop-surface[data-drop-state="hover"] .download-drop-cue');
    expect(styles).toContain('.download-drop-surface[data-drop-state="importing"] .download-drop-cue__content');
    expect(styles).toContain('@keyframes download-drop-sweep');
    expect(styles).toContain('@keyframes download-drop-lift');
  });

  it('keeps dropped file paths behind the typed Fluxora API boundary', () => {
    const contract = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const tauriApi = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');

    expect(contract).toContain('export type FluxoraFileDropEvent');
    expect(contract).toContain('fileDrop: {');
    expect(tauriApi).toContain('getCurrentWebview().onDragDropEvent');
    expect(tauriApi).toContain('callback(toFluxoraFileDropEvent(event.payload))');
  });
});
