# Fluxora Product Interface Standard

**Status:** Normative design source of truth

**Applies to:** Fluxora Tauri product UI, product-facing installer UI, generated screen concepts, and implementation handoff

**Skill:** `stitch-design-taste`

This document defines a premium, ultra-minimal desktop product interface. It replaces the previous expressive marketing aesthetic. When a local implementation and this document disagree, resolve the mismatch in the same change instead of silently creating a second visual language.

## 1. Direction

Premium is precision, restraint, speed, and consistency. It is not decoration.

Ultra-minimal means that every visible element has a current task. It does not mean hiding essential state, reducing legibility, or replacing clear labels with mystery icons.

Fluxora should feel like a modern coding tool: calm, compact, direct, and trustworthy. The work is the visual focus. Chrome remains quiet. State changes are explicit. The interface must never resemble a SaaS landing page, a template dashboard, a game launcher, or an AI-generated concept shot.

| Quality | Target | Meaning |
|---|---:|---|
| Restraint | `10/10` | Remove anything that does not improve comprehension or control. |
| Functional density | `7/10` | Compact desktop workflow without crowding. |
| Visual variance | `2/10` | Stable patterns and alignment; asymmetry only when the task requires it. |
| Motion | `2/10` | Short state transitions only; static by default. |
| Decoration | `0/10` | No visual filler, ornamental effects, or trend-driven treatment. |

Non-negotiable outcomes:

- One obvious primary task per view or dialog.
- One visual language across catalog, workspace, settings, installer, operations, and AI surfaces.
- Existing assets, tokens, icons, primitives, components, and interaction patterns are reused before anything new is created.
- Every loading, empty, error, disabled, selected, busy, offline, permission, and success state is intentionally designed.
- No screen ships with recognizable AI slop.

## 2. Existing Sources and Reuse Order

Do not treat a new screen as a blank canvas. Inspect the current product first.

Use these sources in this order:

1. Tokens in `frontend-tauri/src/renderer/design-system/tokens/foundations.css`.
2. Primitives exported by `frontend-tauri/src/renderer/design-system/primitives/`.
3. Icons from `frontend-tauri/src/renderer/design-system/icons/`.
4. Brand and integration assets exported by `frontend-tauri/src/renderer/design-system/assets.ts`.
5. Existing focused components, feature components, services, stores, and hooks with matching semantics.
6. A small extension to an existing shared primitive when the need is genuinely reusable.
7. A new component or asset only when no suitable implementation exists.

Current reusable primitives include `Button`, `IconButton`, `Input`, `Select`, `CustomSelect`, `Switch`, `Checkbox`, `Tabs`, `NavItem`, `WizardStepper`, `Badge`, `Card`, `SectionLabel`, `StatusDot`, `ProgressBar`, `Skeleton`, `FacetSpinner`, `LoadingSplash`, and `EmptyState`.

Rules:

- Do not redraw the Fluxora mark, partner logos, game icons, or an existing UI icon.
- Do not add a second button, select, tab, badge, card, progress, loading, or empty-state system.
- Do not copy a component and restyle the copy. Extend the shared primitive or compose it.
- Do not introduce remote stock imagery, random illustration packs, emoji, or generated decorative art into product UI.
- New assets must have a clear product purpose, local ownership, appropriate licensing/provenance, and a central export when reused.
- Bundled game definitions require a matching selector background in `frontend-tauri/src/renderer/assets/background/`: locate recognizable redistribution-safe artwork, record provenance, crop to exactly `960x320`, compress to WebP at no more than `96 KiB`, and register the game ID in the local manifest and coverage. Never fetch these backgrounds at runtime or retain an oversized source payload in the product bundle.
- Reuse is semantic, not blind: do not force an existing element into a role it cannot perform accessibly or correctly.

## 3. Visual Foundation

### Color

Fluxora uses one dark neutral system and one restrained gold accent. Use the existing variables rather than duplicating hex values in feature CSS.

