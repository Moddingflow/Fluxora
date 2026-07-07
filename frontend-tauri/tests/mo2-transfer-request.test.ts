import { describe, expect, it } from 'vitest';

import {
  createMo2TransferImportRequest,
  normalizeMo2TransferAnalysis,
  normalizeMo2TransferDestinationRoot,
  normalizeMo2TransferTargetProjectDirectory
} from '../src/renderer/mo2-transfer-request';
import type { FluxoraModOrganizerImportAnalysis } from '../src/shared/fluxora-api';

describe('createMo2TransferImportRequest', () => {
  it('creates a new Fluxora build when no existing config is provided', () => {
    expect(createMo2TransferImportRequest('E:\\MO2', 'D:\\Fluxora')).toEqual({
      sourceDirectory: 'E:\\MO2',
      destinationRootDirectory: 'D:\\Fluxora\\Fluxora Builds',
      replaceExisting: false
    });
  });

  it('ignores stale existing config arguments and still creates a new Fluxora build', () => {
    const createRequest = createMo2TransferImportRequest as (
      sourceDirectory: string,
      destinationRootDirectory: string,
      existingConfigPath: string
    ) => ReturnType<typeof createMo2TransferImportRequest>;

    expect(
      createRequest(
        'E:\\MO2',
        'D:\\Fluxora',
        'D:\\Fluxora\\Builds\\Skyrim.json'
      )
    ).toEqual({
      sourceDirectory: 'E:\\MO2',
      destinationRootDirectory: 'D:\\Fluxora\\Fluxora Builds',
      replaceExisting: false
    });
  });

  it('does not duplicate an already selected Fluxora Builds folder', () => {
    expect(createMo2TransferImportRequest('E:\\MO2', 'E:\\Fluxora Builds\\')).toEqual({
      sourceDirectory: 'E:\\MO2',
      destinationRootDirectory: 'E:\\Fluxora Builds',
      replaceExisting: false
    });
  });

  it('keeps the import payload limited to the new-build transfer contract', () => {
    const request = createMo2TransferImportRequest(
      'E:\\MO2\\Foundation Edition',
      'D:\\Games'
    );

    expect(Object.keys(request)).toEqual([
      'sourceDirectory',
      'destinationRootDirectory',
      'replaceExisting'
    ]);
    expect(request).toEqual({
      sourceDirectory: 'E:\\MO2\\Foundation Edition',
      destinationRootDirectory: 'D:\\Games\\Fluxora Builds',
      replaceExisting: false
    });
    expect(request).not.toHaveProperty('existingConfigPath');
  });

  it('trims the selected destination without mutating the source path payload', () => {
    expect(createMo2TransferImportRequest('  E:\\MO2  ', '  F:\\Library\\  ')).toEqual({
      sourceDirectory: '  E:\\MO2  ',
      destinationRootDirectory: 'F:\\Library\\Fluxora Builds',
      replaceExisting: false
    });
  });
});

describe('MO2 transfer destination normalization', () => {
  it('leaves an empty destination empty until the user picks a drive', () => {
    expect(normalizeMo2TransferDestinationRoot('')).toBe('');
    expect(normalizeMo2TransferDestinationRoot('   ')).toBe('');
  });

  it('places selected drive roots inside Fluxora Builds', () => {
    expect(normalizeMo2TransferDestinationRoot('E:\\')).toBe('E:\\Fluxora Builds');
    expect(normalizeMo2TransferDestinationRoot('E:')).toBe('E:\\Fluxora Builds');
  });

  it('recognizes Fluxora Builds roots case-insensitively', () => {
    expect(normalizeMo2TransferDestinationRoot('D:\\fluxora builds\\')).toBe('D:\\fluxora builds');
    expect(normalizeMo2TransferDestinationRoot('D:\\FLUXORA BUILDS')).toBe('D:\\FLUXORA BUILDS');
  });

  it('moves stale analyzed targets under Fluxora Builds while preserving suffixes', () => {
    expect(
      normalizeMo2TransferTargetProjectDirectory(
        'E:\\Foundation Edition-2',
        'E:\\',
        'Foundation Edition'
      )
    ).toBe('E:\\Fluxora Builds\\Foundation Edition-2');
  });

  it('preserves analyzed targets that are already inside Fluxora Builds', () => {
    expect(
      normalizeMo2TransferTargetProjectDirectory(
        'E:\\Fluxora Builds\\Foundation Edition-2',
        'E:\\',
        'Foundation Edition'
      )
    ).toBe('E:\\Fluxora Builds\\Foundation Edition-2');
  });

  it('preserves analyzed targets inside nested Fluxora Builds folders', () => {
    expect(
      normalizeMo2TransferTargetProjectDirectory(
        'E:\\Fluxora Builds\\Nested\\Foundation Edition',
        'E:\\',
        'Foundation Edition'
      )
    ).toBe('E:\\Fluxora Builds\\Nested\\Foundation Edition');
  });

  it('uses the fallback build name when the bridge has no target directory yet', () => {
    expect(
      normalizeMo2TransferTargetProjectDirectory('', 'E:\\Fluxora Builds', 'Foundation Edition')
    ).toBe('E:\\Fluxora Builds\\Foundation Edition');
  });

  it('canonicalizes stale bridge analysis before rendering or importing', () => {
    const staleAnalysis: FluxoraModOrganizerImportAnalysis = {
      sourceDirectory: 'E:\\Foundation Edition',
      destinationRootDirectory: 'E:\\',
      targetProjectDirectory: 'E:\\Foundation Edition-2',
      targetConfigPath: 'C:\\Fluxora\\Builds\\Foundation Edition.json',
      projectName: 'Foundation Edition',
      profileName: 'Default',
      templateId: 'skyrim-se',
      gameName: 'Skyrim Special Edition',
      gamePath: 'E:\\Steam\\Skyrim Special Edition',
      totalBytes: 1,
      availableBytes: 2,
      modCount: 1,
      separatorCount: 0,
      hasEnoughSpace: true,
      willOverwrite: false,
      canImport: true,
      statusMessage: 'Сборка готова к переносу.',
      warningMessage: '',
      operationId: 'op'
    };

    expect(normalizeMo2TransferAnalysis(staleAnalysis, 'E:\\')).toMatchObject({
      destinationRootDirectory: 'E:\\Fluxora Builds',
      targetProjectDirectory: 'E:\\Fluxora Builds\\Foundation Edition-2'
    });
  });

  it('uses the requested destination root when older bridge analysis omits it', () => {
    const partialAnalysis: FluxoraModOrganizerImportAnalysis = {
      sourceDirectory: 'E:\\Foundation Edition',
      destinationRootDirectory: '',
      targetProjectDirectory: '',
      targetConfigPath: 'C:\\Fluxora\\Builds\\Foundation Edition.json',
      projectName: 'Foundation Edition',
      profileName: 'Default',
      templateId: 'skyrim-se',
      gameName: 'Skyrim Special Edition',
      gamePath: 'E:\\Steam\\Skyrim Special Edition',
      totalBytes: 1,
      availableBytes: 2,
      modCount: 1,
      separatorCount: 0,
      hasEnoughSpace: true,
      willOverwrite: false,
      canImport: true,
      statusMessage: 'Сборка готова к переносу.',
      warningMessage: '',
      operationId: 'op'
    };

    expect(normalizeMo2TransferAnalysis(partialAnalysis, 'F:\\')).toMatchObject({
      destinationRootDirectory: 'F:\\Fluxora Builds',
      targetProjectDirectory: 'F:\\Fluxora Builds\\Foundation Edition'
    });
  });
});
