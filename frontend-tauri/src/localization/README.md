# Fluxora localization

Fluxora keeps product copy in versioned JSON resource catalogs instead of scattering translated strings through TypeScript and JSX.

## Catalogs

- `locales/en-US.json` is the typed source catalog and English fallback.
- `locales/de-DE.json` contains the complete German catalog.
- `locales/ru-RU.json` contains the complete Russian catalog.
- `index.ts` owns locale normalization, bundled i18next resources and non-React translation.
- `react.tsx` owns the renderer provider and `useLocalization()` hook.
- `app-language-state.ts` owns the small startup/optimistic/rollback state machine shared by the product renderer and text-editor window.

The native settings service remains the authority for the selected language. Product renderers do not commit localized product copy until the initial native language read settles. A successful native change is broadcast through `window.fluxora.settings.onLanguageChanged`, so the main window and every open secondary window update together. The initiating window applies the requested locale immediately and rolls back only if persistence fails. Renderer, Setup, updater and secondary-window UI normalize native `en`, `de` and `ru` values to the three catalog locales above. Unknown values fail safely to `en-US`.

Offline privacy policy and terms documents are intentionally separate from interface copy. Their reviewed source remains `legal/desktop/{en,de,ru}/` and `legal/desktop/manifest.json`.

## Adding or changing copy

1. Add the key to all three JSON catalogs in the same change.
2. Keep interpolation placeholders identical in every locale. Fluxora uses `{name}` syntax.
3. Add every plural suffix used by a key to every catalog (`_one`, `_few`, `_many`, `_other`) so catalogs stay structurally identical.
4. Use `t('key')` inside React. Use `translateForLanguage(language, 'key')` in focused state or service helpers that produce visible copy.
5. Do not use translation helpers for protocol values, operation kinds, persisted identifiers, filenames or parser tokens that are not shown directly to the user.

`TranslationKey` is derived from `en-US.json`; invalid keys therefore fail TypeScript compilation. German and Russian completeness, placeholder parity and locale fallback are verified by `tests/localization.test.ts`. `tests/localization-source-guard.test.ts` rejects hardcoded user-facing copy in renderer and installer TypeScript/JSX.

## Validation

From `frontend-tauri/`:

```powershell
pnpm run typecheck
pnpm exec vitest run tests/app-language-state.test.ts tests/language-sync-facade-contract.test.ts tests/localization.test.ts tests/localization-provider.test.tsx tests/localization-source-guard.test.ts
```

Run the focused component tests for every surface whose copy changed, then the complete `pnpm test -- --run` suite and the repository-root `Build.ps1` validation required by project policy.
