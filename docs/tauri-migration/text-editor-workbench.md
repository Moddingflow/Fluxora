# Fluxora text editor workbench

Дата решения: 2026-07-14

Статус: встроенный text/code editor переведён с textarea-диалога на Monaco-based workbench. Документ фиксирует выполненный VS Code parity slice, архитектурные границы и функции, для которых ещё нужен отдельный native/core contract.

## Цель и референс

Visual Studio Code выбран как референс не по внешнему сходству, а по модели рабочего процесса: пользователь должен открывать несколько файлов, безопасно переключаться между ними, редактировать с полноценными code-editor affordances, быстро находить команды и текст, видеть диагностику и всегда понимать состояние текущего документа.

Основные источники:

- [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface)
- [VS Code basic editing](https://code.visualstudio.com/docs/editing/codebasics)
- [VS Code code navigation](https://code.visualstudio.com/docs/editing/editingevolved)
- [VS Code IntelliSense](https://code.visualstudio.com/docs/editing/intellisense)
- [VS Code default keyboard shortcuts](https://code.visualstudio.com/docs/reference/default-keybindings)
- [VS Code extension capability overview](https://code.visualstudio.com/api/extension-capabilities/overview)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)

## Анализ VS Code и принятая граница

| Область VS Code | Что важно пользователю | Fluxora 2026-07-13 | Граница |
| --- | --- | --- | --- |
| Workbench shell | Menu bar, activity bar, primary sidebar, editor group, panel, status bar | Реализовано в отдельном editor window | Renderer-only layout |
| Documents and tabs | Несколько открытых документов, активная вкладка, dirty state, close guards | Реализовано; вкладки сохраняют собственные Monaco model/view state и undo stack | Файлы читаются/сохраняются только через typed facade |
| Core editing | Syntax highlighting, line numbers, folding, selections, multicursor, brackets, comments, format/find/replace | Реализовано через Monaco и command routing | Возможность зависит от Monaco language contribution |
| Navigation | Breadcrumbs, go to line, next problem, quick file switch | Реализовано для открытых документов и текущего mod tree | Symbol navigation требует language service/LSP |
| Explorer | Контекст файлов и lazy directory expansion | Реализовано поверх существующего `mods.getFileTree` | Нет renderer filesystem access |
| Search | Быстрый поиск, case/whole-word/regex, переход к совпадению | Реализовано по открытым документам и честно так подписано | Workspace-wide content search требует индексирующего C++ API |
| Problems | Ошибки и предупреждения с переходом к позиции | Реализовано из Monaco markers | Внешние compiler/LSP diagnostics пока не подключены |
| Command palette | Единая discoverable точка команд | Реализовано; `Ctrl+Shift+P` | Только реально поддержанные Fluxora/Monaco команды |
| Status bar | Cursor, indentation, encoding, EOL, language, size, problems | Реализовано | Encoding пока UTF-8, что соответствует core text contract |
| Language intelligence | Completion, hover, validation, formatting | Monaco services активны для JSON, JavaScript, TypeScript, CSS и HTML; базовая подсветка доступна шире | Полный IntelliSense для C++, Papyrus и сторонних языков требует LSP/worker host |
| Terminal, SCM, debugger | Процессы, Git model, debug adapter lifecycle | Не имитируются | Нужны allowlisted shell/core contracts, capability DTOs, logging и security review |
| Extensions | Marketplace и extension host | Не имитируется | Это отдельная sandbox/runtime platform, а не renderer feature |

Ключевое решение: текущий workbench является полноценным локальным редактором файлов, а не копией всей VS Code application platform. Terminal/Git/debugger/extension buttons без работающего и безопасного backend были бы ложным parity.

## Реализованный интерфейс

Editor window состоит из:

1. Нативного Fluxora titlebar с guarded close.
2. Menu bar `File`, `Edit`, `Selection`, `View`, `Go`.
3. Компактного toolbar для Open, Save, Command Palette и Problems.
4. Activity bar с Explorer, Search и Problems.
5. Primary sidebar с Open Editors, lazy mod tree или поиском по открытым редакторам.
6. Tab strip и breadcrumbs.
7. Monaco editor surface с отдельной model/view state на вкладку.
8. Problems panel.
9. Status bar.
10. Quick input overlay для Command Palette, Go to File и Language Mode.

Layout остаётся плотным и плоским: без dashboard cards, декоративных gradients и ненужных контейнеров. Акцентный цвет используется для focus, selection и active-state сигналов.

## Документная модель и сохранение

Каждая вкладка хранит:

- стабильный id по opaque path без renderer-side case folding;
- source (`mod` или standalone file);
- полный path и, для mod file, relative path;
- file name, content и `savedContent` baseline;
- Monaco language id и display label;
- loading/ready/error state;
- размер и operation error.

Dirty state вычисляется сравнением `content` и `savedContent`, а не отдельным хрупким boolean. Сохранение отправляет immutable snapshot. Если пользователь продолжил печатать во время async save, результат отмечает сохранённым только отправленный snapshot и не теряет более новые изменения.

`Ctrl+S` зарегистрирован как команда самого Monaco и поэтому одинаково работает при фокусе внутри editor textarea и на оболочке workbench. Повторное сохранение уже чистого документа разрешено и снова отправляет текущий snapshot; состояние `saving/idle` не переподключает Monaco model и не восстанавливает поверх актуального caret устаревший view state.

Close tab, Close All, browser/webview unload и Fluxora titlebar Close защищены Save / Don't Save / Cancel flow. Save All обрабатывает все dirty tabs. Save As заменяет identity текущей вкладки новым выбранным path и не оставляет скрытый duplicate.

## Команды и keyboard contract

| Shortcut | Команда |
| --- | --- |
| `Ctrl+O` | Open File |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+Alt+S` | Save All |
| `Ctrl+W` | Close Editor |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+P` | Go to File among open editors |
| `Ctrl+Shift+F` | Search Open Editors |
| `Ctrl+B` | Toggle Explorer |
| `Ctrl+J` | Toggle Problems |
| `Ctrl+G` | Go to Line |
| `Ctrl+Tab` | Next Editor |
| `Alt+Z` | Toggle Word Wrap |
| `F8` | Next Problem |

Undo/redo, find/replace, select all, multicursor, line move/copy, comments and document formatting route to Monaco actions. Menu items expose shortcuts and check state where applicable.

Нативные word-editing команды Monaco, включая `Ctrl+Delete`, не переопределяются renderer-оболочкой. В EOF команда остаётся no-op, а смена save state не переносит caret на последнюю строку. Smooth caret/scroll animations отключены, чтобы быстрые последовательности навигации и удаления отражались сразу и не выглядели как повторный jump.

## Language handling

Filename/extension mapping is renderer metadata only. It does not read the filesystem or decide domain behavior. Current mapping covers common configuration, script and source formats including JSON/JSONC, INI/TOML/YAML/XML, Markdown, JavaScript/TypeScript, HTML/CSS, C/C++, C#, Java, Python, Rust, PowerShell, shell, SQL, Lua and Papyrus.

Papyrus has a Fluxora tokenizer and language configuration for comments, brackets, auto-closing pairs and folding behavior. Rich semantic Papyrus intelligence remains a future language-service feature.

## Architecture and security

- `TextEditorWindow.tsx` owns the lightweight secondary-window bootstrap and reads `projectDirectory` directly from the allowlisted window URL.
- `TextEditorWorkspace.tsx` owns document orchestration and workbench composition.
- `MonacoEditorSurface.tsx` owns Monaco lifecycle, models, view states, markers and editor commands.
- `text-editor-model.ts` owns pure filename/language/document/search/tree helpers.
- `TextEditorSidebar.tsx`, `TextEditorMenuBar.tsx` and `TextEditorQuickInput.tsx` own focused UI surfaces.
- `monaco-environment.ts` maps local Vite worker bundles. No worker or language asset is loaded from a CDN.
- `text-editor-workbench.css` is feature-scoped and imported by the global CSS entrypoint.

Renderer does not receive Node.js, raw filesystem, shell, native module or scattered Tauri invoke access. It reuses:

- `window.fluxora.mods.getFileTree/readTextFile/saveTextFile` for mod files;
- `window.fluxora.dialogs.pickTextFile/saveTextFile` for native selection;
- `window.fluxora.textFiles.read/save` for standalone files;
- existing operation ids and native/core atomic UTF-8 save behavior.

No bridge contract or C++ business logic was duplicated for this feature.

## Performance

- `main.tsx` routes `window=text-editor` to a dedicated lazy entrypoint without importing or executing the monolithic main `App.tsx` startup path.
- The native `openTextEditor` contract passes both opaque `configPath` and the already-known `projectDirectory`, so the initial mod file does not wait for Nexus status or project-catalog discovery.
- Monaco is loaded with `React.lazy` only inside the secondary text-editor window and preloaded in parallel with the initial native file read.
- Latency-sensitive editor reads (`mods.getFileTree`, `mods.readTextFile` and `textFiles.read`) use the interactive bridge lane, so a background workspace refresh cannot hold file opening behind the serialized main queue. Save calls remain on the main lane.
- Editor/JSON/CSS/HTML/TypeScript workers are local separate build assets and start only when needed.
- The main Fluxora shell does not import the Monaco runtime into its startup chunk.
- Mod directories load incrementally through the existing lazy tree API.
- Search scans only open in-memory documents and does no disk fanout.
- Closed tabs dispose Monaco models; active tab changes preserve view state instead of rebuilding document history.

The production build records a dedicated Monaco surface chunk. Its size is accepted for the secondary IDE surface; it must not be folded into the main startup chunk.

## Validation contract

- Pure unit tests cover filename/language mapping, tab identity/dirty baselines, line-ending detection, regex/case/whole-word search and lazy tree flattening.
- Renderer source guards cover the Monaco dependency, workbench composition, facade routes and absence of old textarea/`execCommand` behavior.
- Playwright opens a real editor route against the typed facade mock while the generic Nexus startup is deliberately delayed, expands the mod tree, exercises Command Palette, verifies stable EOF plus `Ctrl+Delete`, repeats `Ctrl+S` while Monaco owns focus, edits content, verifies dirty-close protection, saves through `mods.saveTextFile`, searches open editors and captures the final workbench screenshot.
- Full renderer typecheck/build and root `Build.ps1` remain mandatory release checks.

## Legal and privacy

Monaco Editor 0.55.1 is an MIT dependency. English, German and Russian bundled third-party notices include the Microsoft copyright and MIT license text.

The editor is local-only, sends no telemetry and adds no upload or online service. It does not change which user file data Fluxora stores or transfers, so privacy policy and terms do not require a behavior change. The existing final owner/legal review gate still applies before public distribution.

## Next safe expansion stages

These are deliberately separate features, in priority order:

1. C++ workspace content-index/search API with cancellation, limits and operation logging.
2. Typed language-service host for Papyrus and selected source languages, with bounded workers/processes and diagnostics DTOs.
3. Diff editor and conflict comparison using existing mod-owner/conflict evidence.
4. Workspace edit/rename contract with preview and atomic multi-file rollback.
5. Git status/diff/commit support only after a typed core service and credential/security review.
6. Integrated terminal only after an explicit allowlist, working-directory policy, process lifecycle contract and audit logging.
7. Debug adapter and extensions only as separately designed sandboxed platforms.

None of these future stages should add decorative controls before the underlying safe capability exists.
