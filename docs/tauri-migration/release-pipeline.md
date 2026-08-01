# Fluxora Tauri release pipeline

Дата обновления: 2026-08-01

Статус: the Windows product, Setup and updater build path is C++ plus Tauri.
Linux/macOS public distribution remains gated by native smoke,
signing/notarization and final owner/legal review.

## Approved artifacts

Windows public release:

- `output-installer/FluxoraSetup.exe` remains the only approved standalone,
  user-installable Windows artifact.
- A production GitHub Release may additionally contain the machine-consumed
  `fluxora-update-manifest.json`, `fluxora-update-manifest.sig`, one signed
  `fluxora-release-inventory.json`, `fluxora-release-inventory.sig`, one full
  `.flxupd` package and zero or more file-delta `.flxupd` packages. Both JSON
  envelopes are detached-signature authenticated; the inventory cross-binds the
  exact release asset names, sizes and hashes to the update manifest. These are
  machine inputs, not portable builds or independently installable
  distributions. Do not advertise them as an alternative to
  `FluxoraSetup.exe`.
- Setup and the application share the same SemVer product version. There is no
  independent installer version.
- `Build.ps1` builds the MSVC static installer core, the statically linked
  `FluxoraUpdater.exe`, the main Tauri application payload, the compressed
  package and finally the statically linked `FluxoraSetup.exe`.
- `output/` is local installer staging only. Do not publish it, zip it, attach it or treat it as portable Fluxora.
- `frontend-tauri/src-tauri/target/` and `build/tauri-native/` are local build artifacts only. Normal builds run Tauri with `--no-bundle`, and `bundle.active` remains `false`, so they do not create a second user-runnable Windows installer.

Linux public candidates:

- `.deb` and `.rpm` are the selected package formats once native `.so` payload smoke passes on a real Linux host.
- Tauri side artifacts are internal smoke artifacts, not public portable releases.
- AppImage is not approved in Phase 15. Revisit only with an explicit update/signing plan.

macOS public candidates:

- No public macOS artifact is approved until Developer ID signing, notarization and native `.dylib`/helper signing are validated.
- Tauri side artifacts are internal smoke artifacts.
- `.dmg` remains the preferred public-package plan after signing/notarization is ready.

## Windows release build

Running `Build.ps1` without arguments presents exactly two choices:

1. `Build locally` builds the product and installer with the current synchronized
   version, without committing, tagging, pushing or contacting GitHub Releases.
   Supplying `-Version major.minor.patch` atomically updates every owned version
   source before the build; omitting it leaves the current version unchanged.
2. `Production release` executes the guarded release transaction below.

Before any remote prerequisite, Production shows four version choices: keep the
current version and cancel publication, Small/patch, Minor, or Major. Explicit
`-Version` accepts both `major.minor` and `major.minor.patch`, normalising the
short form with patch zero.

Explicit legacy build arguments remain non-interactive and select local mode.
The corresponding explicit local command is:

```powershell
.\Build.ps1 -Mode Local -Configuration Release -Runtime win-x64
```

To set the product version and build the application, native bridge, updater and
Setup with the same stable SemVer:

```powershell
.\Build.ps1 -Mode Local -Configuration Release -Runtime win-x64 -Version 0.1.0
```

The value is persisted in the Tauri configuration, `package.json`,
`Cargo.toml` and their applicable lock files. Tauri exposes that packaged
version through the existing typed app-info facade, and Settings > Для
разработчиков displays it as `Версия Fluxora`.

The Windows build path performs these steps in dependency order:

- configure and build `backend/` through CMake, including
  `FluxoraInstallerCore.lib`;
- build the isolated Tauri updater renderer and `FluxoraUpdater.exe`, statically
  link the installer core and stage only that self-contained executable in the
  main application resources;
