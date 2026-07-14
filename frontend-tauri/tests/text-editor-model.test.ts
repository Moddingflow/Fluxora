import { describe, expect, it } from 'vitest';

import {
  createTextEditorTab,
  detectLineEnding,
  flattenTextEditorFileTree,
  isTextEditorFileName,
  searchTextEditorTabs,
  textEditorLanguageForFile
} from '../src/renderer/features/text-editor/text-editor-model';

const document = (fileName: string, content: string, path = `C:\\workspace\\${fileName}`) => ({
  path,
  fileName,
  content,
  size: content.length,
  operationId: 'op_test'
});

describe('text editor model', () => {
  it('recognizes editable files and resolves Monaco language modes', () => {
    expect(isTextEditorFileName('BugFixesSSE.json')).toBe(true);
    expect(isTextEditorFileName('.editorconfig')).toBe(true);
    expect(isTextEditorFileName('mesh.nif')).toBe(false);

    expect(textEditorLanguageForFile('settings.jsonc')).toEqual({
      id: 'json',
      label: 'JSON with Comments'
    });
    expect(textEditorLanguageForFile('plugin.psc')).toEqual({
      id: 'papyrus',
      label: 'Papyrus'
    });
    expect(textEditorLanguageForFile('README')).toEqual({
      id: 'markdown',
      label: 'Markdown'
    });
  });

  it('keeps file identity and dirty state independent from presentation', () => {
    const tab = createTextEditorTab(document('Example.ts', 'const value = 1;'), 'file');

    expect(tab.id).toBe('file:C:\\workspace\\Example.ts');
    expect(createTextEditorTab(document('example.ts', '', 'C:\\workspace\\example.ts'), 'file').id)
      .not.toBe(tab.id);
    expect(tab.languageId).toBe('typescript');
    expect(tab.content).toBe(tab.savedContent);
  });

  it('searches every open document with case, word and regex controls', () => {
    const tabs = [
      createTextEditorTab(document('one.ts', 'const playerName = "Dragonborn";\nplayerName;'), 'file'),
      createTextEditorTab(document('two.json', '{\n  "player": "dragonborn"\n}'), 'file')
    ];

    expect(searchTextEditorTabs(tabs, 'dragonborn')).toHaveLength(2);
    expect(searchTextEditorTabs(tabs, 'Dragonborn', { matchCase: true })).toHaveLength(1);
    expect(searchTextEditorTabs(tabs, 'player', { wholeWord: true })).toHaveLength(1);
    expect(searchTextEditorTabs(tabs, 'player(Name)?', { useRegex: true })).toHaveLength(3);
    expect(searchTextEditorTabs(tabs, '[', { useRegex: true })).toEqual([]);
  });

  it('reports the document line ending used by the status bar', () => {
    expect(detectLineEnding('first\r\nsecond\r\n')).toBe('CRLF');
    expect(detectLineEnding('first\nsecond\n')).toBe('LF');
  });

  it('flattens only expanded lazy mod directories for the Explorer', () => {
    const directory = (name: string, relativePath: string) => ({
      name,
      relativePath,
      isDirectory: true,
      hasChildren: true,
      size: 0,
      conflictState: 'none',
      conflictOwners: []
    });
    const file = (name: string, relativePath: string) => ({
      name,
      relativePath,
      isDirectory: false,
      hasChildren: false,
      size: 42,
      conflictState: 'none',
      conflictOwners: []
    });
    const cache = {
      '': [directory('SKSE', 'SKSE'), file('README.md', 'README.md')],
      SKSE: [directory('Plugins', 'SKSE/Plugins')],
      'SKSE/Plugins': [file('BugFixesSSE.json', 'SKSE/Plugins/BugFixesSSE.json')]
    };

    expect(flattenTextEditorFileTree(cache, new Set(['SKSE']))).toEqual([
      { depth: 0, entry: cache[''][0] },
      { depth: 1, entry: cache.SKSE[0] },
      { depth: 0, entry: cache[''][1] }
    ]);
  });
});