| Role | Token | Reference value | Use |
|---|---|---:|---|
| App canvas | `--flx-bg-1` | `#090C11` | Main workbench background. |
| Deep canvas | `--flx-bg-0` | `#05070A` | Recessed or edge regions only. |
| Soft panel | `--flx-panel-soft` | `#0B0E14` | Chrome, inset areas, secondary panes. |
| Panel | `--flx-panel` | `#10141A` | Primary contained surface. |
| Raised panel | `--flx-panel-raised` | `#161A23` | Menus, dialogs, selected raised regions. |
| Hover surface | `--flx-panel-hover` | `#1D212B` | Temporary hover/pressed feedback. |
| Primary text | `--flx-text` | `#F5F0E6` | Titles and important values. |
| Secondary text | `--flx-text-secondary` | `#CEC8BA` | Labels and readable body copy. |
| Muted text | `--flx-text-muted` | `#948D7E` | Metadata and low-emphasis context. |
| Structural line | `--flx-line` | `#20252E` | One-pixel separation. |
| Accent | `--flx-accent` | `#EDB848` | Primary action, selection, focus, active progress. |
| Accent hover | `--flx-accent-hover` | `#F8CA62` | Direct interaction feedback only. |

Accent discipline:

- Gold is a signal, not a theme fill. Most screens should remain overwhelmingly neutral.
- Use accent for the current primary action, active selection, focus, or meaningful progress.
- Do not color every icon, heading, border, badge, and scrollbar simultaneously.
- Semantic conflict colors are reserved for real mod-conflict meaning; they are not decorative alternatives.
- Never introduce a second brand accent for variety.

Surface discipline:

- Prefer a flat canvas plus one-pixel lines. Use surface changes only to communicate containment or interaction.
- Keep at most three perceptible depth levels in one view: canvas, panel, overlay.
- Shadows are reserved for overlays that must separate from content, such as menus and dialogs.
- No gradients, glassmorphism, frosted panes, colored shadows, bloom, neon, or ambient glow.
- Never use pure black or pure white as large surfaces.

### Typography

- Use the bundled `Geist` family for product UI and `IBM Plex Mono` for code, paths, logs, identifiers, timestamps, and aligned numeric data.
- Default UI copy is compact: `11–13px`; important labels and body text are `12–15px`; view titles are normally `18–22px`.
- Large type is exceptional. A desktop workbench does not need landing-page headlines.
- Use weight `400–600` for nearly all UI. Reserve `700` for rare, short emphasis.
- Use sentence case. Avoid all-caps except brief established technical labels.
- Prefer hierarchy through placement, weight, and tone before increasing size.
- Keep labels explicit and short. Do not sacrifice clarity to sound stylish.
- Do not introduce another font family for a feature.

### Spacing and shape

