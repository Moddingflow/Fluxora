---
name: stitch-design-taste
description: Creates and maintains premium ultra-minimal product design systems for Stitch and implementation agents, with strict asset reuse, service boundaries, accessibility, and AI-slop rejection.
---

# Stitch Design Taste — Premium Ultra-Minimal Product UI

## Purpose

Use this skill to create or update an agent-readable `DESIGN.md` for product UI. The result must guide both visual generation in Google Stitch and real implementation without drifting into generic AI aesthetics.

The design system is not a mood board and not a clean-slate template. It is a durable contract between the current product, its existing assets and components, generated concepts, and implementation agents.

For Fluxora, `.agents/skills/stitch-design-taste/DESIGN.md` is the normative design source of truth.

## Core Doctrine

- Premium comes from precision, restraint, consistency, speed, and complete state handling.
- Ultra-minimal means fewer purposeful elements, not missing labels, weak hierarchy, or hidden state.
- Product UI should make work dominant and chrome quiet.
- Familiar interaction patterns are preferred over novelty.
- Existing assets, tokens, primitives, components, and services are reused before new ones are created.
- Every non-trivial workflow has focused service ownership; visual components do not absorb business logic.
- AI slop is removed at the concept stage, not polished after implementation.

Default profile for desktop product software:

| Dial | Default | Interpretation |
|---|---:|---|
| Restraint | `10/10` | Every visible element must justify itself. |
| Functional density | `7/10` | Compact and efficient, never cramped. |
| Visual variance | `2/10` | Stable patterns; asymmetry only when useful. |
| Motion | `2/10` | Static by default; short functional transitions. |
| Decoration | `0/10` | No ornamental effects or visual filler. |

Change these values only when the actual product context requires it. Do not increase creativity, variance, or motion merely to make generated output look distinctive.

## Required Workflow

### 1. Understand the Real Product

Identify:

- The product type and supported platforms.
- The primary user and their recurring tasks.
- The actual information density and operational states.
- Existing visual language and accessibility requirements.
- Whether the target is a desktop workbench, mobile app, web product, installer, or marketing surface.

Do not apply marketing-site patterns to an operational desktop product.

### 2. Inventory Before Inventing

Before proposing visuals, inspect the scoped repository sources for:

- Brand marks, logos, integration assets, imagery, and fonts.
- Color, typography, spacing, radius, shadow, and motion tokens.
- Shared buttons, inputs, selects, tabs, menus, dialogs, cards, badges, tables, trees, feedback, loading, and empty-state primitives.
- Existing focused feature components and interaction patterns.
- Renderer services, stores/hooks, typed bridge contracts, and core service boundaries.

Record the reuse order in `DESIGN.md`. A new asset or component requires a concrete gap; “a fresh look” is not a gap.

Reuse is semantic. Extend or compose a suitable shared primitive, but do not force it into an inaccessible or incorrect role.

For Fluxora game-template selectors, every new bundled game definition must add one local background under `frontend-tauri/src/renderer/assets/background/`. The agent must locate recognizable artwork with verified redistribution/provenance, record its source, crop it to exactly `960x320`, compress it to WebP at no more than `96 KiB`, and update the local manifest/test. Remote runtime artwork and oversized source payloads are forbidden; use locally owned symbolic artwork when rights are unclear.

### 3. Define Hierarchy Before Styling

For each screen, establish:

1. The single primary user task.
2. The object currently in focus.
3. The main action for the current decision.
4. Supporting information and secondary actions.
5. Loading, empty, error, disabled, selected, busy, offline, permission, success, and destructive states.

If the hierarchy cannot be described simply, do not add decorative structure. Simplify the workflow first.

### 4. Derive a Restrained Visual Foundation

Prefer existing tokens. When a project has no mature token system, define:

- One neutral surface ramp with clear functional roles.
- One restrained brand accent.
- Separate semantic state colors only where meaning requires them.
- One product sans family and one mono family when code or aligned data needs it.
- A compact spacing scale, limited radii, one-pixel structure, and shadows reserved for overlays.

Do not use color, radius, shadow, or typography as decoration. Every token must have a named product role.

### 5. Specify Product Components and States

Describe components semantically: role, hierarchy, size, surface, interaction, state, accessibility, and reuse source.

Required guidance should cover the applicable set of:

- Buttons and icon actions.
- Forms and validation.
- Lists, tables, trees, tabs, and navigation.
- Cards, badges, and status.
- Menus, popovers, and dialogs.
- Loading, progress, empty, error, success, and recovery states.
- Keyboard, focus, screen-reader, contrast, reduced-motion, resizing, localization, and long-content behavior.

Avoid arbitrary implementation values when a repository token already exists. Name the source instead.

### 6. Keep Motion Functional

Static is the default.

- Use short transitions only to explain interaction, continuity, progress, or spatial change.
- Prefer existing motion tokens and `opacity`/`transform`.
- Respect `prefers-reduced-motion`.
- Do not require spring physics, cinematic choreography, staggered mounting, or perpetual animation.
- Loading animation is allowed only while real work is happening.

### 7. Preserve Service Boundaries

The design contract must describe implementation ownership when the UI is stateful:

- Focused components own rendering and local interaction only.
- Renderer services and stores/hooks own view orchestration and typed UI state.
- Native shell/facade owns lifecycle and safe native capabilities.
- Core services own domain and filesystem behavior.
- Shared behavior has one owner; avoid master components, catch-all managers, and duplicated one-off services.

Do not create a visually refined mock that bypasses the real operational path.

### 8. Run the Anti-Slop Reduction Pass

Review every proposed element and remove it unless it provides information, navigation, control, feedback, accessibility, or necessary brand identity.

