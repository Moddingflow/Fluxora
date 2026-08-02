# Privacy Policy

Effective date: 2 August 2026

Engineering review status: this document is a release candidate, not final legal advice. Public distribution is blocked until the operator has confirmed the facts and a qualified German lawyer has reviewed the German original and the English and Russian translations.

## 1. Controller and contact

The controller for processing performed by Fluxora is:

Valerii Semenov / Валерий Семёнов<br>
c/o Autorenglück #61208<br>
Albert-Einstein-Straße 47<br>
02977 Hoyerswerda<br>
Germany

Email: moddingflow@gmail.com<br>
Legal contact: legal@moddingflow.com

## 2. Scope and product design

This policy covers Fluxora Setup, Fluxora Updater, the Fluxora desktop application, its Rust/Tauri native shell, the native C++ core, and the optional online integrations described below.

Fluxora is designed primarily as a local desktop application. The product does not include advertising analytics, behavioural tracking, or an automatic upload of logs or crash reports. Local application state is not sent to the operator merely because it is stored on the device. Network processing occurs for automatic release discovery and when you request another online feature.

The Windows renderer uses the Microsoft Edge WebView2 Runtime installed on the system. Fluxora does not ship a separate portable browser. The renderer is restricted to product UI and does not provide general browser-history collection.

## 3. Setup, WebView2, installation, repair, and removal

Setup processes the system locale, selected UI language, installation path, free-space result, shortcut choice, accepted Terms of Use, acknowledgement that the Privacy Policy was read, existing-installation ownership information, progress, stable error codes, and one operation identifier. Selecting Install authorises Setup to install or repair the bundled payload and then automatically check for and, when available, download and apply the latest signed stable Fluxora release. It creates a per-user installation, normally under `%LOCALAPPDATA%\Programs\Fluxora`, a durable per-user installation-ownership record, optional desktop shortcut, per-user protocol registration, and separate local installer, update, Updater, and operation logs. A setup-origin installation initially has no signed update-inventory receipt, so this first post-Setup update uses the signed full package; the first successful update establishes the signed receipt used to qualify later exact-version deltas.

Accepting the Terms of Use and acknowledging that this policy was read are separate actions. The privacy acknowledgement is not described or used as consent to all processing.

If WebView2 is unavailable, Setup shows a native explanation before any web UI is created. Only after confirmation does Setup start the embedded official Microsoft Edge WebView2 Evergreen Bootstrapper. The bootstrapper connects to Microsoft to obtain the architecture-appropriate runtime. Microsoft and its delivery providers can receive ordinary connection data such as IP address, request time, HTTP/TLS metadata, device or operating-system information made available by the bootstrapper, and download diagnostics. Fluxora does not add project, mod, account, chat, credential, or log content to that request. An offline Fluxora installation remains possible when a suitable WebView2 Runtime is already present.

Repair and removal inspect the durable ownership record, installed executable and current Windows integration state, together with the signed update-inventory receipt when one exists, before changing shortcuts or `moddingflow://` registration. Transaction staging, backup, watchdog, RunOnce recovery, and rollback records are retained only while required to finish or recover the operation, except where a failed recovery must be resumed.

## 4. Automatic update discovery, Setup authorisation, and in-app installation

At application startup Fluxora requests the public signed update manifest and signature from the fixed Fluxora assets on GitHub Releases. While the primary application window remains running, Fluxora repeats the check every 15 minutes and when that window regains focus if at least five minutes have passed since the preceding check. These checks do not require a GitHub account. GitHub and its delivery providers receive ordinary connection data, including the public IP address, request time, TLS and HTTP headers, and network/device data inferred by GitHub. Conditional request validators (`ETag` and `Last-Modified`) and the two newest verified manifest cache records may be stored locally. If the startup check fails with a retryable error, Fluxora makes up to two further automatic background attempts after short delays; those attempts disclose the same ordinary connection data. A missing first-release manifest is treated as retryable so a running application can recover after the first release appears.

The primary renderer also keeps a persistent Supabase WebSocket connection to the fixed public Fluxora release project. It subscribes only to stable release insert/update signals and requests the latest stable snapshot after every connection or reconnect. Supabase and its infrastructure providers receive ordinary connection data, including the public IP address, connection times, and TLS/WebSocket protocol metadata. The public release metadata contains only the GitHub release identifier, stable channel, version, tag, and publication time; it contains no telemetry, account, project, mod, archive, or AI data. A signal is untrusted and can only trigger the same signed GitHub manifest check; it cannot expose the update action by itself. GitHub startup, focus, and 15-minute polling remains the fallback if Realtime delivery is late or unavailable.

