# Уведомления о сторонних компонентах

Дата вступления в силу: 31 июля 2026 г.

Статус проверки: это уведомление формируется из закреплённых repository inputs и release validation. Публичное распространение блокируется при неизвестной или отсутствующей лицензии, несовпадении lockfile, незафиксированной CMake binary version, неподтверждённом asset provenance либо незавершённой проверке владельцем и квалифицированным немецким юристом.

## 1. Область уведомления

Документ разделяет компоненты, поставляемые во время выполнения, и инструменты, используемые только для build/test. Он не утверждает, что build/test tools устанавливаются вместе с приложением. Машиночитаемый inventory и hashes его входов находятся в `legal/desktop/dependency-inventory.json`.

Интерфейс Windows использует Tauri с системным Microsoft Edge WebView2 Runtime. Fluxora не распространяет отдельный portable browser engine. Официальный Microsoft Edge WebView2 Evergreen Bootstrapper встроен в Setup только для получения WebView2 от Microsoft после подтверждения пользователя, когда runtime отсутствует.

## 2. Runtime-distributed компоненты

### Renderer и desktop shell

- Tauri 2 и Tauri plugins — Apache-2.0 OR MIT.
- React 19.2.7, React DOM 19.2.7 и Scheduler 0.27.0 — MIT.
- Lucide React 1.24.0 и repository SVG assets, сопоставленные с Lucide tag 1.21.0 — ISC; Feather-derived icons также имеют MIT notice в `Icons/LUCIDE-LICENSE.txt`.
- Monaco Editor 0.55.1 — MIT.
- Three.js 0.185.1 — MIT.
- Marked 14.0.0 — MIT.
- DOMPurify 3.2.7 — MPL-2.0 OR Apache-2.0.
- `@tauri-apps/api` 2.11.1 — Apache-2.0 OR MIT.
- `@types/trusted-types` 2.0.7 — MIT; транзитивный компонент production renderer graph.

### Rust/native shell и встроенные native libraries

Windows runtime Cargo graph разрешается для `x86_64-pc-windows-msvc` из `frontend-tauri/src-tauri/Cargo.lock`. В него входят Tauri/Wry, Tokio, Reqwest с Rustls, Serde, SQLite, P-256/SHA-2, Windows bindings, WebView2 bindings, keyring support, clipboard/dialog/deep-link/opener/single-instance plugins и их transitive crates. Каждый resolved package должен иметь license expression или license file, разрешённые `legal/desktop/license-policy.json`; иначе release validation завершается ошибкой.

C++ application связывает:

- spdlog — MIT; release source закреплён на v1.17.0.
- zlib — Zlib; release source закреплён на v1.3.1.
- Zstandard — BSD-3-Clause для библиотеки; release source закреплён на v1.5.7.
- Microsoft Detours — MIT; release source закреплён на 4.0.1 при включённой Windows VFS.

Production build устанавливает `FLUXORA_ALLOW_SYSTEM_DEPENDENCIES=OFF`, разрешает только эти точно закреплённые FetchContent sources и создаёт machine-readable evidence версий, источников и областей использования. Developer build может явно разрешить system packages, но такой build не допускается к release.

### Требование WebView2

`third_party/webview2/MicrosoftEdgeWebview2Setup.exe` — официальный Microsoft Edge WebView2 Evergreen Bootstrapper, полученный из `https://go.microsoft.com/fwlink/p/?LinkId=2124703`.

- Размер: 1 691 856 bytes.
- SHA-256: `0223fa1e8d5e4344fb8734e60d088e79f262c0a24444d01f240bc996f04e5`.
- Authenticode signer: Microsoft Corporation.
- Thumbprint сертификата: `4028CAD637509D4744B17EC5B42AED8D7A31E6AF`.
- Deployment terms/instructions: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution

Это Microsoft redistributable runtime bootstrapper, а не open-source компонент Fluxora. Setup запускает его только после подтверждения.

