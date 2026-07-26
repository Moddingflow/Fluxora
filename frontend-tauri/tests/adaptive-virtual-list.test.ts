import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('adaptive workspace list virtualization', () => {
  it('keeps display-synchronized scroll state outside the root App component', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const virtualList = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'components',
      'virtualization',
      'AdaptiveVirtualList.tsx'
    );

    expect(app).toContain('items={displayedModItems}');
    expect(app).toContain('items={filteredPluginItems}');
    expect(app).toContain('items={filteredDownloadItems}');
    expect(app).toContain('virtualizerRef={modListVirtualizerRef}');
    expect(app).toContain('virtualizerRef={pluginListVirtualizerRef}');
    expect(app).toContain('virtualizerRef={downloadListVirtualizerRef}');
    expect(app).not.toContain('setModListScrollTop');
    expect(app).not.toContain('setPluginListScrollTop');
    expect(app).not.toContain('setDownloadListScrollTop');
    expect(virtualList).toContain('window.requestAnimationFrame');
    expect(virtualList).toContain('new ResizeObserver');
    expect(virtualList).toContain('createAdaptiveVirtualWindow');
    expect(virtualList).toContain('data-virtualized="adaptive"');
  });

  it('forces already-windowed rows to paint immediately', () => {
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');

    expect(styles).toMatch(
      /\.mod-list-row\s*\{[\s\S]*?contain: layout style;[\s\S]*?content-visibility: visible;/
    );
    expect(styles).toMatch(
      /\.plugin-row:not\(\.mod-row--head\)\s*\{[\s\S]*?contain: layout style;[\s\S]*?content-visibility: visible;/
    );
    expect(styles).toContain('.adaptive-virtual-list__spacer');
    expect(styles).toContain('overflow-anchor: none');
  });
});
