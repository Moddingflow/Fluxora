import { describe, expect, it, vi } from 'vitest';

import type { FluxoraExecutable } from '../src/shared/fluxora-api';
import {
  commitExecutableDraft,
  type ExecutableDraftSaveDependencies
} from '../src/renderer/features/executables/executable-manager-save';

const draft: FluxoraExecutable[] = [{
  id: 'custom-one',
  displayName: 'Tool',
  executablePath: 'C:\\Tools\\tool.exe',
  arguments: '--private-value',
  workingDirectory: 'C:\\Tools',
  iconPath: ''
}];

const dependencies = (): ExecutableDraftSaveDependencies => ({
  inspect: vi.fn(async (_configPath, executablePath, request) => ({
    executablePath,
    suggestedDisplayName: 'Tool',
    displayNameSource: 'file-name' as const,
    iconPath: '',
    operationId: request.operationId ?? 'op-inspect'
  })),
  save: vi.fn(async () => draft),
  acceptCanonical: vi.fn(),
  close: vi.fn(async () => undefined)
});

describe('executable draft save coordinator', () => {
  it('performs one ordered mutation, accepts the canonical result, then closes', async () => {
    const calls: string[] = [];
    const canonical = [{ ...draft[0], displayName: 'Canonical Tool' }];
    const deps: ExecutableDraftSaveDependencies = {
      inspect: vi.fn(async (_configPath, executablePath, request) => ({
        executablePath,
        suggestedDisplayName: 'Tool',
        displayNameSource: 'file-name' as const,
        iconPath: '',
        operationId: request.operationId ?? 'op-inspect'
      })),
      save: vi.fn(async () => {
        calls.push('save');
        return canonical;
      }),
      acceptCanonical: vi.fn(() => calls.push('canonical')),
      close: vi.fn(async () => {
        calls.push('close');
      })
    };

    const result = await commitExecutableDraft({
      configPath: 'C:\\Projects\\demo.fluxora.json',
      executables: draft,
      operationId: 'op-save-1'
    }, deps);

    expect(deps.save).toHaveBeenCalledOnce();
    expect(deps.inspect).toHaveBeenCalledOnce();
    expect(deps.inspect).toHaveBeenCalledWith(
      'C:\\Projects\\demo.fluxora.json',
      'C:\\Tools\\tool.exe',
      { operationId: 'op-save-1' }
    );
    expect(deps.save).toHaveBeenCalledWith(
      'C:\\Projects\\demo.fluxora.json',
      draft,
      { operationId: 'op-save-1' }
    );
    expect(deps.acceptCanonical).toHaveBeenCalledWith(canonical);
    expect(result).toBe(canonical);
    expect(calls).toEqual(['save', 'canonical', 'close']);
  });

  it('keeps the draft window open when the native mutation fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.save).mockRejectedValueOnce(new Error('write failed'));

    await expect(commitExecutableDraft({
      configPath: 'C:\\Projects\\demo.fluxora.json',
      executables: draft,
      operationId: 'op-save-2'
    }, deps)).rejects.toThrow('write failed');

    expect(deps.save).toHaveBeenCalledOnce();
    expect(deps.acceptCanonical).not.toHaveBeenCalled();
    expect(deps.close).not.toHaveBeenCalled();
  });

  it('rejects the first unreadable path before performing any mutation', async () => {
    const deps = dependencies();
    vi.mocked(deps.inspect).mockRejectedValueOnce(new Error('file is not readable'));

    await expect(commitExecutableDraft({
      configPath: 'C:\\Projects\\demo.fluxora.json',
      executables: draft,
      operationId: 'op-save-3'
    }, deps)).rejects.toMatchObject({
      executableId: 'custom-one',
      message: 'file is not readable'
    });

    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.acceptCanonical).not.toHaveBeenCalled();
    expect(deps.close).not.toHaveBeenCalled();
  });
});
