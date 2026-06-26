import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('build opening splash', () => {
  it('routes opening a build through the cancellable loading splash', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('OpeningBuildSplashState');
    expect(app).toContain('setOpeningBuildSplash({');
    expect(app).toContain('openingBuildOperationIdRef.current = operationId');
    expect(app).toContain('openProjectConfig(configPath, operationId)');
    expect(app).toContain('cancelOpeningBuild');
    expect(app).toContain('renderOpeningBuildSplash()');
    expect(app).toContain('messages={openingBuildMessages}');
    expect(app).not.toContain("setBusyLabel('Opening build')");
  });
});
