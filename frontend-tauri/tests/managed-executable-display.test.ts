import { describe, expect, it } from 'vitest';

import { managedExecutableDisplay } from '../src/renderer/features/executables/managed-executable-display';

describe('managed executable display', () => {
  it.each([
    [
      'bodySlide',
      {
        badgeLabel: 'BodySlide · VFS',
        outputModName: 'Foundation - BodySlide Output',
        preparationLabel: 'Подготовка BodySlide',
        toolName: 'BodySlide'
      }
    ],
    [
      'texGen',
      {
        badgeLabel: 'TexGen · VFS',
        outputModName: 'Foundation - TexGen Output',
        preparationLabel: 'Подготовка TexGen',
        toolName: 'TexGen'
      }
    ],
    [
      'dynDoLod',
      {
        badgeLabel: 'DynDOLOD · VFS',
        outputModName: 'Foundation - DynDOLOD Output',
        preparationLabel: 'Подготовка DynDOLOD',
        toolName: 'DynDOLOD'
      }
    ]
  ] as const)('describes %s without renderer state', (kind, expected) => {
    expect(managedExecutableDisplay(kind, 'Foundation')).toEqual(expected);
  });

  it('leaves ordinary executables unmanaged', () => {
    expect(managedExecutableDisplay(undefined, 'Foundation')).toBeNull();
  });
});
