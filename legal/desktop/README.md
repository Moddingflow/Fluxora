# Fluxora desktop legal source

`legal/desktop` is the single offline legal-document source for Fluxora Setup
and the main application's Legal Documents settings panel.

- `manifest.json` identifies the effective date, fallback language, four
  documents for each supported language, and the SHA-256 of the exact UTF-8
  bytes packaged into the product.
- `{en,de,ru}` contain Privacy Policy, Terms of Use, Third-Party Notices and
  Legal Notice variants.
- `dependency-inventory.json` is a deterministic generated snapshot of
  production pnpm dependencies, the Windows Cargo graph, CMake dependencies,
  WebView2 metadata, speech models, fonts and icon provenance.
- `license-policy.json` is the fail-closed licence allowlist and CMake
  release-evidence contract.
- `DATA-FLOW-AUDIT.md` records the engineering trace from implemented data
  flows to policy disclosures and unresolved legal gates.

Run the focused compliance check from the repository root:

```powershell
.\scripts\release\Test-DesktopLegalAndAssetCompliance.ps1
```

Build orchestration can request a single machine-readable result object and
use the process exit code as the fail-closed gate:

```powershell
.\scripts\release\Test-DesktopLegalAndAssetCompliance.ps1 -MachineReadable
```

The JSON result schema is `fluxora.desktop-compliance.result.v1`; `status` is
`passed` only when document hashes, lock-derived dependency inventories,
licence allowlists, imported-icon provenance, and runtime-asset checks all
match.

Regenerate the dependency inventory only after intentionally reviewing changed
lockfiles, dependency licences and asset metadata:

```powershell
.\scripts\release\Test-DesktopLegalAndAssetCompliance.ps1 -UpdateInventory
.\scripts\release\Test-DesktopLegalAndAssetCompliance.ps1
```

The production release gate is stricter:

```powershell
.\scripts\release\Test-DesktopLegalAndAssetCompliance.ps1 -Release
```

`-Release` also requires exact CMake resolution evidence at the path declared
in `license-policy.json`. Build orchestration can provide the generated path
explicitly with `-CMakeEvidencePath build/backend/fluxora-cmake-dependencies.json`.
The evidence schema is `{ schemaVersion: 1, allowSystemDependencies: false,
dependencies: [{ name, version, source, scope }] }`. Configured fallback tags
alone do not prove which dependency source was linked.

Public release remains blocked until the operator and qualified German counsel
complete the approvals recorded in `manifest.json`. Regenerating a hash or
passing an automated check is not legal approval.
