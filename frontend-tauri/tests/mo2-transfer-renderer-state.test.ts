import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('MO2 transfer renderer state contract', () => {
  it('keeps MO2 handoffs routed back into the main-window transfer state', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('return window.fluxora.transfer.onMo2Handoff((handoff) => {');
    expect(app).toContain('void startMo2TransferFromHandoff(handoff);');
    expect(app).toContain('setTransferSourceDirectory(handoff.request.sourceDirectory);');
    expect(app).toContain('setTransferDestinationRootDirectory(handoff.request.destinationRootDirectory);');
    expect(app).toContain("setTransferStep('review');");
    expect(app).toContain(
      'await startMo2Transfer(handoff.request.sourceDirectory, handoff.request.destinationRootDirectory, {'
    );
    expect(app).toContain('skipMainHandoff: true');
  });

  it('deduplicates matching analysis requests and sends an operation-scoped bridge call', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('const requestKey = `${sourceDirectory}\\n${destinationRootDirectory}`;');
    expect(app).toContain('if (existingRequest?.key === requestKey) {');
    expect(app).toContain("const operationId = createRendererOperationId('transfer_analyze_mo2');");
    expect(app).toContain(
      'window.fluxora.transfer.analyzeMo2(\n' +
        '          sourceDirectory,\n' +
        '          destinationRootDirectory,\n' +
        '          undefined,\n' +
        '          { operationId }\n' +
        '        )'
    );
    expect(app).toContain('transferAnalysisRequestRef.current = { key: requestKey, promise: request };');
  });

  it('uses normalized analysis to shape the import request and progress state', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('const normalizedAnalysis = normalizeMo2TransferAnalysis(analysis, destinationRootDirectory);');
    expect(app).toContain('normalizedAnalysis.destinationRootDirectory');
    expect(app).toContain(
      'const importRequest = createMo2TransferImportRequest(\n' +
        '      sourceDirectory,\n' +
        '      importDestinationRootDirectory\n' +
        '    );'
    );
    expect(app).toContain("const operationId = createRendererOperationId('transfer_import_mo2');");
    expect(app).toContain('transferRunningOperationIdRef.current = operationId;');
    expect(app).toContain('totalBytes: normalizedAnalysis.totalBytes');
    expect(app).toContain(
      'const imported = await window.fluxora.transfer.importMo2(\n' +
        '        importRequest,\n' +
        '        { operationId }\n' +
        '      );'
    );
  });

  it('hands settings-window imports to the main window instead of importing in-place', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('if (isSettingsWindow && !options.skipMainHandoff) {');
    expect(app).toContain(
      'await window.fluxora.transfer.startMo2InMain({\n' +
        '          request: importRequest,\n' +
        '          analysis: normalizedAnalysis\n' +
        '        });'
    );
    expect(app).toContain('await window.fluxora.windowControls.close();');
    expect(app).toContain('await window.fluxora.transfer.openMo2InMain();');
  });

  it('keeps the transferred project visible even when catalog refresh cannot complete', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');

    expect(app).toContain('setProjects((current) => upsertProject(current, imported));');
    expect(app).toContain('setSelectedProjectId(imported.id);');
    expect(app).toContain('keepMergedProjectOnError: true');
    expect(app).toContain('changeRoute(\'home\');');
  });
});
