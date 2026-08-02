import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  GAME_TEMPLATE_BACKGROUND_FILES,
  gameTemplateBackgroundFor
} from '../src/renderer/assets/background';
import type { FluxoraGameTemplate } from '../src/shared/fluxora-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const backgroundDirectory = path.join(
  repoRoot,
  'frontend-tauri',
  'src',
  'renderer',
  'assets',
  'background'
);

describe('game-template background assets', () => {
  it('keeps a compressed local background for every bundled game definition', () => {
    const definitionDirectory = path.join(repoRoot, 'backend', 'resources', 'GameDefinitions');
    const definitions = fs
      .readdirSync(definitionDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) =>
        JSON.parse(fs.readFileSync(path.join(definitionDirectory, entry), 'utf8')) as {
          id: string;
        }
      );

    for (const definition of definitions) {
      const fileName = GAME_TEMPLATE_BACKGROUND_FILES[definition.id];
      expect(fileName, `missing background for ${definition.id}`).toBeTruthy();

      const asset = path.join(backgroundDirectory, fileName);
      expect(fs.existsSync(asset), `missing ${fileName}`).toBe(true);
      expect(fs.statSync(asset).size, `${fileName} exceeds the 96 KiB budget`).toBeLessThanOrEqual(
        96 * 1024
      );
    }
  });

  it('resolves legacy template identifiers to the same local artwork', () => {
    const template: FluxoraGameTemplate = {
      id: 'skyrim-special-edition',
      displayName: 'Skyrim Special Edition',
      gameName: 'Skyrim Special Edition',
      summary: 'Description must not be rendered on the selection tile.',
      uiTemplateId: 'skyrim'
    };

    const background = gameTemplateBackgroundFor(template);

    expect(background).toBeTruthy();
    expect(background?.fileName).toBe('skyrimse.webp');
    expect(background?.width).toBe(960);
    expect(background?.height).toBe(320);
  });
});