After a successful Setup install, repair, or update, Setup performs the same signed check as part of the Install action. If a newer stable version exists, Setup automatically downloads the signed full package from GitHub Releases, stores resumable package and verification data under `%APPDATA%\Fluxora\updates`, and hands it to the isolated Updater. If the check or download fails, Setup starts the successfully installed bundled version and Fluxora can check again through its automatic schedule. GitHub and its delivery providers receive the ordinary connection metadata described above. Fluxora adds no project, mod, archive, account, AI-chat, credential, log, signature, or authorisation-header content to those requests, and this flow adds no telemetry.

Outside Setup, background discovery only identifies an available update. The package is downloaded, installed, and followed by a restart only after you choose the in-app update action.

Fluxora verifies the manifest signature and file/package hashes. Full and delta packages, manifests, signatures, and inventories are machine-consumed public release data, not executable portable distributions. Local staging, backup, health acknowledgement, rollback, and recovery data are used to make the requested update reliable.

## 5. Data processed locally

Depending on the features used, Fluxora can process or store locally:

- installation path, installed version, durable ownership record, signed update-inventory receipt when established, shortcuts, protocol ownership, recovery state, and operation identifiers;
- language, theme and application settings, selected game and tool locations, project and profile configuration, plugin order, executable definitions, and other preferences;
- project names, build folders, mod folders, game paths, archive metadata, download entries, imported manager data, local file inventories, hashes, conflict information, deployment state, and installation history;
- archives and sidecar records in the protected `Downloads` tree, including source identifiers, expected size, SHA-256, resumable-transfer state, and install results;
- ModdingFlow profile and connection state, and Nexus Mods connection state, as described below;
- AI chat tabs, structured continuation summaries, opaque file references, requested text excerpts, tool events, sources, run and operation identifiers, and local rollback checkpoints when AI features are used;
- microphone permission state, temporary audio buffers, local speech models, and the transcript produced by local recognition when voice input is used;
- separate installer, updater, UI, Rust shell/bridge, native core, operation, and crash logs. Logs can contain timestamps, operation identifiers, phases, errors, file names, selected paths, process information, and diagnostics. A path can indirectly contain the Windows account name.

Fluxora does not intentionally collect payment-card data, advertising identifiers, address books, precise location, camera content, or general browser history.

## 6. Credentials and account integrations

### ModdingFlow

When you connect a ModdingFlow account, Fluxora uses an authorization-code flow with PKCE in the system browser. The temporary verifier, state, and nonce exist only for the pending sign-in. The application can receive a stable account UUID, public profile fields, granted scopes, token expiry, and tokens needed for the connection. Access and identity tokens are kept in process memory. The rotating refresh credential is stored under a Fluxora-specific target in Windows Credential Manager and is removed when you disconnect or when the server confirms that it is invalid.

When you browse the ModdingFlow catalogue, resolve an installation plan, or request a download, Fluxora sends the identifiers and parameters required for that action. It can receive game, mod, version and artifact identifiers, dependency results, grants, job identifiers, expiry, byte size, hashes, and short-lived signed transport URLs. A signed transport URL is used in memory for the requested transfer and is not treated as durable file identity.

### Nexus Mods

When you connect Nexus Mods, Fluxora can process a display name, user identifier, token type and expiry, OAuth access/refresh tokens, or a personal API key. Persistent secret values are protected with Windows data-protection facilities where available. The application sends the game domain, relevant mod/file identifiers, and requested API operation to Nexus Mods.

If an archive has no stable source identifier, Fluxora can send its MD5 fingerprint and the selected Nexus game domain to request an unambiguous mod/file match. It does not send the archive contents, local path, or local filename for that lookup. Installed Nexus file identifiers can be checked for updates no more than once in a 24-hour period and again when you request a refresh. Returned version, availability, timestamp, quota, and retry metadata can be cached locally. Cache records not used for 90 days are pruned.

## 7. AI, web research, and voice input

AI functions are optional and run only when you use them. A request can include the message you submit, the selected chat history or a structured continuation summary, the unfinished goal or clarification state, provider/model metadata, typed capability declarations, compact selected-build metadata, and limited text excerpts that the requested task needs. Fluxora uses opaque references and relative paths where possible and does not grant the model arbitrary filesystem or shell access.

Managed AI requests can pass through a Fluxora-managed gateway and then to Google/Gemini. If public web research is requested, the provider can process the search query and public sources in a separate web-research round. Provider responses and grounding sources are treated as untrusted input and cannot by themselves authorize a local change. The provider and its subprocessors can process data outside the EU/EEA under their own privacy terms and transfer safeguards.

