import type { FluxoraExecutable } from '../../../shared/fluxora-api';

export type ManagedExecutableKind = NonNullable<FluxoraExecutable['managedToolKind']>;

export interface ManagedExecutableDisplay {
  badgeLabel: string;
  outputModName: string;
  preparationLabel: string;
  toolName: string;
}

export const managedExecutableDisplay = (
  kind: FluxoraExecutable['managedToolKind'],
  projectName: string
): ManagedExecutableDisplay | null => {
  switch (kind) {
    case 'bodySlide':
      return {
        badgeLabel: 'BodySlide · VFS',
        outputModName: `${projectName} - BodySlide Output`,
        preparationLabel: 'Подготовка BodySlide',
        toolName: 'BodySlide'
      };
    case 'texGen':
      return {
        badgeLabel: 'TexGen · VFS',
        outputModName: 'TexGen Output',
        preparationLabel: 'Подготовка TexGen',
        toolName: 'TexGen'
      };
    case 'dynDoLod':
      return {
        badgeLabel: 'DynDOLOD · VFS',
        outputModName: 'DynDOLOD Output',
        preparationLabel: 'Подготовка DynDOLOD',
        toolName: 'DynDOLOD'
      };
    default:
      return null;
  }
};
