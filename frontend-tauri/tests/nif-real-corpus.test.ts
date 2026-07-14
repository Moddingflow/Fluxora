import { opendir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseNifModel } from '../src/renderer/features/file-preview/nif-parser';

const fixturePath = process.env.FLUXORA_NIF_FIXTURE;
const describeRealNif = fixturePath ? describe : describe.skip;

const collectNifFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for await (const entry of await opendir(directory)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nif')) {
        files.push(path);
      }
    }
  }
  return files;
};

const sampleEvenly = (paths: string[], limit: number): string[] => {
  if (paths.length <= limit) {
    return paths;
  }
  return Array.from({ length: limit }, (_, index) =>
    paths[Math.floor(index * paths.length / limit)]
  );
};

describeRealNif('real NIF regression corpus', () => {
  it('decodes supplied models through the production parser interface', async () => {
    const fixture = fixturePath!;
    const fixtureStats = await stat(fixture);
    const limit = Number.parseInt(process.env.FLUXORA_NIF_CORPUS_LIMIT ?? '250', 10);
    const paths = fixtureStats.isDirectory()
      ? sampleEvenly(await collectNifFiles(fixture), limit)
      : [fixture];
    const failures: string[] = [];
    let geometryCandidates = 0;

    for (const path of paths) {
      let detectedBlocks = 'unknown';
      try {
        const bytes = await readFile(path);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
        const text = new TextDecoder().decode(bytes);
        detectedBlocks = [
          'NiTriShapeData',
          'BSTriShape',
          'BSDynamicTriShape',
          'NiSkinPartition'
        ].filter((block) => text.includes(block)).join(',') || 'none';
        if (detectedBlocks !== 'none') {
          geometryCandidates += 1;
        }
        const model = parseNifModel(buffer);
        const intentionallyEmpty = model.warnings.includes(
          'NIF contains no renderable triangle geometry; the preview is intentionally empty.'
        );
        if (
          (model.meshes.length === 0 && !intentionallyEmpty) ||
          model.meshes.some((mesh) => mesh.positions.length < 9)
        ) {
          failures.push(`${path}: decoded without renderable geometry`);
        }
      } catch (error) {
        if (detectedBlocks === 'none') {
          continue;
        }
        failures.push(
          `${path} [${detectedBlocks}]: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    expect(paths.length).toBeGreaterThan(0);
    expect(geometryCandidates).toBeGreaterThan(0);
    expect(failures, failures.slice(0, 50).join('\n')).toEqual([]);
  }, 600_000);
});