- build the Tauri-side `fluxora-ai-host` binary and stage it as `FluxoraAIHost.exe`;
- verify the pinned libclang build dependency and build the CPU-only `fluxora-speech-host` as `FluxoraSpeechHost.exe`;
- build the CPU host in isolated `build/cpu` with explicit optimized MSVC Release flags so Cargo/CMake cannot silently produce an unoptimized fallback binary;
- download the pinned LunarG Vulkan SDK 1.4.341.1 into ignored `build/tool-cache`, verify SHA-256, install it in supported unattended `copy_only` mode without modifying the system Vulkan installation, and build `fluxora-speech-host-vulkan` as `FluxoraSpeechHostVulkan.exe`;
- use the short ignored `build/vk` Cargo target for the Vulkan build so whisper.cpp's nested shader-generator paths remain below the Windows MSBuild/FileTracker path limit;
- download the pinned Whisper `small-q5_1` and Silero VAD 6.2.0 assets only during the build into ignored `build/model-cache/speech`, validating revision, size where declared, and SHA-256 before staging;
- collect `FluxoraBridgeHost.exe`, `FluxoraAIHost.exe`, both speech hosts, `FluxoraCore.dll` and `FluxoraVfs.dll` into `build/tauri-native/win32/x64`;
- resolve the exact `packageManager` version from `frontend-tauri/package.json`
  through Corepack, an exact global `pnpm`, or the `npm exec` fallback; restore
  the frozen pnpm lockfile before dependency inventory and run the Tauri build
  with Cargo lock enforcement after staging native payloads into
  `frontend-tauri/src-tauri/resources/native`;
- copy the built Tauri app from `frontend-tauri/src-tauri/target/release/Fluxora.exe` into `output/`;
- verify `output/Fluxora.exe`, both speech-host files, all other native hosts/core/VFS, the speech manifest, glossary, licenses, and both model hashes under `output/resources/speech`;
- create `build/installer-cache/FluxoraPayload.flxpkg.gz`;
- verify and embed the pinned Microsoft WebView2 Evergreen bootstrapper, the
  compressed payload and offline legal documents into the isolated Tauri Setup;
- build `FluxoraSetup.exe` last and copy only that user-installable artifact to
  `output-installer/`.

The build has no `dotnet`, WPF, SharpVectors, C# project or installer-core DLL
prerequisite. Setup and updater statically link `FluxoraInstallerCore.lib`; a
loose `FluxoraInstallerCore.dll` is a packaging failure.

The installed app is fully offline for speech recognition. Runtime code neither
downloads nor updates speech assets. Model updates require a reviewed manifest
revision/hash change and a new signed installer build. Model cache and generated
Tauri speech resources are build artifacts and must not be committed or
distributed as a portable package.

## Automatic-update release contract

The stable channel is discovered only through the two fixed public assets:

```text
https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.json
https://github.com/Moddingflow/Fluxora/releases/latest/download/fluxora-update-manifest.sig
```

The manifest must use the strict v1 schema defined in
`docs/tauri-migration/architecture.md`. It is signed over its exact UTF-8 bytes
with ECDSA P-256/SHA-256, and the detached `.sig` is Base64 of the 64-byte
IEEE-P1363 `r || s` signature. Reformatting the JSON after signing invalidates
the release. Every release has exactly one full update package. A file-delta
package may be created only for a prior release whose signed target file digest
is available and exactly matches the declared base; the first release therefore
has no delta. Missing, inapplicable or invalid deltas fall back to the full
package rather than blocking recovery.

`fluxora-release-inventory.json` is a second strict, raw-byte-signed envelope
used by the publisher rather than by the runtime updater. It includes the exact
version and the immutable name, size and SHA-256 of the installer, update
manifest/signature and every `.flxupd` asset. Draft verification downloads the
inventory and all named assets, verifies both detached signatures, requires an
exact one-to-one asset set and rechecks every update package against the already
signed manifest before the draft may become public.

Suggested immutable asset names are:

- `fluxora-<version>-win-x64-full.flxupd`;
- `fluxora-<version>-win-x64-from-<previous-version>.flxupd`.

Both package types support arbitrary file bytes and safe Unicode relative paths.
They exclude `Downloads`, updater cache/download/runtime directories, logs,
transaction siblings and any user or machine-specific state. The package header
repeats kind, source version where applicable, target version, base file-manifest
digest and target file-manifest digest. Release tooling must independently hash
the completed package and every target file, create the canonical file-manifest
digest, and verify the package by unpacking it into a disposable tree before it
can become a release asset.

The runtime cache uses Fluxora's existing stable per-user data root at
`%APPDATA%\Fluxora\updates`, resolved by `fluxora_data_dir` rather than an
install path or mutable Tauri identifier:

- `cache/verified-manifest-v1-<sha256(raw-manifest)>.json` stores the raw
  manifest, Base64 signature and conditional `ETag`/`Last-Modified` metadata;
  only the newest two verified entries are retained;
- `downloads/<target-version>/` stores a hash-addressed partial package,
  resume metadata and the completed verified package;
- `manifests/<manifest-sha256>.json` and `.sig` preserve the exact
  verified input for the updater transaction;
- `updater-runtime/operation-<first32-sha256(operationId)>/` contains the copied
  self-contained updater executable and bounded request file so replacement never
  depends on an executable inside the live installation directory and an
  untrusted operation identifier never becomes a path segment;
- `health/<handoff-nonce>.ack` is created atomically and with create-new
  semantics by the relaunched application only after the main renderer reports
  ready and a fresh BridgeHost `system.handshake` succeeds. The updater accepts
  it only when the nonce, application version, PID and process start time match
  the exact child process it launched;
- `installed-manifest.json` and `installed-manifest.sig` are written atomically
  after the health acknowledgement and must verify before a later release may
  select a delta for the installed version. At activation, after delta download
  and after lifecycle drain, Tauri performs an exact-tree comparison against
  that signed installed inventory. Missing, changed or unexpected application
  entries, reparse points, case collisions and unsupported entry types select
  the signed full fallback; only the root `Downloads` and install-local `logs`
  mutable trees are excluded. A setup-origin installation without this receipt uses the full
  fallback once; successful automatic update then establishes the receipt needed
  by subsequent exact-version deltas.

Every successful Setup `install`, `repair` or `update` continues under the same
root `operationId` with an automatic stable-channel check. This post-install
path uses the common signed discovery, cache validation, resumable download,
size/SHA-256 verification and updater-staging implementation, but always
selects the signed full asset and never uses a delta. Setup obtains the install
tree, application executable and bundled version only from its successful
native session. If no newer version exists, or checking/downloading fails before
handoff commit, Setup launches the installed bundled application; the normal
in-app check can retry later. A successful handoff invokes the isolated updater
with `presentation=setup-handoff` and the selected `en`, `de` or `ru` locale,
without changing the native C++ request contract or its health/rollback rules.

The native transaction uses installation siblings named
`.Fluxora.fluxora-transaction`, `.Fluxora.fluxora-staging-<32hex>`,
`.Fluxora.fluxora-backup-<32hex>` and
`.fluxora-commit-<32hex>.pending`. Those names are private transaction state,
never release assets. Pre-swap staging and post-rename actual-live verification
run under a deterministic per-install single-writer mutex that remains owned
across recovery, apply, health probation and finalize/rollback. A concurrent
updater returns busy before it can touch markers or recovery activation. The
transaction retains the backup and marker while the updater launches the new
executable suspended, assigns it and all descendants to a Job Object, then waits a bounded
30 seconds for the exact health acknowledgement above. Only a valid ACK releases
the job and finalizes backup removal. Launch failure, early exit, timeout or an
invalid ACK terminates that complete process tree, rolls back and relaunches the
previous version. An out-of-tree watchdog covers updater-process failure and a
strict `!` HKCU RunOnce recovery command covers reboot/power loss; absent ACK
always prefers backup. Protected mutable `Downloads` and install-local `logs`
must retain identical before/after source and staged/live SHA-256 snapshots.

## Production release transaction

Production mode is fail-closed and non-forceful:

1. Select or explicitly provide the semantic version before GitHub/tooling
   prerequisites. Keeping the current version cancels because the updater never
   installs a version less than or equal to the installed version. A repository-
   private OS lock excludes concurrent publishers. Before showing this menu, a
   stale version-recovery journal from an interrupted process is validated
   against the unchanged Git HEAD and used to restore the exact original bytes.