Then reject any pattern in the banned list below. Do not merely change its color or radius.

### 9. Synchronize the Sources of Truth

When a UI change alters the design language, reusable assets, tokens, component contract, motion, layout, accessibility baseline, or architecture:

- Update `DESIGN.md` automatically in the same change.
- Update this skill if its generation rules are affected.
- Update applicable token, component, architecture, validation, and agent-rule documentation.
- Keep generated guidance and implementation consistent; do not wait for a separate user request.

## Semantic Design Rules

### Atmosphere

Use precise product terms such as “quiet desktop workbench”, “compact operational UI”, “restrained hierarchy”, and “explicit state”. Avoid cinematic or aspirational prose that encourages decorative output.

### Color

- One neutral family and one accent.
- Accent is a scarce signal for primary action, focus, selection, and meaningful progress.
- Flat surfaces and one-pixel borders before shadows.
- No gradients, neon, glow, glassmorphism, or mixed warm/cool gray ramps.

### Typography

- Use existing licensed/local fonts first.
- Keep product hierarchy compact and weight-driven.
- Large display type is reserved for contexts that genuinely need it; workbenches usually do not.
- Use mono only for code, paths, identifiers, logs, timestamps, or aligned numbers.
- Never add a font solely to make one feature feel different.

### Layout

- Choose layouts from the task: workbench panes, master-detail, rows, tables, trees, inspectors, toolbars, forms, or dialogs.
- Prefer dividers and spacing to card collections.
- One primary action per decision surface.
- Progressive disclosure for rare or advanced controls.
- Stable alignment and predictable placement over forced asymmetry.

### Components

- Reuse the project’s existing primitives and interaction patterns.
- Cards communicate a real boundary; they are not default wrappers.
- Badges communicate short categorical metadata; they are not decorative labels.
- Icon-only actions need accessible names and discoverable meaning.
- Status must not rely on color alone.
- Empty and error states provide one useful recovery path.

### Content

- Use direct domain language and real product nouns.
- No promotional copy, vague AI phrasing, fake metrics, testimonials, or invented activity.
- Avoid redundant eyebrow/title/subtitle/helper stacks.
- Account for localization and long strings.

## Banned AI-Slop Patterns

Encode these as explicit rejection rules in the generated `DESIGN.md` where applicable:

- Purple/blue AI gradients, neon, outer glow, glassmorphism, blurred blobs, grain, star fields, and decorative grids.
- Gradient headlines, oversized marketing typography, slogan heroes, and landing-page CTAs inside product UI.
- Sparkle icons, robot mascots, magic buttons, emoji, generated avatars, random illustrations, and remote stock imagery.
- Bento layouts, equal feature-card rows, nested cards, floating islands, and card wrappers around every section.
- Excessive rounding, pill controls everywhere, decorative badges, and color-coded chrome without meaning.
- Generic dashboard metric cards, fake charts, fake percentages, testimonials, and fabricated activity feeds.
- Ambiguous icon-only navigation, hidden labels, weak contrast, tiny targets, and color-only status.
- Repeated filler copy and clichés such as “Elevate”, “Unleash”, “Seamless”, “Next-gen”, or “Revolutionize”.
- Perpetual animation, pulse without urgency, typewriter effects, floating icons, cascade reveals, bounce, parallax, and animated gradients.
- Skeletons, spinners, and progress visuals when no real work is happening.
- Custom components, icons, or assets that duplicate an existing suitable source.
- Visual-only flows that omit real loading, empty, error, permission, offline, disabled, destructive, and recovery behavior.
- God components, catch-all managers, or UI code that owns domain and filesystem decisions.

## `DESIGN.md` Output Contract

Use the smallest structure that fully captures the product. For Fluxora and similar operational software, include:

```markdown
# [Product] Product Interface Standard

**Status:** Normative design source of truth
**Applies to:** [surfaces]

## 1. Direction
- Premium and ultra-minimal definition
- Restraint, density, variance, motion, and decoration profile
- Non-negotiable outcomes

## 2. Existing Sources and Reuse Order
- Token, asset, icon, primitive, component, and service sources
- Rules for extending versus creating

## 3. Visual Foundation
- Functional color roles
- Typography
- Spacing, radii, borders, depth

## 4. Information Architecture and Layout
- Task hierarchy
- Product-specific layout patterns
- Primary/secondary action rules

## 5. Component Behavior
- Applicable controls and all operational states

## 6. Motion and Feedback
- Static default, functional transitions, reduced motion

## 7. Product Copy
- Domain language, localization, banned filler

## 8. Accessibility and Window Behavior
- Keyboard, semantics, contrast, focus, resize, zoom/scaling

## 9. Service and Component Architecture
- Focused ownership across components, renderer, native shell, and core

## 10. AI-Slop Rejection Rules
- Explicit project-relevant bans

## 11. Agent Workflow and Documentation Sync
- Inspect, reuse, implement, reduce, synchronize

## 12. Acceptance Gate
- Binary completion checklist
```

Do not add generic sections that do not apply. Do not omit operational states, reuse rules, accessibility, or the rejection gate.

## Quality Gate

Before delivering a `DESIGN.md`, confirm:

- It describes the actual product rather than a generic template.
- It makes premium synonymous with precision, not effects.
- It makes ultra-minimal compatible with clear labels and complete state.
- It names existing reuse sources and prevents duplication.
- It defines one accent and a restrained surface hierarchy.
- It rejects cards-everywhere, marketing heroes, AI decoration, and perpetual motion.
- It covers accessibility, localization, resizing, and edge states.
- It preserves service ownership and the real implementation path.
- It requires documentation to stay synchronized with design changes.

If any item fails, revise the document before handing it to Stitch or an implementation agent.