### Локальная речь

- whisper-rs 0.16.0 и whisper-rs-sys — Unlicense.
- whisper.cpp runtime/model tooling — MIT; `frontend-tauri/speech/licenses/whisper.cpp-MIT.txt`.
- Квантованная модель Whisper `small-q5_1`, закреплённые revision и SHA-256 из `frontend-tauri/speech/manifest.v1.json` — MIT notice в `frontend-tauri/speech/licenses/whisper-model-weights-MIT.txt`.
- Модель/integration Silero VAD 6.2.0, закреплённые revision и SHA-256 из того же manifest — MIT notice в `frontend-tauri/speech/licenses/silero-vad-MIT.txt`.

Model files и speech hosts входят в runtime. Закреплённый LunarG Vulkan SDK является только build input и не устанавливается и не включается в runtime payload.

### Шрифты

- Geist — SIL Open Font License 1.1; `frontend-tauri/src/renderer/assets/fonts/geist/LICENSE.txt`.
- IBM Plex Sans и IBM Plex Mono — SIL Open Font License 1.1; `frontend-tauri/src/renderer/assets/fonts/ibm-plex/LICENSE.txt`.

### Icons и product artwork

- Lucide SVG assets — ISC с MIT notice для Feather-derived icons; `Icons/LUCIDE-LICENSE.txt`.
- Bootstrap Icons `exclamation-lg.svg` — MIT; `Icons/BOOTSTRAP-ICONS-LICENSE.txt`.
- Tabler Icons `info-circle.svg` — MIT; `Icons/TABLER-ICONS-LICENSE.txt`.
- Material Design conflict-status SVG assets — Apache-2.0; `Icons/MATERIAL-DESIGN-ICONS-LICENSE.txt`.
- Twemoji language flags — CC-BY-4.0; `Icons/TWEMOJI-LICENSE.txt`, с upstream paths для каждого файла в `Icons/README.md`.
- Fluxora logo artwork — принадлежащая проекту product identity; она не выдаётся за стороннюю графику.

Каждый icon, импортированный Setup/Updater, должен существовать в `Icons`, иметь подтверждённые upstream path/tag, совпадать с закреплённым SHA-256, быть указан в `Icons/README.md` и ссылаться на доступный license file. Allowlist находится в `Icons/installer-updater-icons.json`.

## 3. Только build/test

Следующие компоненты используются для build, packaging, проверки или tests и не считаются runtime-distributed лишь из-за их наличия в lockfile/tool cache:

- Tauri CLI/bundler, Vite, TypeScript, React/Vite plugins и их development graph;
- Vitest, Playwright, test libraries и browser binaries, используемые тестами;
- GoogleTest 1.17.0 из закреплённого release source;
- CMake, MSVC, Rust/Cargo, pnpm, Node-based build tooling, PowerShell и Git;
- LunarG Vulkan SDK 1.4.341.1 из copy-only build-tool cache;
- release signing, inventory, SBOM и validation utilities.

Их лицензии важны для build environment и source distribution, но этот документ не заявляет, что такие tools устанавливаются с Fluxora.

## 4. Детерминированный release gate

Release validation сравнивает legal manifest hashes, production pnpm dependency set, Windows Cargo runtime graph, CMake declarations и resolved release evidence, WebView2 metadata/Authenticode signature, speech manifest/license files, font licenses и imported icon provenance. Отклоняются:

- dependency без разрешённого license expression или license file;
- изменённый lockfile/manifest без обновлённого inventory;
- CMake evidence, разрешающее system dependencies либо отличающееся от закреплённых release version, source или scope;
- icon import без подтверждённого provenance и license file;
- устаревшие утверждения о нераспространяемых компонентах;
- несовпадение SHA-256 юридических документов.

Полные тексты лицензий остаются рядом с компонентом или в указанных license files. Если лицензия требует включения текста в установленный продукт, packaging pipeline должна включить соответствующий файл.