2. Verify the authenticated GitHub repository, default release branch, that the
   branch is not behind upstream, and absence of the version tag/release. If the
   worktree is dirty or local commits are unpublished, show the exact `git add
   --all --dry-run` plan and counts, require `PUBLISH` confirmation (or explicit
   `-PublishCurrentChanges`), reject likely secret/key paths, and create a
   separate checkpoint commit. Generated `node_modules`, build, target, test-
   result and output trees are rejected as well. Existing local commits are allowed and are
   included in the later atomic push. The worktree must then be clean. Open the
   update-manifest signing key only after repository-controlled build/test gates.
   Update every owned version source and regenerate its deterministic dependency
   inventory as one recoverable local step. This refresh is required because the
   inventory hashes version-owned package and Cargo inputs. Before any version
   edit, Production atomically writes the bounded original bytes and their hashes
   to a repository-private journal under `.git`. A normal failure or the next
   invocation after process termination restores both the original version files
   and inventory; a changed HEAD refuses recovery instead of overwriting work.
   Before any remote check or checkpoint mutation, Production resolves and, when
   necessary, downloads the pinned pnpm runtime. After applying the selected
   version it restores the frozen frontend dependencies before regenerating the
   inventory, so a clean checkout does not depend on a global pnpm installation
   or pre-existing `node_modules`.
3. Build the native updater ABI prerequisite, then run the full unit, component,
   integration, API-contract and UI gates plus the ordinary local release build.
   Production treats a missing real native full/delta ABI test target as a hard
   failure; a clean machine may never silently skip it. Cargo lock enforcement
   applies to direct Rust builds and the exact packaged Tauri binary. Production
   bounds every CTest case to 120 seconds and stops the suite on the first failure,
   so a wedged test cannot leave the release running indefinitely. Production
   restages the Setup and updater renderers after the main Vite build so the same
   Playwright pass covers all three shipped windows. Screenshots, traces and
   last-run state are written under the disposable release transaction directory,
   so test output cannot enter the release checkpoint or trip the strict post-gate
   worktree allowlist.
4. Produce and round-trip-verify the full `.flxupd`, eligible deltas and
   raw-byte-signed manifest, then generate the signed inventory over the exact
   unsigned Setup and machine-asset bytes. Fluxora does not require a paid
   Authenticode certificate or `signtool`; Windows can therefore identify these
   executables as an unknown publisher. Detached P-256 signatures authenticate
   the automatic-update manifest/inventory but do not claim OS publisher trust.
5. Verify the exact version-file bytes, staged blob identities, release commit
   parent/path set and committed tree; release commits bypass mutable local hooks.
   Create the immutable version tag, and atomically push the branch and tag
   without force. Then create a draft GitHub Release and upload the installer,
   both signed envelopes and update packages without `--clobber` or replacement
   of existing assets.
6. Download every draft asset through GitHub, re-check the exact signed inventory
   set, names, sizes, SHA-256 values, detached signatures and manifest/package
   linkage, and publish only after every check succeeds. The `latest` alias
   becomes visible to clients only at this final publish step.

There is no honest single transaction across Git, GitHub Releases and local
files. Before a push, production mode restores local version edits on failure or
on the next invocation after an externally terminated process;
a successful checkpoint commit remains because it is the durable copy of the
current changes the operator explicitly selected for publication.
After a commit or tag has been pushed, it never rewrites remote history: it
leaves any release as an unpublished draft, prints the exact remote state and
requires an owner to resume or intentionally supersede it. If a published asset
is later found unsafe, remove the affected release from discovery, investigate
the signing/repository credentials, publish a fixed higher version, and use the
approved installer as the recovery path; never silently replace an immutable
asset under an existing version.

### Signing-key custody and rotation

- The ECDSA P-256 private key is supplied from protected release-operator or CI
  secret storage outside the repository and is never echoed, logged, staged or
  uploaded. Production removes a CI key from the process environment before
  loading repository modules or starting any build/test/Git/GitHub child; a
  local DPAPI key is not opened until all build/test gates have completed. The
  in-memory signer is limited to artifact generation and disposed/zeroed after
  use. Keep at least two encrypted, access-controlled offline backups and
  periodically test restoration with a disposable signature/verification drill;
  repository automation cannot honestly prove that an offline backup exists.
- Only public keys are committed and embedded. Normal rotation is staged: ship a
  release signed by the current key that trusts both current and next public
  keys; after sufficient adoption, sign with the next private key; remove the old
  public key only in a later release already verifiable by the next key.
