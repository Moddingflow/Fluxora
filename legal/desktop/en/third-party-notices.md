# Third-Party Notices

Effective date: 31 July 2026

Engineering review status: this notice is generated from pinned repository inputs and release validation. Public distribution is blocked for an unknown or missing licence, lockfile mismatch, unresolved CMake binary version, missing asset provenance, or pending owner and qualified German legal review.

## 1. What this notice covers

This document distinguishes components distributed at runtime from tools used only to build or test Fluxora. Build/test tools are not claimed to be installed with the application. The machine-readable inventory and its input hashes are in `legal/desktop/dependency-inventory.json`.

The Windows UI uses Tauri with the system Microsoft Edge WebView2 Runtime. Fluxora does not distribute a separate portable browser engine. The official Microsoft Edge WebView2 Evergreen Bootstrapper is embedded in Setup solely to obtain WebView2 from Microsoft after user confirmation when the runtime is absent.

## 2. Runtime-distributed components

### Renderer and desktop shell

- Tauri 2 and Tauri plugins — Apache-2.0 OR MIT.
- React 19.2.7, React DOM 19.2.7, and Scheduler 0.27.0 — MIT.
- Lucide React 1.24.0 and repository SVG assets mapped to Lucide tag 1.21.0 — ISC; Feather-derived icons also carry the MIT notice included in `Icons/LUCIDE-LICENSE.txt`.
- Monaco Editor 0.55.1 — MIT.
- Three.js 0.185.1 — MIT.
- Marked 14.0.0 — MIT.
- DOMPurify 3.2.7 — MPL-2.0 OR Apache-2.0.
- `@tauri-apps/api` 2.11.1 — Apache-2.0 OR MIT.
- `@types/trusted-types` 2.0.7 — MIT; included transitively by the production renderer dependency graph.

### Rust/native shell and embedded native libraries

The Windows runtime Cargo graph is resolved from `frontend-tauri/src-tauri/Cargo.lock` for `x86_64-pc-windows-msvc`. It includes Tauri/Wry, Tokio, Reqwest with Rustls, Serde, SQLite, P-256/SHA-2, Windows bindings, WebView2 bindings, keyring support, clipboard/dialog/deep-link/opener/single-instance plugins, and their transitive crates. Every resolved package must provide a licence expression or licence file accepted by `legal/desktop/license-policy.json`; the release validator fails closed otherwise.

The C++ application links:

- spdlog — MIT; release source pinned to v1.17.0.
- zlib — Zlib; release source pinned to v1.3.1.
- Zstandard — BSD-3-Clause for the library; release source pinned to v1.5.7.
- Microsoft Detours — MIT; release source pinned to 4.0.1 when the Windows VFS feature is enabled.

The production build sets `FLUXORA_ALLOW_SYSTEM_DEPENDENCIES=OFF`, resolves these exact pinned FetchContent sources, and generates machine-readable evidence of the versions, sources and scopes used. A developer build can explicitly opt into system packages, but such a build is not release-eligible.

### WebView2 prerequisite

`third_party/webview2/MicrosoftEdgeWebview2Setup.exe` is the official Microsoft Edge WebView2 Evergreen Bootstrapper obtained from `https://go.microsoft.com/fwlink/p/?LinkId=2124703`.

- Size: 1,691,856 bytes.
- SHA-256: `0223fa1e8d5e4344fb8734e60d088e79f262c0a24444d01f240bc996f04e5`.
- Authenticode signer: Microsoft Corporation.
- Signer certificate thumbprint: `4028CAD637509D4744B17EC5B42AED8D7A31E6AF`.
- Deployment terms and instructions: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution

This is a Microsoft redistributable runtime bootstrapper, not an open-source Fluxora component. Setup starts it only after confirmation.

### Local speech

- whisper-rs 0.16.0 and whisper-rs-sys — Unlicense.
- whisper.cpp runtime/model tooling — MIT; licence at `frontend-tauri/speech/licenses/whisper.cpp-MIT.txt`.
- Quantised Whisper `small-q5_1` model, pinned revision and SHA-256 from `frontend-tauri/speech/manifest.v1.json` — MIT notice at `frontend-tauri/speech/licenses/whisper-model-weights-MIT.txt`.
- Silero VAD 6.2.0 model/runtime integration, pinned revision and SHA-256 from the same manifest — MIT notice at `frontend-tauri/speech/licenses/silero-vad-MIT.txt`.

The model files and speech hosts are runtime-distributed. The pinned LunarG Vulkan SDK is a build input only and is not installed or included as a runtime payload.

### Fonts

- Geist — SIL Open Font License 1.1; licence at `frontend-tauri/src/renderer/assets/fonts/geist/LICENSE.txt`.
- IBM Plex Sans and IBM Plex Mono — SIL Open Font License 1.1; licence at `frontend-tauri/src/renderer/assets/fonts/ibm-plex/LICENSE.txt`.

### Icons and product artwork

- Lucide SVG assets — ISC, with MIT notice for Feather-derived icons; `Icons/LUCIDE-LICENSE.txt`.
- Bootstrap Icons `exclamation-lg.svg` — MIT; `Icons/BOOTSTRAP-ICONS-LICENSE.txt`.
- Tabler Icons `info-circle.svg` — MIT; `Icons/TABLER-ICONS-LICENSE.txt`.
- Material Design conflict-status SVG assets — Apache-2.0; `Icons/MATERIAL-DESIGN-ICONS-LICENSE.txt`.
- Twemoji language flags — CC-BY-4.0; `Icons/TWEMOJI-LICENSE.txt`, with per-file upstream paths in `Icons/README.md`.
- Fluxora logo artwork — project-owned product identity; it is not presented as third-party artwork.

Every imported Setup/Updater icon must exist in `Icons`, have a verified upstream path and tag, match its pinned SHA-256, appear in `Icons/README.md`, and point to an accessible licence file. `Icons/installer-updater-icons.json` is the allowlisted mapping.

## 3. Build/test-only components

The following are used to build, package, inspect, or test Fluxora and are not represented as runtime-distributed merely because they occur in a lockfile or tool cache:

- Tauri CLI/bundler, Vite, TypeScript, React/Vite plugins, and their development dependency graph;
- Vitest, Playwright, testing-library dependencies, and browser binaries used by tests;
- GoogleTest 1.17.0 from the pinned release source;
- CMake, MSVC, Rust/Cargo, pnpm, Node-based build tooling, PowerShell, and Git;
- LunarG Vulkan SDK 1.4.341.1, used from a copy-only build-tool cache;
- release signing, inventory, SBOM, and validation utilities.

Their licences remain relevant to the build environment and source distribution, but this notice does not state that those tools are installed with Fluxora.

## 4. Deterministic release gate

Release validation compares the legal manifest hashes, pnpm production dependency set, Windows Cargo runtime graph, CMake declarations and resolved release evidence, WebView2 metadata and Authenticode signature, speech manifest and licence files, font licences, and imported icon provenance. It rejects:

- a dependency without an accepted licence expression or licence file;
- a changed lockfile or manifest that has not regenerated the inventory;
- CMake evidence that permits system dependencies or differs from a pinned release version, source, or scope;
- an icon import without verified provenance and a licence file;
- stale claims about components that are not distributed;
- a mismatch in any legal document SHA-256.

Full licence texts remain with the component or in the referenced licence files. Where a licence requires reproduction in the installed product, the packaging pipeline must include the corresponding file.
