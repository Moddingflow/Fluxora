# Hinweise zu Drittanbieter-Komponenten

Gültig ab: 31. Juli 2026

Prüfstatus: Diese Hinweise werden aus festgelegten Repository-Eingaben und der Releaseprüfung abgeleitet. Eine öffentliche Veröffentlichung ist bei unbekannter oder fehlender Lizenz, Lockfile-Abweichung, ungeklärter CMake-Binärversion, fehlender Asset-Provenienz oder ausstehender Betreiber- und qualifizierter deutscher Rechtsprüfung gesperrt.

## 1. Geltungsbereich

Dieses Dokument trennt zur Laufzeit ausgelieferte Komponenten von Werkzeugen, die ausschließlich zum Bauen oder Testen verwendet werden. Es behauptet nicht, dass Build-/Testwerkzeuge mit der Anwendung installiert werden. Das maschinenlesbare Inventar und seine Eingabehashes stehen in `legal/desktop/dependency-inventory.json`.

Die Windows-Oberfläche verwendet Tauri mit der systemseitigen Microsoft Edge WebView2 Runtime. Fluxora verteilt keine separate portable Browser-Engine. Der offizielle Microsoft Edge WebView2 Evergreen Bootstrapper ist ausschließlich in Setup eingebettet, um WebView2 nach Ihrer Bestätigung von Microsoft abzurufen, wenn die Runtime fehlt.

## 2. Zur Laufzeit ausgelieferte Komponenten

### Renderer und Desktop-Shell

- Tauri 2 und Tauri-Plugins — Apache-2.0 OR MIT.
- React 19.2.7, React DOM 19.2.7 und Scheduler 0.27.0 — MIT.
- Lucide React 1.24.0 und Repository-SVGs mit Zuordnung zu Lucide-Tag 1.21.0 — ISC; von Feather abgeleitete Icons zusätzlich unter dem MIT-Hinweis in `Icons/LUCIDE-LICENSE.txt`.
- Monaco Editor 0.55.1 — MIT.
- Three.js 0.185.1 — MIT.
- Marked 14.0.0 — MIT.
- DOMPurify 3.2.7 — MPL-2.0 OR Apache-2.0.
- `@tauri-apps/api` 2.11.1 — Apache-2.0 OR MIT.
- `@types/trusted-types` 2.0.7 — MIT; transitiver Bestandteil des Produktions-Renderergraphen.

### Rust-/Native-Shell und eingebettete native Bibliotheken

Der Windows-Laufzeitgraph von Cargo wird für `x86_64-pc-windows-msvc` aus `frontend-tauri/src-tauri/Cargo.lock` aufgelöst. Er enthält Tauri/Wry, Tokio, Reqwest mit Rustls, Serde, SQLite, P-256/SHA-2, Windows-Bindings, WebView2-Bindings, Credential-Unterstützung, Clipboard-/Dialog-/Deep-Link-/Opener-/Single-Instance-Plugins und deren transitive Crates. Jedes aufgelöste Paket muss einen von `legal/desktop/license-policy.json` zugelassenen Lizenzausdruck oder eine Lizenzdatei besitzen; die Releaseprüfung schlägt andernfalls fehl.

Die C++-Anwendung bindet ein:

- spdlog — MIT; Releasequelle auf v1.17.0 festgelegt.
- zlib — Zlib; Releasequelle auf v1.3.1 festgelegt.
- Zstandard — BSD-3-Clause für die Bibliothek; Releasequelle auf v1.5.7 festgelegt.
- Microsoft Detours — MIT; Releasequelle auf 4.0.1 festgelegt, wenn die Windows-VFS-Funktion aktiviert ist.

Der Produktionsbuild setzt `FLUXORA_ALLOW_SYSTEM_DEPENDENCIES=OFF`, löst genau diese festgelegten FetchContent-Quellen auf und erzeugt maschinenlesbare Evidenz zu Version, Quelle und Verwendungsbereich. Ein Entwicklerbuild kann Systempakete ausdrücklich zulassen, ist dann jedoch nicht releasefähig.

### WebView2-Voraussetzung

`third_party/webview2/MicrosoftEdgeWebview2Setup.exe` ist der offizielle Microsoft Edge WebView2 Evergreen Bootstrapper von `https://go.microsoft.com/fwlink/p/?LinkId=2124703`.

- Größe: 1.691.856 Bytes.
- SHA-256: `0223fa1e8d5e4344fb8734e60d088e79f262c0a24444d01f240bc996f04e5`.
- Authenticode-Signatur: Microsoft Corporation.
- Zertifikat-Thumbprint: `4028CAD637509D4744B17EC5B42AED8D7A31E6AF`.
- Bereitstellungsbedingungen und Anleitung: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution

Dies ist ein weiterverteilbarer Microsoft-Runtime-Bootstrapper und keine Open-Source-Komponente von Fluxora. Setup startet ihn nur nach Bestätigung.

### Lokale Spracherkennung

