import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readApp = (): string =>
  fs.readFileSync(path.join(repoRoot, 'frontend-tauri', 'src', 'renderer', 'App.tsx'), 'utf8');

describe('download progress refresh', () => {
  it('polls active visible downloads quickly without busy UI or scroll reset', () => {
    const app = readApp();
    const progressRefresh =
      app.match(/useEffect\(\(\) => \{\s*const downloadsVisible[\s\S]*?selectedProject\s*\n  \]\);/)?.[0] ?? '';

    expect(app).toContain('const DOWNLOAD_PROGRESS_REFRESH_INTERVAL_MS = 500;');
    expect(progressRefresh).toContain("activeRoute === 'downloads'");
    expect(progressRefresh).toContain("activeRoute === 'build' && activeRightPane === 'downloads'");
    expect(progressRefresh).toContain('hasActiveDownload(downloadsWorkspace.items)');
    expect(progressRefresh).toContain('downloadProgressRefreshInFlightRef.current');
    expect(progressRefresh).toContain("createRendererOperationId('downloads_progress_refresh')");
    expect(progressRefresh).toContain('resetScroll: false');
    expect(progressRefresh).toContain('showBusy: false');
    expect(progressRefresh).toContain('showLoading: false');
    expect(progressRefresh).toContain('DOWNLOAD_PROGRESS_REFRESH_INTERVAL_MS');
  });
});