- If the current private key may be compromised, the same update channel cannot
  safely establish new trust by itself. Revoke/disable affected release assets,
  rotate GitHub and release credentials, distribute a replacement
  `FluxoraSetup.exe` through the official recovery channel with an independently
  published SHA-256, and complete an owner/security incident review before
  restoring automatic discovery.
- Fluxora's Windows executables are intentionally not Authenticode-signed while
  the project has no affordable trusted-publisher certificate. Manifest and
  inventory signing protect the update channel, but Windows publisher reputation
  and SmartScreen prompts remain an explicit user-facing limitation.

#### Portable signing-key backup and restore

The local `.dpapi` file is bound to the current Windows user and is not a
portable backup. Use the dedicated PowerShell 7 commands; they never accept a
plaintext password argument, environment variable or password file:

```powershell
pwsh -NoProfile -File .\scripts\release\Export-FluxoraUpdateSigningKeyBackup.ps1 `
  -OutputPath 'D:\Fluxora-Key-Backups\fluxora-update-manifest-p256-2026-07-31.encrypted.pk8'
```

The destination must be an absolute path on a pre-existing fixed or removable
local drive, outside both the repository and the active
`%LOCALAPPDATA%\Fluxora\release-signing` directory, and must not use a reparse
point. UNC/network, device, extended (`\\?\`), alternate-data-stream, reserved
device-name and trailing-space/period aliases are rejected. Boundary checks use
the handle-resolved volume/path identity, so `subst` and available 8.3 aliases
cannot redirect a nominally external path back into the repository. The command
prompts twice with `Read-Host -AsSecureString`, requires at least 20 characters
and recommends a password-manager-generated password of at least 32 random
characters. Existing backup files are never overwritten.

The portable file is one standard PKCS#8 `EncryptedPrivateKeyInfo` DER value
using PBES2, PBKDF2-HMAC-SHA256 with 600,000 iterations and AES-256-CBC with
fresh random salt and IV. Before publishing the file, Export decrypts it with
the confirmation password, compares its ECDSA P-256 public identity with the
committed `stable-public-key.der` in fixed time, and performs a real
sign/verify self-test. Restore parses and pins that exact PBE policy, including
the reviewed iteration count, salt/IV bounds and algorithms, before performing
any password-based key derivation; malformed, weaker or attacker-inflated work
factors fail before key import. On NTFS the temporary and final local copy are
restricted to the current release-operator SID before encrypted bytes are
written. After the no-replace rename, Export reopens the final path, verifies
the exact encrypted bytes, decrypts that published file and repeats the identity
and sign/verify checks before reporting success. For an ACL-less FAT/exFAT
offline destination, `-AllowNonAclFileSystem` is an explicit opt-in; encryption
and all identity checks remain mandatory.

Restore on a disposable Windows account or clean VM before treating a copy as
recoverable:

```powershell
pwsh -NoProfile -File .\scripts\release\Restore-FluxoraUpdateSigningKeyBackup.ps1 `
  -InputPath 'D:\Fluxora-Key-Backups\fluxora-update-manifest-p256-2026-07-31.encrypted.pk8'
```

Restore bounds and single-handle reads the input, rejects reparse points and
trailing DER data, decrypts and verifies the complete key before any write,
requires an exact match with the committed public key, writes a new
current-user DPAPI blob with no-replace atomic semantics and reopens it for a
second sign/verify test. A matching existing DPAPI identity is an idempotent
no-op; a corrupt or different destination is never overwritten.

After a successful rehearsal, keep at least two encrypted copies in independent
locations and keep the password separately. Do not commit a backup, upload it
to GitHub/Supabase, place it next to the password, or treat the Export command
alone as proof that an offline copy exists.

### Protected Downloads data during build and update

`output/Downloads` is user data, not product payload. A clean root build preserves only that exact directory (case-insensitive on Windows), rejects a reparse-point/junction in its place, recreates it when absent and restores it even when a later build step fails. `Build.ps1` excludes the directory and every descendant from both `build/installer-cache/payload.manifest.json` and `FluxoraPayload.flxpkg.gz`; a release package must never contain a user archive or a Downloads directory entry.