- whisper-rs 0.16.0 und whisper-rs-sys — Unlicense.
- whisper.cpp Runtime-/Modellwerkzeuge — MIT; Lizenz unter `frontend-tauri/speech/licenses/whisper.cpp-MIT.txt`.
- Quantisiertes Whisper-Modell `small-q5_1`, Revision und SHA-256 aus `frontend-tauri/speech/manifest.v1.json` — MIT-Hinweis unter `frontend-tauri/speech/licenses/whisper-model-weights-MIT.txt`.
- Silero VAD 6.2.0 Modell-/Runtimeintegration, Revision und SHA-256 aus demselben Manifest — MIT-Hinweis unter `frontend-tauri/speech/licenses/silero-vad-MIT.txt`.

Modelldateien und Speech Hosts werden zur Laufzeit ausgeliefert. Das festgelegte LunarG Vulkan SDK ist nur Build-Eingabe und weder installiert noch Bestandteil des Laufzeitpayloads.

### Schriften

- Geist — SIL Open Font License 1.1; `frontend-tauri/src/renderer/assets/fonts/geist/LICENSE.txt`.
- IBM Plex Sans und IBM Plex Mono — SIL Open Font License 1.1; `frontend-tauri/src/renderer/assets/fonts/ibm-plex/LICENSE.txt`.

### Icons und Produktgrafik

- Lucide-SVGs — ISC, mit MIT-Hinweis für Feather-Ableitungen; `Icons/LUCIDE-LICENSE.txt`.
- Bootstrap Icons `exclamation-lg.svg` — MIT; `Icons/BOOTSTRAP-ICONS-LICENSE.txt`.
- Tabler Icons `info-circle.svg` — MIT; `Icons/TABLER-ICONS-LICENSE.txt`.
- Material-Design-SVGs für Konfliktstatus — Apache-2.0; `Icons/MATERIAL-DESIGN-ICONS-LICENSE.txt`.
- Twemoji-Sprachflaggen — CC-BY-4.0; `Icons/TWEMOJI-LICENSE.txt`, mit Upstreampfaden je Datei in `Icons/README.md`.
- Fluxora-Logo — projekteigene Produktidentität; nicht als Drittanbieter-Grafik ausgewiesen.

Jedes von Setup oder Updater importierte Icon muss in `Icons` vorhanden sein, einen bestätigten Upstreampfad und Tag besitzen, dem festgelegten SHA-256 entsprechen, in `Icons/README.md` erscheinen und auf eine zugängliche Lizenzdatei verweisen. `Icons/installer-updater-icons.json` ist die Allowlist.

## 3. Ausschließlich Build/Test

Folgende Komponenten werden zum Bauen, Paketieren, Prüfen oder Testen verwendet und nicht allein wegen ihres Vorkommens in Lockfile oder Toolcache als Laufzeitbestandteil dargestellt:

- Tauri CLI/Bundler, Vite, TypeScript, React-/Vite-Plugins und deren Development-Graph;
- Vitest, Playwright, Testbibliotheken und durch Tests genutzte Browser-Binaries;
- GoogleTest 1.17.0 aus der festgelegten Releasequelle;
- CMake, MSVC, Rust/Cargo, pnpm, Node-basierte Buildwerkzeuge, PowerShell und Git;
- LunarG Vulkan SDK 1.4.341.1 aus einem Copy-only-Buildtoolcache;
- Release-Signing-, Inventar-, SBOM- und Validierungswerkzeuge.

Ihre Lizenzen bleiben für Buildumgebung und Quellverteilung relevant; dieses Dokument behauptet jedoch nicht, dass diese Werkzeuge mit Fluxora installiert werden.

## 4. Deterministisches Release-Gate

Die Releaseprüfung vergleicht Legal-Manifesthashes, pnpm-Produktionsabhängigkeiten, Windows-Cargo-Laufzeitgraph, CMake-Deklarationen und aufgelöste Releaseevidenz, WebView2-Metadaten und Authenticode-Signatur, Speech-Manifest und Lizenzdateien, Schriftlizenzen sowie importierte Icon-Provenienz. Abgelehnt werden:

- Abhängigkeiten ohne zugelassenen Lizenzausdruck oder Lizenzdatei;
- geänderte Lockfiles oder Manifeste ohne erneuertes Inventar;
- CMake-Evidenz, die Systemabhängigkeiten zulässt oder von festgelegter Releaseversion, Quelle oder Verwendungsbereich abweicht;
- Icon-Importe ohne bestätigte Provenienz und Lizenzdatei;
- veraltete Aussagen über nicht ausgelieferte Komponenten;
- Abweichungen von SHA-256-Werten der Rechtsdokumente.

Vollständige Lizenztexte verbleiben bei der Komponente oder in den referenzierten Lizenzdateien. Soweit eine Lizenz die Wiedergabe im installierten Produkt verlangt, muss die Packaging-Pipeline die entsprechende Datei einschließen.