- Use the existing `4px` spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 48`.
- Default component gaps are `4–8px`; group gaps are `12–16px`; major pane separation is `20–32px` only when needed.
- Controls use the existing compact heights (`28–36px`). Increase the interaction area where accessibility requires it without making the visual control bulky.
- Default radii are `4–10px`. Use `12px` only for a meaningful large container. Pill shapes are reserved for compact statuses, segmented choices, or truly circular controls.
- Do not make every container rounded. Connected workbench panes should usually meet at straight one-pixel boundaries.
- Alignment errors of one or two pixels are quality defects in dense product UI.

## 4. Information Architecture and Layout

Build a workbench, not a dashboard.

- Preserve a stable shell: titlebar, navigation, workspace, contextual pane, and status/operation regions where applicable.
- Make the active task visually dominant; supporting controls should recede.
- Use split panes, tables, trees, lists, inspectors, toolbars, and inline details when they match the workflow.
- Prefer rows and dividers over collections of floating cards.
- Keep toolbars short. Move uncommon actions into a contextual menu instead of exposing every option.
- Use progressive disclosure for advanced settings and destructive details.
- Place controls next to the object they affect. Avoid remote actions and ambiguous global buttons.
- Keep one primary action per local decision surface. Secondary actions must be visibly quieter.
- Empty space should separate responsibilities, not decorate the screen.
- Preserve user context during loading, refresh, navigation, and background operations.

Never default to:

- Marketing heroes, slogans, or oversized product names.
- Metric-card dashboards for ordinary product state.
- Bento grids, equal three-card rows, or card mosaics.
- A centered stack when the task naturally needs a workbench or master-detail layout.
- Nested cards inside cards.
- A new page when an existing pane, dialog, or inline state solves the task more directly.

## 5. Component Behavior

### Buttons and actions

- Use `Button` and `IconButton` before creating feature-specific controls.
- Primary buttons use the accent only for the main safe action in the current context.
- Secondary and ghost actions remain neutral. Destructive actions must be explicit and cannot borrow the premium accent.
- Icon-only actions require an accessible name and a discoverable tooltip where the meaning is not universal.
- Pressed feedback is subtle: a surface change or a maximum `scale(0.98)`. No bounce.
- Disabled actions remain legible and explain why when the reason is not obvious.

### Inputs and forms

- Keep labels visible. Placeholder text is an example, never the only label.
- Validate near the field and provide a concrete recovery instruction.
- Group related inputs with spacing and a restrained section label, not a decorative card.
- Preserve entered data after recoverable errors.
- Advanced settings are collapsed by default only when their current value remains visible and understandable.

### Multi-step workflows

- Use the shared vertical `WizardStepper`; do not introduce a feature-specific stepper language.
- A step is complete only after its required input has been explicitly provided and validated. Defaults and untouched future steps are not progress.
- Users may revisit reached valid steps, but future or dependency-blocked steps remain disabled and legible.
- Put the workflow in one semantic form: Enter invokes the current primary action, while validation prevents invalid advancement and returns a concrete inline recovery message.

### Lists, trees, tables, and tabs

- Rows are the default dense data container. Use consistent height, column alignment, hover, selected, focus, drag, disabled, and conflict states.
- Keep row actions contextual and reveal secondary controls on selection, hover, keyboard focus, or menu invocation.
- Use real headers where columns need interpretation. Do not fake tables with misaligned cards.
- Tabs switch peer contexts; they are not general-purpose buttons.
- Truncation must preserve access to the full value through tooltip, details, or copy action.

### Cards, badges, and status

- Use `Card` only when it communicates a real boundary, selection, or elevation. A heading plus divider is usually enough.
- Use `Badge` for short categorical metadata, not for every label.
- Status always combines shape/icon or text with color. Never rely on color alone.
- Status dots are static by default. Pulse only for a time-sensitive live event whose movement adds information.

### Loading, empty, and error states

- Prefer preserving the current layout and showing local progress over replacing the whole app.
- Use `ProgressBar` for measurable work and `Skeleton` only when the final geometry is known.
- Use `FacetSpinner` only for a compact, genuinely indeterminate inline operation.
- Loading animation exists only while work is happening and stops immediately afterward.
- Empty states are concise: what is absent, why it matters, and the single best next action. Illustration is not required.
- Errors state what failed, what remains safe, and what the user can do next. Never show a vague red banner as the entire recovery experience.
- Success should usually be a quiet state update, not a celebratory modal, animation, or toast storm.

### Dialogs and menus

- A dialog handles one decision. Keep its title factual, body brief, and actions predictable.
- Destructive confirmation names the affected object and consequence.
- Menus contain actions, not paragraphs or miniature dashboards.
- Popovers and menus close predictably on Escape, outside click, and completed action.

## 6. Motion and Feedback

The default interface is static.

- Use the existing `120–220ms` motion tokens for hover, focus, open/close, and state replacement.
- Animate only when it explains causality, continuity, progress, or spatial change.
- Prefer opacity and small transforms. Avoid layout animation when a direct update is clearer.
- No perpetual motion, breathing controls, floating icons, decorative shimmer, typewriter effects, bouncing, parallax, or cascade reveals.
- Do not animate routine list mounting or every state change.
- Respect `prefers-reduced-motion`; essential feedback must remain understandable with motion disabled.
- Motion must never delay input, obscure current state, or compete with work.

## 7. Product Copy

- Write direct, domain-specific language. Use the user’s terms for mods, plugins, builds, conflicts, downloads, profiles, and operations.
- Prefer a useful label over a clever phrase.
- Remove redundant eyebrow + title + subtitle stacks when one line is enough.
- Do not use promotional or AI copywriting clichés such as “Elevate”, “Unleash”, “Seamless”, “Next-gen”, “Revolutionary”, or “Supercharge”.
- Do not invent fake metrics, testimonials, activity, filenames, accounts, or success claims.
- Avoid generic placeholder names such as “John Doe”, “Acme”, “Nexus”, or “SmartFlow”.
- Localize meaning, not just words. Keep Russian, English, and German layouts resilient to text-length differences.

## 8. Accessibility and Window Behavior

- Keyboard access, visible focus, correct semantics, and screen-reader names are release requirements.
- Never encode meaning by color alone.
- Maintain readable contrast for text, icons, focus, selection, disabled controls, and semantic states.
- Preserve focus across local refreshes and return it logically after dialogs or menus close.
- Test compact desktop layouts at the supported minimum (`860x620`) and at common larger sizes; no control may become unreachable.
- Validate long Russian/German strings, 200% text zoom where supported, and Windows display scaling.
- Avoid horizontal scrolling for general settings or forms. Data grids may scroll only when the data model genuinely requires it.
- Keep native titlebar, resize, drag, context-menu, and platform behavior predictable.
- Forced-colors and reduced-motion modes must remain usable.

## 9. Service and Component Architecture

Visual quality depends on clear ownership.

- Every non-trivial workflow is split into focused renderer services, stores/hooks, and components.
- Components render a bounded responsibility. They do not own filesystem, bridge, install, download, catalog, account, or domain business logic.
- Renderer services may coordinate typed `window.fluxora` calls and shape view state only. Domain rules remain in focused C++ core services.
- Reuse an existing service boundary before adding one. If no boundary fits, create a small service with one main responsibility.
- Do not grow `App.tsx`, a route, dialog, panel, or “manager” into a catch-all orchestrator.
- Do not create one-off service copies for each screen. Shared behavior has one owner and a typed contract.
- New visual primitives remain presentation-only and cannot become hidden business-logic containers.

## 10. AI-Slop Rejection Rules

Reject the design immediately if any of these appear without a concrete product reason:

- Gradient text, neon accents, outer glow, glassmorphism, blurred color blobs, grain overlays, star fields, or decorative grids.
- Purple/blue “AI” styling, sparkle icons, robot mascots, “magic” buttons, or visual treatment that makes AI a decoration.
- Oversized headline typography, marketing heroes, slogan copy, or landing-page CTA composition inside the desktop app.
- A card around every group, excessive rounded containers, nested cards, floating islands, or pill-shaped controls everywhere.
- Generic bento layouts, equal feature-card rows, decorative charts, fake metrics, or made-up activity feeds.
- Unnecessary illustrations, stock photos, generated avatars, emoji, or random icon tiles.
- Repeated title/subtitle/helper patterns that add no information.
- Multiple equally loud primary actions or accent applied to ordinary chrome.
- Hidden labels, ambiguous icon-only actions, weak contrast, tiny targets, or state shown only by color.
- Spinners and skeletons used as decoration, fake waiting, or a substitute for real progress.
- Constant motion, staggered entrances, pulsing status, animated gradients, or hover effects on non-interactive content.
- Custom controls that duplicate an existing primitive, asset, icon, component, or interaction pattern.
- Beautiful mock states that omit loading, empty, error, permission, disabled, busy, offline, or destructive behavior.
- Implementation logic concentrated in a master component instead of focused services.

## 11. Agent Workflow and Documentation Sync

Before designing or implementing UI:

1. Read this document and inspect the existing screen in context.
2. Inventory relevant assets, icons, tokens, primitives, components, services, stores, and hooks.
3. State the primary user task and information hierarchy in one sentence.
4. Identify every required state and keyboard interaction.
5. Decide what will be reused, extended, or added. A new element needs a specific justification.

During implementation:

1. Build with tokens and shared primitives.
2. Keep orchestration in focused services/stores/hooks and rendering in focused components.
3. Make the real operational state visible; do not build a visual-only facade.
4. Validate the smallest supported window before adding visual refinement.

After implementation:

1. Run an anti-slop reduction pass: remove nonessential containers, labels, badges, effects, and actions.
2. Compare the result with this document and existing product surfaces.
3. Update this `DESIGN.md`, the governing design skill, tokens/component documentation, architecture notes, and other related sources automatically when the design language or reusable contract changed. Do this in the same change; do not wait for a separate request.
4. Verify that no suitable existing asset, component, or service was duplicated.

## 12. Acceptance Gate

A screen is not complete until every answer is “yes”:

- Is the primary task obvious within a few seconds?
- Does the interface feel like one compact desktop tool rather than a set of template cards?
- Does every visible element provide information, navigation, control, feedback, or necessary brand identity?
- Are tokens, assets, icons, primitives, components, and services reused where appropriate?
- Is there only one dominant action in each decision context?
- Are all operational and edge states explicit and recoverable?
- Is motion brief, functional, optional, and reduced-motion safe?
- Is the screen keyboard-accessible, readable, and usable at the minimum window size?
- Has every recognizable AI-slop pattern been removed rather than merely restyled?

If any answer is “no”, simplify or correct the design before calling it premium.
