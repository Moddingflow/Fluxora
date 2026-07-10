import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FluxPackExportDialog } from '../src/renderer/features/fluxpack/FluxPackExportDialog';

describe('FluxPackExportDialog', () => {
  it('uses the Fluxora dialog controls instead of native browser UI', () => {
    const markup = renderToStaticMarkup(
      React.createElement(FluxPackExportDialog, {
        buildName: 'Foundation Edition',
        defaultCompressionMode: 'smallest',
        onCancel: () => undefined,
        onConfirm: () => undefined,
        outputPath: 'C:\\Users\\Валера\\Downloads\\Foundation Edition.fluxpack'
      })
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('fluxpack-export-dialog__title');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('flx-custom-select');
    expect(markup).toContain('Минимальный размер');
    expect(markup).toContain('class="tool-button"');
    expect(markup).toContain('Добавить сгенерированные файлы');
    expect(markup).toContain('Nemesis, DynDOLOD и другие');
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('secondary-button');
  });
});
