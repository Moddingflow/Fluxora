import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readText = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

describe('mod details window', () => {
  it('opens installed mods in a dedicated Tauri window from double-click', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');
    const detailsWindow = app.slice(
      app.indexOf('const renderModDetailsWindow'),
      app.indexOf('const renderModsWorkspace')
    );

    expect(app).toContain("const isModDetailsWindow = windowMode === 'mod-details';");
    expect(app).toContain("return modDetailsInitialName || 'Details';");
    expect(app).not.toContain('return `Mod · ${modDetailsInitialName');
    expect(app).toContain('void openModDetailsWindow(item);');
    expect(app).toContain('event.detail === 2');
    expect(app).toContain('window.fluxora.windowControls.openModDetails(');
    expect(app).toContain('writeModDetailsBootstrap({');
    expect(app).toContain('modDetailsBootstrapKey');
    expect(app).toContain('.getModDetailsSummary(projectDirectory');
    expect(app).toContain('window.fluxora.mods.getModConflictTree');
    expect(app).toContain('window.fluxora.mods.getModDetailsContent');
    expect(app).toContain('modDetailsContentFileTree');
    expect(app).toContain('initialModDetailsBootstrap?.content');
    expect(app).toContain('const bootstrapItem = initialModDetailsBootstrap?.item;');
    expect(app).toContain('bootstrapItem?.isMod');
    expect(app).toContain('role="tablist" aria-label="Mod details sections"');
    expect(app).toContain('modOrderItemMatchesLookup(item, modDetailsModId)');
    expect(app).toContain('Файлы');
    expect(app).toContain('Конфликты');
    expect(app).toContain('Перезаписывает:');
    expect(app).toContain('Перезаписывается:');
    expect(app).not.toContain('const scanDirectory = async');
    expect(app).not.toMatch(/Loading mod(?!s)/);
    expect(detailsWindow).not.toContain('Loading tree');
    expect(detailsWindow).not.toContain('Scanning files');
    expect(sharedApi).toContain("windowOpenModDetails: 'fluxora:window:open-mod-details'");
    expect(sharedApi).toContain('FluxoraModDetailsBootstrap');
    expect(sharedApi).toContain('FluxoraModDetailsContent');
    expect(sharedApi).toContain('getModDetailsContent: (');
    expect(sharedApi).toContain('getModConflictTree: (');
    expect(sharedApi).toContain('getModDetailsSummary: (');
    expect(facade).toContain("invoke('fluxora_open_mod_details_window'");
    expect(facade).toContain('bootstrapKey');
    expect(rustShell).toContain('MOD_DETAILS_WINDOW_LABEL_PREFIX');
    expect(rustShell).toContain('&bootstrap=');
    expect(rustShell).toContain('__FLUXORA_MOD_DETAILS_BOOTSTRAP__');
    expect(rustShell).toContain('interactive_process: Mutex<BridgeProcess>');
    expect(rustShell).toContain('bridge_lane_for_method(&method)');
    expect(rustShell).toContain('.initialization_script(');
    expect(rustShell).toContain('.title(mod_title)');
    expect(rustShell).not.toContain('.title(format!("Mod \\u{00B7} {mod_title}"))');
    expect(capabilities).toContain('"mod-details:*"');
  });

  it('uses downloaded commercial-use icon assets for the mod details tabs', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const iconsReadme = readText('Icons', 'README.md');
    const folderTree = readText('Icons', 'folder-tree.svg');
    const compare = readText('Icons', 'git-compare-arrows.svg');

    expect(app).toContain("../../../Icons/folder-tree.svg");
    expect(app).toContain("../../../Icons/git-compare-arrows.svg");
    expect(app).toContain('className="asset-icon"');
    expect(styles).toContain('.mod-details-window');
    expect(styles).toContain('mask: var(--asset-icon) center / contain no-repeat;');
    expect(iconsReadme).toContain('folder-tree.svg');
    expect(iconsReadme).toContain('git-compare-arrows.svg');
    expect(iconsReadme).toContain('lucide-icons/lucide');
    expect(iconsReadme).toContain('tag `1.21.0`');
    expect(iconsReadme).toContain('Licence: ISC');
    expect(iconsReadme).toContain('LUCIDE-LICENSE.txt');
    expect(folderTree).toContain('<svg');
    expect(compare).toContain('<svg');
  });

  it('opens text files from the mod tree in a larger app text editor window', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const main = readText('frontend-tauri', 'src', 'renderer', 'main.tsx');
    const editor = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'text-editor',
      'TextEditorWorkspace.tsx'
    );
    const editorWindow = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'text-editor',
      'TextEditorWindow.tsx'
    );
    const editorModel = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'text-editor',
      'text-editor-model.ts'
    );
    const monacoSurface = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'text-editor',
      'MonacoEditorSurface.tsx'
    );
    const editorStyles = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'text-editor',
      'text-editor-workbench.css'
    );
    const packageJson = readText('frontend-tauri', 'package.json');
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');

    expect(main).toContain("windowMode === 'text-editor'");
    expect(main).toContain('LazyTextEditorWindow');
    expect(app).toContain('window.fluxora.windowControls.openTextEditor(');
    expect(app).toContain('isTextEditorFileName(entry.name)');
    expect(editorWindow).toContain('<TextEditorWorkspace');
    expect(editorWindow).toContain('TEXT_EDITOR_REQUEST_CLOSE_EVENT');
    expect(editorWindow).toContain("parameters.get('directory')");
    expect(editorModel).toContain("'.json'");
    expect(editorModel).toContain("'.txt'");
    expect(editor).toContain('LazyMonacoEditorSurface');
    expect(editor).toContain('loadMonacoEditorSurface');
    expect(editor).toContain('<TextEditorSidebar');
    expect(editor).toContain('Command Palette');
    expect(editor).toContain('Save All');
    expect(editor).toContain("runEditorAction('undo')");
    expect(editor).toContain("runEditorAction('redo')");
    expect(monacoSurface).toContain('monaco.editor.create');
    expect(monacoSurface).toContain('bracketPairColorization');
    expect(monacoSurface).toContain('registerPapyrusLanguage');
    expect(monacoSurface).toContain('monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS');
    expect(monacoSurface).toContain("cursorSmoothCaretAnimation: 'off'");
    expect(monacoSurface).toContain('smoothScrolling: false');
    expect(styles).toContain('@import "./features/text-editor/text-editor-workbench.css";');
    expect(editorStyles).toContain('.text-editor-activitybar');
    expect(editorStyles).toContain('.text-editor-statusbar');
    expect(packageJson).toContain('"monaco-editor": "0.55.1"');
    expect(sharedApi).toContain("windowOpenTextEditor: 'fluxora:window:open-text-editor'");
    expect(sharedApi).toContain('projectDirectory: string');
    expect(sharedApi).toContain('textFiles: {');
    expect(facade).toContain("invoke('fluxora_open_text_editor_window'");
    expect(facade).toContain("'mods.readTextFile'");
    expect(facade).toContain("'textFiles.save'");
    expect(rustShell).toContain('TEXT_EDITOR_WINDOW_LABEL_PREFIX');
    expect(rustShell).toContain('Editor \\u{00B7}');
    expect(rustShell).toContain('&directory={}');
    expect(rustShell).toContain('.inner_size(1344.0, 912.0)');
    expect(capabilities).toContain('"text-editor:*"');
  });

  it('opens nif files from the mod tree in a generic file preview window', () => {
    const app = readText('frontend-tauri', 'src', 'renderer', 'App.tsx');
    const workspace = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'file-preview',
      'FilePreviewWorkspace.tsx'
    );
    const parser = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'file-preview',
      'nif-parser.ts'
    );
    const registry = readText(
      'frontend-tauri',
      'src',
      'renderer',
      'features',
      'file-preview',
      'preview-kind-registry.ts'
    );
    const styles = readText('frontend-tauri', 'src', 'renderer', 'styles.css');
    const sharedApi = readText('frontend-tauri', 'src', 'shared', 'fluxora-api.ts');
    const facade = readText('frontend-tauri', 'src', 'tauri', 'fluxora-api.ts');
    const rustShell = readText('frontend-tauri', 'src-tauri', 'src', 'lib.rs');
    const capabilities = readText('frontend-tauri', 'src-tauri', 'capabilities', 'main.json');
    const packageJson = readText('frontend-tauri', 'package.json');
    const iconsReadme = readText('Icons', 'README.md');
    const cuboid = readText('Icons', 'cuboid.svg');
    const preparedModel = workspace.slice(
      workspace.indexOf('const renderPreparedModel'),
      workspace.indexOf('useEffect(() => {', workspace.indexOf('const renderPreparedModel'))
    );

    expect(app).toContain("const isFilePreviewWindow = windowMode === 'file-preview';");
    expect(app).toContain('previewKindForFile(entry.name)');
    expect(app).toContain('onClick={() => void openFilePreviewForFile(entry)}');
    expect(app).toContain('window.fluxora.windowControls.openFilePreview(');
    expect(app).toContain("windowParameters.get('directory')");
    expect(app).toContain(
      "projectDirectory={filePreviewProjectDirectory || selectedProject?.projectDirectory || ''}"
    );
    expect(app).toContain('<FilePreviewWorkspace');
    expect(app).toContain("import('./features/file-preview/FilePreviewWorkspace')");
    expect(app).toContain('<Suspense');
    expect(app).not.toContain(
      "import { FilePreviewWorkspace } from './features/file-preview/FilePreviewWorkspace';"
    );
    expect(registry).toContain("title: '.nif Preview'");
    expect(registry).toContain("extension: '.nif'");
    expect(registry).toContain('cuboid.svg');
    expect(workspace).toContain('new THREE.WebGLRenderer({ antialias: true })');
    expect(workspace).toContain('OrbitControls');
    expect(workspace).toContain('createDdsPreviewTexture');
    expect(workspace).toContain('isDdsBuffer');
    expect(workspace).toContain('new THREE.TextureLoader()');
    expect(workspace).toContain('startNifPreview');
    expect(workspace).toContain('prepareNifPreviewTextures');
    expect(workspace).toContain('readNifPreviewAssetBytes');
    expect(workspace).toContain('NifPreviewWorkerClient');
    expect(workspace).not.toContain('Loading preview');
    expect(preparedModel.indexOf("setRenderState('ready')")).toBeGreaterThanOrEqual(0);
    expect(preparedModel.indexOf("setRenderState('ready')")).toBeLessThan(
      preparedModel.indexOf('void prepareTextures(')
    );
    expect(workspace).toContain('file-preview-source-mod');
    expect(parser).toContain("'NiNode'");
    expect(parser).toContain("'BSFadeNode'");
    expect(parser).toContain("'NiTriShape'");
    expect(parser).toContain("'BSTriShape'");
    expect(parser).toContain("'NiTriShapeData'");
    expect(parser).toContain("'BSLightingShaderProperty'");
    expect(parser).toContain("'BSShaderTextureSet'");
    expect(parser).toContain("'NiAlphaProperty'");
    expect(parser).not.toContain('Unsupported static preview fallback');
    expect(parser).toContain('NIF geometry could not be decoded.');
    expect(parser).toContain('data: bytes.subarray(offset, offset + size)');
    expect(parser).not.toContain('data: bytes.slice(offset, offset + size)');
    expect(styles).toContain('.file-preview-window');
    expect(styles).toContain('.desktop-shell--file-preview-window');
    expect(sharedApi).toContain("modsStartNifPreview: 'fluxora:mods:start-nif-preview'");
    expect(sharedApi).toContain("modsReadNifPreviewAssetBytes: 'fluxora:mods:read-nif-preview-asset-bytes'");
    expect(sharedApi).not.toContain('modsReadPreviewAsset');
    expect(sharedApi).not.toContain('contentBase64');
    expect(sharedApi).toContain("windowOpenFilePreview: 'fluxora:window:open-file-preview'");
    expect(facade).toContain("invoke('fluxora_open_file_preview_window'");
    expect(facade).toContain("'fluxora_start_nif_preview'");
    expect(facade).toContain("'fluxora_read_nif_preview_asset_bytes'");
    expect(facade).not.toContain('mods.readPreviewAsset');
    expect(rustShell).toContain('FILE_PREVIEW_WINDOW_LABEL_PREFIX');
    expect(rustShell).toContain('fluxora_open_file_preview_window');
    expect(rustShell).toContain('/?window=file-preview');
    expect(rustShell).toContain('&directory={}');
    expect(rustShell).toContain('.inner_size(1344.0, 912.0)');
    expect(rustShell).toContain('.min_inner_size(1080.0, 720.0)');
    expect(capabilities).toContain('"file-preview:*"');
    expect(packageJson).toContain('"three": "^0.185.1"');
    expect(iconsReadme).toContain('cuboid.svg');
    expect(cuboid).toContain('<svg');
  });
});