The installer likewise rejects any package entry named `Downloads`, `logs` or
below either protected root. On a first install it creates the required real
directories. On update it rejects symbolic links, junctions and reparse points,
captures source-before/source-after inventories and SHA-256 values, and requires
the staged destination to match exactly before publishing the durable marker.
The same pair is revalidated after commit. A pre-commit failure leaves live data
untouched; rollback restores the old live directory from backup; watchdog or
RunOnce recovery restores an interrupted unconfirmed transaction even when the
live directory is temporarily absent.

## Tauri executable smoke builds

Tauri executable dry-run:

```powershell
cd frontend-tauri
npm run release:dry-run
```

When testing native payload packaging without the root installer:

```powershell
cd frontend-tauri
npm run build
```

These commands compile `frontend-tauri/src-tauri/target/release/Fluxora.exe` without producing NSIS/MSI packages. Do not enable Tauri bundling for Windows: only the ownership-aware `output-installer/FluxoraSetup.exe` is approved to register manager protocols.

## Artifact verification

Before a Phase 15 dry-run is accepted:

- `output-installer/FluxoraSetup.exe` exists.
- `output/Fluxora.exe` exists.
- `output/resources/native/FluxoraBridgeHost.exe` exists.
- `output/resources/native/FluxoraAIHost.exe` exists.
- `output/resources/native/FluxoraCore.dll` exists.
- `output/resources/native/FluxoraVfs.dll` exists for Windows builds; missing VFS is a release-blocking packaging error.
- `build/installer-cache/FluxoraPayload.flxpkg.gz` exists and its manifest hash
  is recorded in `build/installer-cache/payload.manifest.json`.
- `output/resources/native/FluxoraUpdater.exe` exists, while no
  `FluxoraInstallerCore.dll`, C# updater, WPF assembly or CLR-header executable
  is present in Setup or payload.
- `output/Downloads` exists after the build, and a pre-existing sentinel archive retains byte-identical contents.
- Neither `build/installer-cache/payload.manifest.json` nor the compressed installer package contains `Downloads`, a Downloads descendant or the sentinel.
- No portable staging folder, loose payload folder or ad-hoc zip is published.

Before a production auto-update release is accepted:

- The raw manifest verifies with the embedded stable-channel public key and a
  one-byte mutation fails verification.
- The manifest contains exactly one full package, every asset is present once in
  the draft release, and all byte sizes, SHA-256 values and target digests match.
- Every generated delta is tied to one signed prior base; synthetic
  add/replace/delete and Unicode/binary fixtures reconstruct the exact target.
- A disposable full-package apply and every delta apply produce the canonical
  target file-manifest digest; corrupt, truncated, traversal, reparse,
  case-collision and base-mismatch fixtures fail closed.
- Drain tests prove the `Open -> Draining -> Sealed` gate rejects new public
  work, permits only updater-owned final probes, and allows an active
  download/install to finish before exit. Updater launch failure keeps the old
  app open, and operation IDs remain correlated.
- Installer/update transaction tests cover pre-commit failure, post-commit
  rollback, forced termination at each durable marker, recovery on the next run,
  protected `Downloads`, automatic relaunch and old-version relaunch after
  rollback.
- The draft release is re-downloaded and verified before publication, and no
  portable staging tree, private key, resume file, transaction marker, local log
  or user data is attached.

## Legal and privacy checklist

Phase 15 reviewed these data-processing surfaces for German/EU transparency expectations:

