---
name: fluxora-frontend-tauri-ui
description: Fluxora frontend-tauri UI quality workflow. Use when changing Fluxora product UI, renderer components, routes, windows, settings screens, dialogs, tables, trees, loading states, empty states, CSS, accessibility, or Playwright/Vitest UI tests in frontend-tauri. Enforces clear minimal user-facing UI and rejects AI slop interface patterns.
---

# Fluxora Frontend Tauri UI

## UI Standard

Build the actual usable Fluxora interface. Keep it clear, minimal, familiar, and consistent with the existing app. Do not add AI slop UI: decorative dashboards, fake marketing heroes, vague feature cards, needless gradients, random badges, ornamental panels, generic empty states, or explanatory text that exists because the interface is unclear.

## Start Of Task

1. Read `.agents/PROJECT_RULES.md`.
2. Use `graphify query "<frontend-tauri UI task>"` when `graphify-out/graph.json` exists.
3. Inspect the existing nearby UI, CSS, tests, and shell/window pattern before designing a new shape.
4. If the task depends on React, Tauri, Vitest, Playwright, CSS behavior, or another library/API, use Context7 docs first.

## Product Fit

- Fluxora is an operational desktop mod-management app. Prefer dense, calm, scan-friendly interfaces over promotional layouts.
- Preserve the existing shell, titlebar, settings/window routing, spacing, table/list patterns, and component language unless the task explicitly asks for redesign.
- Use the ordinary Settings-style shell for settings-like windows instead of inventing parallel settings UI.
- Loading states should mirror the final interface shape: table rows for tables, list rows for lists, panel skeletons for panels. Avoid centered spinners or empty-state placeholders when real layout skeletons are possible.
- Empty states should be short, specific, and action-oriented; do not explain the whole product.

## Minimalism Rules

- Keep only controls the user can act on now.
- Prefer direct labels, familiar controls, and predictable placement.
- Use icons for common commands when the icon is known and there is a tooltip or accessible label.
- Avoid nested cards, floating section cards, decorative blobs, ornamental gradients, random glass effects, and one-note palettes.
- Avoid text that describes features, visual design, keyboard shortcuts, or "how to use" basic UI unless the user genuinely needs guidance.
- Keep typography proportional to the surface: no hero-scale headings inside compact panels, sidebars, dialogs, tables, or toolbars.
- Ensure text fits buttons, cells, tabs, and cards on desktop and mobile-sized windows.
- Give fixed-format UI stable dimensions with grid tracks, min/max sizes, or aspect ratios so hover/loading/dynamic labels do not shift layout.

## Architecture Boundaries

- Keep renderer code focused on UI state, accessibility, presentation, and typed facade orchestration.
- Do not put C++ domain rules, filesystem decisions, installer behavior, archive semantics, profile logic, or mod-management business rules into React components or hooks.
- Do not use direct Node.js, filesystem, shell, native module, or scattered raw `Tauri invoke` from renderer. Use `window.fluxora`.
- Split UI work into focused components, renderer services, stores/hooks, and tests. Do not grow a master `App.tsx` or catch-all UI manager.

## Accessibility And Interaction

- Preserve keyboard navigation, focus states, labels, and disabled/busy/error states.
- Treat dialogs, popovers, menus, tabs, segmented controls, checklists, and table actions as complete controls, not static mockups.
- Make destructive and file-affecting actions explicit and reversible where the product flow allows it.
- Keep user-facing copy concrete: name the item/path/action/state rather than using generic "something went wrong" language.

## Validation

- Run `npm run typecheck` from `frontend-tauri/` for TypeScript/UI shape changes.
- Run targeted Vitest for changed renderer/facade behavior, or `npm test` when scope is broader.
- Run the smallest relevant Playwright smoke for window, route, loading, or workflow changes.
- Run `npm run build` if Tauri config, Rust shell-facing UI, resources, packaging, or production build behavior may be affected.
- Run repository-root `.\Build.ps1 -Configuration Release` after code changes unless automation/user scope says otherwise.
- Run `graphify update .` after code, docs, project-rule, or agent-configuration changes.

## Done Criteria

Before final response, confirm:

- the UI uses existing Fluxora patterns and avoids AI slop;
- the user can understand what to do without decorative instruction text;
- layout does not overlap or jump across expected window sizes;
- renderer code did not absorb core business logic;
- validation is reported with exact commands and outcomes.
