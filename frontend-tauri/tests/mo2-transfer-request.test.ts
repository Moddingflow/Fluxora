import { describe, expect, it } from 'vitest';

import { createMo2TransferImportRequest } from '../src/renderer/mo2-transfer-request';

describe('createMo2TransferImportRequest', () => {
  it('creates a new Fluxora build when no existing config is provided', () => {
    expect(createMo2TransferImportRequest('E:\\MO2', 'D:\\Fluxora')).toEqual({
      sourceDirectory: 'E:\\MO2',
      destinationRootDirectory: 'D:\\Fluxora',
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
      destinationRootDirectory: 'D:\\Fluxora',
      replaceExisting: false
    });
  });
});
