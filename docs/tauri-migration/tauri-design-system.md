# Fluxora Tauri design system

Дата обновления: 2026-06-25

Статус: Phase 13 foundation complete for `frontend-tauri/`; redesign Phase 2 moved the renderer foundation tokens into `frontend-tauri/src/renderer/design-system/tokens/foundations.css` while keeping `styles.css` as the public CSS entrypoint. Redesign Phase 3 added typed renderer primitives under `frontend-tauri/src/renderer/design-system/primitives/` and the local icon wrapper under `frontend-tauri/src/renderer/design-system/icons/`.

## Product read

Fluxora is a dense desktop workbench for builds, mods, plugins, downloads, installs and transfer operations. The UI should feel calm, fast and native-adjacent: compact rows, clear hierarchy, restrained motion, strong focus states and no landing-page composition inside working screens.

## Theme tokens

The renderer keeps the public design-system CSS entrypoint in `frontend-tauri/src/renderer/styles.css`. That file imports the implementation token entrypoint from `frontend-tauri/src/renderer/design-system/tokens/foundations.css`.

During the redesign migration, `frontend-tauri/src/renderer/design-system/` holds token implementation files, typed React primitives, icon wrappers and local asset exports. `styles.css` remains the compatibility/import boundary for global styles and semantic aliases unless this document is updated in the same change.

Core tokens:

- `--bg`, `--chrome`, `--surface`, `--surface-strong`, `--surface-soft`
- `--line`, `--line-soft`
- `--text`, `--muted`, `--subtle`
- `--accent`, `--accent-info`, `--warning`, `--danger`, `--danger-soft`
- `--focus-ring`, `--row-hover`
- `--radius-xs`, `--radius-sm`, `--radius-md`, plus redesign control/panel radii in the `8/9/10/12px` language
- `--shadow-panel`, `--shadow-popup`, `--shadow-menu`
- `--ease-standard`, `--motion-fast`, `--motion-medium`

Rules:

- The current product ships a single dark theme backed by semantic tokens. Components must not hardcode palettes; future themes should extend the token layer instead of adding component-specific color branches.
- Use one primary accent for action and selection: Fluxora gold. Informational/progress styling should reuse gold or neutral state treatments unless a future token adds an explicit non-brand status color.
- Typography prefers IBM Plex Sans/Mono when installed or later bundled as approved local `.woff2` files, then falls back to Windows/system-safe UI fonts with tabular numerals for dense data. Do not add remote fonts to the Tauri renderer.
- Keep radii tight and consistent with the redesign tokens: 8px for chips/buttons, 9px for inputs, 10px for inner panels and 12px for cards/dialog panels. Cards inside cards are not part of the workbench language.

Renderer assets are local bundle assets under `frontend-tauri/src/renderer/assets/`: brand files in `brand/`, content imagery in `images/` and redesign SVG glyphs in `icons/`. Runtime UI must not depend on remote images, icon CDNs or remote font CSS.

## Component contract

Typed primitive entrypoints:

- `frontend-tauri/src/renderer/design-system/primitives/index.ts` exports `Button`, `IconButton`, `Input`, `Select`, `Switch`, `Checkbox`, `Card`, `Badge`, `StatusDot`, `SectionLabel`, `Tabs`, `NavItem`, `ProgressBar`, `EmptyState`, `FacetSpinner` and `LoadingSplash`.
- `frontend-tauri/src/renderer/design-system/icons/index.ts` exports the local `Icon` wrapper. Icons render on a 24x24 canvas and stroke with `currentColor`.
- `frontend-tauri/src/renderer/design-system/PrimitivePreview.tsx` is a dev-only preview surface available from the app at `#design-system`. It must not call bridge APIs or own business state.
- Product code must not use `window.FluxoraDesignSystem_c83a40` or any other prototype global namespace.

Buttons:

- `.primary-button` for the single primary action in a local toolbar/dialog.
- `.tool-button` for labeled secondary commands.
- `.icon-button` for compact table, tree, titlebar and toolbar actions. Icon-only buttons require `title` or an accessible label.
- New primitive buttons use `Button` and `IconButton` with `.flx-button` / `.flx-icon-button`; `IconButton` requires a `label` prop and mirrors it to `title` by default.

Inputs and selectors:

- Text fields use the shared `input` rules, visible focus ring and no raw browser default styling.
- Multi-option mode controls use `.segmented-control` or `.segmented-grid`, not ad-hoc text buttons.

Surfaces:

- `.work-surface` and `.inspector` are the canonical workspace panels.
- `.surface-header` owns title, short status and local toolbar commands.
- `.activity-banner`, `.bridge-banner`, `.settings-note`, `.mod-busy-strip` are contextual status surfaces. Avoid toast-only reporting for persistent state.

Tables and trees:

- Mods, plugins and downloads use `.mod-table`, `.mod-table__body`, `.mod-row` plus domain-specific row classes.
- Large tables must render through `createVirtualWindow`.
- File tree rows and archive tree rows use `content-visibility` and stable intrinsic row sizes.
- Archive placement details render only a virtualized row window, even when the C++ core returns a large preview.

Dialogs and overlays:

- `.install-dialog` and `.operation-overlay__panel` are the canonical modal surfaces.
- Long-running operations use status text plus progress where available. Indeterminate progress is allowed only when the C++ API cannot report progress yet.

Empty/loading/error:

- Use `.empty-state` and `.center-empty` for composed empty/loading/error states.
- Loading states should name the domain and show the selected project/path when useful.
- Error states use direct copy and `role="alert"` when the message requires attention.

## Accessibility gate

Required for new Tauri UI surfaces:

- All icon-only buttons have a `title` or accessible label.
- Keyboard users can reach row selection, context menus and tree controls.
- Focus is visible through the shared `--focus-ring` rules.
- Important state surfaces use `role="status"` or `role="alert"`.
- Motion has a `prefers-reduced-motion: reduce` fallback.
- Text inside rows, panels, buttons and dialogs must truncate or wrap intentionally and must not overlap at 1280x720.

## Visual review sizes

Every major Tauri screen should be reviewed at:

- 1280x720
- 1440x900
- 1920x1080
- 2560x1080 ultrawide

The Phase 13 Playwright smoke captures screenshots for these sizes and checks that the shell remains visible, responsive and without obvious viewport overflow.
