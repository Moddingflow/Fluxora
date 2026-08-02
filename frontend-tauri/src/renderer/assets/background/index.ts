import type { FluxoraGameTemplate } from '../../../shared/fluxora-api';

import skyrimSpecialEditionSource from './skyrimse.webp';

export interface GameTemplateBackgroundAsset {
  fileName: string;
  height: number;
  src: string;
  width: number;
}

const skyrimSpecialEdition: GameTemplateBackgroundAsset = {
  fileName: 'skyrimse.webp',
  height: 320,
  src: skyrimSpecialEditionSource,
  width: 960
};

export const GAME_TEMPLATE_BACKGROUND_FILES: Readonly<Record<string, string>> = {
  skyrimse: skyrimSpecialEdition.fileName
};

const backgroundsByTemplateId: Readonly<Record<string, GameTemplateBackgroundAsset>> = {
  skyrim: skyrimSpecialEdition,
  'skyrim-special-edition': skyrimSpecialEdition,
  skyrimse: skyrimSpecialEdition
};

export const gameTemplateBackgroundFor = (
  template: Pick<FluxoraGameTemplate, 'id' | 'uiTemplateId'>
): GameTemplateBackgroundAsset | null =>
  backgroundsByTemplateId[template.id.trim().toLowerCase()] ??
  backgroundsByTemplateId[template.uiTemplateId.trim().toLowerCase()] ??
  null;
