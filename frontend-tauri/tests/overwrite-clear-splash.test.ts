import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('overwrite clear splash', () => {
  it('routes overwrite clearing through the loading splash instead of the success toast', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('OverwriteClearSplashState');
    expect(app).toContain('const overwriteClearMessages = [');
    expect(app).toContain('setOverwriteClearSplash({');
    expect(app).toContain('window.fluxora.mods.clearOverwrite');
    expect(app).toContain('messages={overwriteClearMessages}');
    expect(app).toContain('Прогресс очистки override');
    expect(app).not.toContain('Overwrite folder cleared.');
  });
});
