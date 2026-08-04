import type { FluxoraExecutable } from '../../../shared/fluxora-api';
import { translateForLanguage } from '../../../localization';

export type ManagedExecutableKind = NonNullable<FluxoraExecutable['managedToolKind']>;

export interface ManagedExecutableDisplay {
  badgeLabel: string;
  outputModName: string;
  preparationLabel: string;
  toolName: string;
}

export const managedExecutableDisplay = (
  kind: FluxoraExecutable['managedToolKind'],
  projectName: string,
  language?: string | null
): ManagedExecutableDisplay | null => {
  switch (kind) {
    case 'bodySlide':
      return {
        badgeLabel: 'BodySlide · VFS',
        outputModName: `${projectName} - BodySlide Output`,
        preparationLabel: translateForLanguage(language, 'executable.preparingTool', { tool: 'BodySlide' }),
        toolName: 'BodySlide'
      };
    case 'texGen':
      return {
        badgeLabel: 'TexGen · VFS',
        outputModName: `${projectName} - TexGen Output`,
        preparationLabel: translateForLanguage(language, 'executable.preparingTool', { tool: 'TexGen' }),
        toolName: 'TexGen'
      };
    case 'dynDoLod':
      return {
        badgeLabel: 'DynDOLOD · VFS',
        outputModName: `${projectName} - DynDOLOD Output`,
        preparationLabel: translateForLanguage(language, 'executable.preparingTool', { tool: 'DynDOLOD' }),
        toolName: 'DynDOLOD'
      };
    default:
      return null;
  }
};