- Tauri UI logs: local `fluxora-tauri-ui-YYYYMMDD.log`, no automatic upload.
- Tauri main/bridge logs: local `fluxora-tauri-main-bridge-YYYYMMDD.log`, no automatic upload.
- Native core, bridge, operation and crash logs: local files in the app log directory via `FLUXORA_LOG_DIR`; operation IDs and path/file metadata may appear.
- Installer UI/bridge/operation/crash logs: local files under the user's app data or temp path.
- Nexus Mods auth: optional user-triggered OAuth/API connection, tokens stored locally and disconnectable.
- ModdingFlow auth/API: optional browser-based Authorization Code + PKCE connection. The access and ID tokens remain in memory, only the rotating refresh token is stored under a namespaced Windows Credential Manager target, and disconnect removes local credentials even if remote revocation is unavailable. Profile/catalog/install-plan requests use the fixed production origin; signed download URLs never enter renderer state, settings, sidecars or logs.
- Nexus file update checks: when Nexus Mods is connected, complete installed Nexus mod/file identities may be checked automatically at most once per 24 hours or manually. File/version/category/update-link, quota and retry metadata is cached in %APPDATA%\Fluxora\nexus-update-cache.sqlite3; entries unused for 90 days are pruned. Descriptions, changelogs and credentials are excluded from this cache and from ModUpdates logs. The bundled de/en/ru privacy and terms text must describe this behavior.
- Fluxora application update checks: every launch performs a silent conditional
  request to the public GitHub Releases manifest/signature endpoints, then the
  running primary window repeats it every 15 minutes and when focus returns at
  least five minutes after the previous attempt; Settings also offers a manual
  retry. The request
  necessarily exposes network metadata such as the public IP address and normal
  HTTP/TLS headers to GitHub and its download infrastructure; it does not include
  project, mod, archive, account, AI, path, credential or log content. Only the
  check is automatic. Package download and installation require the user's click
  on the update action. Verified manifest/cache metadata, packages, backup state
  and update logs remain local under the retention/recovery rules documented in
  all bundled de/en/ru privacy and terms files.
- NXM protocol/deep links: local protocol links are captured when the user registers/uses Fluxora as handler.
- Neutral manager handoff: the emitted protocol contract is `moddingflow://download?v=1&artifact_id=<canonical-lowercase-uuid>`; Fluxora also reads the exact legacy `fluxora://moddingflow/download` form as a compatibility alias. Activations are bounded/deduplicated, require server revalidation and a separate in-app confirmation, and never carry OAuth material, bearer tokens or signed URLs. The release declares both deep-link schemes and the installer registers only Fluxora's owned per-user ProgID/capability without replacing the user's default handler. A clean-machine lifecycle smoke and wiring the ownership-checked unregister maintenance command into the distributed uninstaller remain open release gates.
- Downloads: archives are stored locally under `<installation folder>/Downloads/<gameId>` and shared by builds of that game. SHA-256 catalog identity and per-build install/link history are computed and stored locally. User-triggered network requests still go only to mod hosting URLs or Nexus Mods. FluxPack may automatically fetch Nexus sources only for a linked account whose native status is Premium; free-account flow opens the user-selected Nexus page and imports a user-selected local archive. The shared catalog adds no telemetry or automatic upload.
- Support logs: sent only when the user manually shares them.
- Telemetry/analytics: none is enabled in Phase 15. Adding it later requires explicit opt-in/legal review.
- Third-party components are derived from the production package-manager locks,
  `Cargo.lock`, resolved CMake dependency evidence and distributed asset
  manifests. Runtime-distributed components and build/test-only tools are kept
  separate; build/test dependencies are not described as shipped runtime code.

The single legal source lives under `legal/desktop/{en,de,ru}`. Setup and the
main Settings document viewer consume the same manifest and hash-pinned
documents. Final public distribution still requires owner and qualified German
legal review of the German original and translations.

## Open release gates

- A live draft-to-published GitHub Release smoke using the production account,
  followed by an unsigned-publisher/SmartScreen clean-machine install, a
  confirmed `0.0.0 -> 0.0.1` full update, an eligible prior-version delta
  update, operation-drain verification, automatic relaunch and rollback/recovery
  fault injection. Synthetic tests are required but do not replace this release
  acceptance.
- An owner/security signing-key backup restore and planned rotation rehearsal.
- Linux install smoke for `.deb` and `.rpm`, including xdg/NXM registration.
- macOS bundle URL scheme smoke, Developer ID signing and notarization.
- Final manual installer smoke on a clean machine.
- Final manual Nexus update smoke with a linked account: verify a silent build-open check, Latest file-version refresh, same-version/different-file update state, manual refresh, quota/backoff behavior, and no notification on the automatic path. Live Nexus calls remain excluded from CI.
- Final owner/legal review of privacy policy, terms and third-party notices.
- Final owner/legal review of the automatic GitHub Releases check, GitHub/CDN
  recipient and international-transfer wording, legitimate-interest assessment,
  retention/user controls and all three bundled translations.
- Final owner/legal review of the ModdingFlow account, OAuth retention, Public API/download and artifact-handoff disclosures in all bundled languages before any public feature flag is enabled.
