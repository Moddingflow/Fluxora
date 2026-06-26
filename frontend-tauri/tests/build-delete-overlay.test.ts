import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('build operation overlays', () => {
  it('auto-closes successful build deletion without showing a success toast', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('const closeOperationOverlay = (operationId: string) => {');
    expect(app).toMatch(
      /await deleteProjectConfig\(project, operationId\);[\s\S]*closeOperationOverlay\(operationId\);/
    );
    expect(app).not.toContain('setMessage(`Deleted ${project.name}`)');
    expect(app).not.toContain('finishOperationOverlay(operationId, `Deleted ${project.name}`)');
    expect(app).toContain('failOperationOverlay(operationId, nextMessage);');
  });

  it('auto-closes successful build creation without requiring the Close button', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toMatch(
      /const \{ project: created \} = await createProjectFromDraft\(draft, operationId\);[\s\S]*setIsCreateOpen\(false\);[\s\S]*changeRoute\('build'\);[\s\S]*closeOperationOverlay\(operationId\);/
    );
    expect(app).not.toContain('setMessage(`Created ${created.name}`)');
    expect(app).not.toContain('finishOperationOverlay(operationId, `Created ${created.name}`)');
  });
});