Voice capture requires an explicit user action and a short-lived permission gate. Audio is processed locally by bundled Whisper and Silero VAD components. Raw microphone audio is not uploaded by the speech function. Only a transcript that you choose to submit becomes part of an AI request.

Do not include unnecessary personal data, secrets, third-party confidential information, or special-category data in AI prompts, imported text, filenames, or support material.

## 8. Logs, crash data, cache, and retention

Logs and crash diagnostics remain local unless you choose to share them. Current builds do not automatically upload them and do not impose automatic log deletion; they remain until you remove them, reset the application, uninstall relevant application data, or a system cleanup removes them.

Settings, projects, profiles, archives, download history, sidecars, and AI sessions remain until you delete the related item, reset the application, or remove the relevant application data. Closing or deleting an AI chat removes it from the Fluxora AI session store; explicit reset actions remove the corresponding local rollback checkpoints. Storage caps can evict complete older rollback runs.

Access and identity tokens held only in memory are discarded when the relevant process ends. A stored refresh credential remains until disconnect, invalidation, replacement, reset, or removal of the relevant Windows credential. Update download, staging, backup, watchdog, and recovery data are removed after a normal successful completion; interrupted recovery material can remain until recovery succeeds or you remove it after Fluxora has stopped. The update manifest cache keeps at most the two newest verified records. Nexus update-cache records unused for 90 days are pruned.

Third-party services determine their own server-side retention. Consult their privacy statements and account controls.

## 9. Purposes and legal bases

Subject to confirmation by German legal counsel, the intended legal bases under Article 6 GDPR are:

- Article 6(1)(b): installation, operation, requested update installation, requested account connection, downloads, AI responses, and other functions needed to provide the user-requested software service;
- Article 6(1)(f): security, integrity verification, local diagnostics, abuse prevention, reliable recovery, and the limited automatic update checks described above. The legitimate interests are maintaining a secure and compatible application and diagnosing failures;
- Article 6(1)(a): only where a specific optional flow expressly asks for consent and identifies the processing covered by it. Consent can be withdrawn for the future without affecting earlier lawful processing;
- Article 6(1)(c): processing required by an applicable legal obligation.

The local storage and access needed to provide explicitly requested desktop functionality is intended to fall within the strictly necessary exception in section 25(2) TDDDG. Fluxora does not use local storage for advertising tracking. This assessment is part of the mandatory legal review.

## 10. Recipients and international transfers

Depending on the action, recipients can include Microsoft for WebView2 delivery; GitHub and its content-delivery providers for update checks and downloads; Supabase and its infrastructure providers for the public release-signal WebSocket and snapshot; ModdingFlow and its infrastructure providers for account, catalogue, API, and download functions; Nexus Mods for its account and API functions; Google/Gemini and the managed AI gateway for submitted AI requests and web research; and a download host or website that you expressly open.

These providers act under their own terms and privacy notices. GitHub states that it can process data in the United States and other countries and generally relies on recognised transfer mechanisms such as the EU Standard Contractual Clauses for transfers to locations without an adequacy decision. The exact roles, providers, and safeguards must be confirmed before public release.

Fluxora does not sell personal data. It does not automatically send telemetry, logs, crash files, projects, mods, or AI histories to the operator.

## 11. Your choices and rights

You can decline the WebView2 download, cancel Setup's post-install check or download before the updater handoff commit (the bundled installation then starts), decline an available in-app update, disconnect optional accounts, avoid or stop AI and microphone features, delete chats and checkpoints, remove projects and caches, clear credentials, and uninstall the application.

Where the GDPR applies and its conditions are met, you may have rights of access, rectification, erasure, restriction, data portability, objection, and withdrawal of consent. Because most Fluxora data is local, many controls are exercised directly on your device. For controller-held data or questions, use the contacts in section 1.

You may complain to a competent data-protection supervisory authority, particularly in the EU Member State of your habitual residence, workplace, or the alleged infringement.

## 12. Security

Fluxora uses signed manifests and packages, bounded native interfaces, ownership checks, per-user Windows credential protection, local access controls, allowlisted network destinations, and transaction recovery. No technical measure eliminates all risk. Protect the Windows account, backups, game data, credentials, and installation directory, and obtain Fluxora only from the official channel.

## 13. Authoritative review sources

The engineering review used:

- GDPR Article 13 and related provisions: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679
- TDDDG section 25: https://www.gesetze-im-internet.de/ttdsg/__25.html
- GitHub General Privacy Statement: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
- Microsoft WebView2 distribution guidance: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Tauri WebView2 deployment guidance: https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options

Third-party statements can change. Their current terms apply when you use the corresponding service.
