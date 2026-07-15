import { describe, expect, it } from 'vitest';

import {
  applyInstallNameSuggestion,
  markInstallNameEdited
} from '../src/renderer/features/install/install-name-state';

describe('install name state', () => {
  it('applies an asynchronous identity suggestion while the source name is untouched', () => {
    expect(
      applyInstallNameSuggestion(
        { modName: 'SPID-7.2.0', modNameSource: 'source' },
        'Spell Perks Item Distributor',
        'identity'
      )
    ).toEqual({
      modName: 'Spell Perks Item Distributor',
      modNameSource: 'identity'
    });
  });

  it('never overwrites a name after the user edits it', () => {
    const edited = markInstallNameEdited(
      { modName: 'SPID-7.2.0', modNameSource: 'source' },
      'My SPID setup'
    );
    expect(applyInstallNameSuggestion(edited, 'Spell Perks Item Distributor', 'identity'))
      .toBe(edited);
  });

  it('uses a FOMOD module name when no identity match exists', () => {
    expect(
      applyInstallNameSuggestion(
        { modName: 'archive-name', modNameSource: 'source' },
        'Installer Module Name',
        'fomod'
      )
    ).toEqual({ modName: 'Installer Module Name', modNameSource: 'fomod' });
  });
});
