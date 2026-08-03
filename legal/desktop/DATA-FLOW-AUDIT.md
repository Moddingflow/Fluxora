# Fluxora desktop code-to-policy data-flow audit

Audit date: 2 August 2026

Status: engineering and legal preparation only. This audit is not a final
legal opinion. A public release remains blocked until the operator verifies
the implementation facts and retention periods and a qualified German lawyer
reviews the German original and the English and Russian translations.

## Audit method

The audit follows data from the user or device through the renderer, the
allowlisted Tauri facade, the Rust shell, the native C++ core, local storage,
and each external destination. The public-facing result is
`legal/desktop/{en,de,ru}/privacy.md`; this file records the engineering
rationale and release questions that should not be placed in the user-facing
text.

The current policy deliberately distinguishes:

- local-only data from network transfers;
- the in-app automatic discovery check from its later update action, and both
  from the Setup Install action that expressly includes its post-install
  signed check, full-package download, installation, and restart;
- acceptance of the Terms of Use from acknowledgement that the Privacy Policy
  was read;
- runtime-distributed dependencies from build/test-only tools;
- data sent by Fluxora from ordinary connection metadata necessarily observed
  by an external provider.

## Data-flow matrix

| Flow | Trigger and data | Storage or retention | Recipient | Intended basis and user control | Policy location |
|---|---|---|---|---|---|
| Setup bootstrap and post-install update | Startup reads system locale and checks whether WebView2 is installed. Setup processes language, path, space, shortcut option, legal gates, existing-install ownership, one operation ID, progress and stable errors. The Install action covers install/repair/update of the bundled payload, then a signed stable check and, if newer, an automatic full-package download and isolated Updater handoff. | A durable per-user ownership record and integration state remain. A setup-origin installation has no signed update-inventory receipt until its first successful full update. Resumable package/verification data uses `%APPDATA%\Fluxora\updates`; transaction/recovery state remains until completion or recovery. Separate local logs have no automatic upload. | GitHub/CDN observes ordinary connection metadata for check/download; Microsoft only if WebView2 is missing and separately confirmed. | User-requested Install contract step, security, and transaction integrity. Cancel is available before handoff commit; check/download failure falls back to the bundled installation. | Privacy §§2–4, 8–12 |
| WebView2 bootstrap | Only after a native explanation and confirmation. Microsoft can observe IP address, request time, TLS/HTTP metadata and bootstrapper/device diagnostics. Fluxora does not add project, mod, account, chat, credential or log content. | Microsoft controls server-side retention. Fluxora keeps only local operation status and logs. | Microsoft and its delivery providers. | User-requested installation plus the disclosed external request. Decline is available; offline Setup works when WebView2 is already present. | Privacy §§3, 9–10 |
| Update discovery | Application startup, a 15-minute primary-window schedule, focus return after at least five minutes, and the authorised post-install Setup flow request the fixed public signed manifest and signature. The primary renderer also keeps a persistent Supabase WebSocket, listens only for stable public release rows, and snapshots after reconnect. GitHub and Supabase can observe ordinary IP, time and TLS/protocol metadata. The release row contains only GitHub release id, stable channel, version, tag and publication time; it is untrusted and only triggers the signed GitHub check. | At most the two newest verified local manifest-cache records, plus local operation logs. The release signal adds no account/project state and no telemetry store. | GitHub/content-delivery providers and Supabase infrastructure. | Security/compatibility legitimate interest and the Setup Install contract step, subject to counsel review. Background discovery does not download a package; the in-app package action remains optional. GitHub startup/focus/15-minute polling is the fallback. | Privacy §§4, 8–10 |
| Update package/install | The in-app update action or the already selected Setup Install action requests a public `.flxupd`, stages files, waits for its parent, records probation/health ACK, finalises or rolls back and restarts. Setup requires a full package and never selects a delta or downgrade. | Package, staging, backup, watchdog and recovery data are removed after normal completion; resumable or interrupted recovery data can remain until resolved. | GitHub/CDN for the package request; otherwise local processing. | User-requested contract step. Setup cancellation is available until handoff commit; in-app download/install still requires its update action. | Privacy §§4, 8–9, 11–12 |
| ModdingFlow account and downloads | PKCE sign-in in the system browser; account UUID/public profile/scopes/token expiry; rotating credential; catalogue, dependency, grant, job, artifact and short-lived transport identifiers. A confirmed external-reference download uses the server-validated provider/revision and connects directly to the named provider/CDN with ordinary connection metadata and bounded range requests, without a ModdingFlow token, provider credential or browser fallback. | Access/identity tokens and transport URLs in memory. Refresh credential in Windows Credential Manager until disconnect, invalidation, replacement or reset. Transfer sidecars retain stable provider/reference identifiers, expected size, SHA-256 and resume state, not the transport URL as durable identity. | ModdingFlow and its infrastructure; for external references, the named provider and its content-delivery host. | User-requested account, catalogue or download function after install-plan confirmation. Disconnect and credential removal controls are required. | Privacy §§5–6, 8–11 |
| Nexus Mods | Account tokens or API key, game domain, mod/file identifiers and requested operation. Optional MD5 fingerprint lookup excludes archive content, path and filename. | Protected local secret storage where available; update cache unused for 90 days is pruned. | Nexus Mods. | User-requested connection/API/download function. Disconnect, reset and cache controls are required. | Privacy §§5–6, 8–11 |
| AI and web research | Explicit prompt can include selected history/summary, provider/model metadata, typed capability declarations, limited excerpts and opaque file references. A research round can include the query and public sources. | Local chat/session data persists until deletion/reset; complete older rollback runs can be evicted by storage caps. Provider retention is external and must be confirmed. | Fluxora-managed gateway, Google/Gemini and their subprocessors; public-source providers during research. | Explicit requested function; minimise submitted personal/confidential data. Delete chat/checkpoints and avoid the feature. | Privacy §§5, 7–11 |
| Microphone and speech | Explicit short-lived permission and capture. Raw audio is processed locally by bundled Whisper/Silero components. A transcript is sent only if the user submits it as an AI request. | Temporary audio buffers; local models; transcript follows local chat retention and, if submitted, AI provider processing. | None for recognition; AI recipients only for a submitted transcript. | User action and local feature request. Stop capture, deny permission, review transcript, or do not submit it. | Privacy §§5, 7–11 |
| Settings, credentials, projects and downloads | Paths, language/theme, profiles, executable definitions, project/mod/archive metadata, inventories, hashes, install history and protected Downloads sidecars. | Local until item deletion, reset, uninstall of relevant data, or system cleanup. Credentials have flow-specific lifetimes. | None merely because data is stored locally. Connected features have the recipients listed above. | Requested desktop functionality; local deletion/reset/disconnect controls. | Privacy §§5–6, 8–12 |
| Logs and crash data | Separate Setup, Updater, UI, Rust shell/bridge, C++ core, operation and crash logs can include timestamps, operation IDs, phases, stable errors, filenames, paths, process information and diagnostics. | Local; current implementation has no automatic upload and no automatic deletion. User removes logs/application data or shares them deliberately. | None automatically; a recipient chosen by the user if shared for support. | Security, reliability and diagnostics. Open/reveal logs and deletion controls; paths can expose a Windows account name. | Privacy §§5, 8–12 |

## External-provider and transfer review

- GitHub's current privacy statement says processing can occur in the United
  States and other countries and describes recognised transfer mechanisms,
  including Standard Contractual Clauses. The exact release-time statement,
  provider role, CDN recipients and safeguards must be reconfirmed.
- Supabase provides the public release-signal database and WebSocket transport.
  Its hosting region, infrastructure subprocessors, role, connection-metadata
  retention and transfer safeguards must be confirmed before public release.
- Microsoft WebView2 delivery is a separate, disclosed download initiated only
  after confirmation when the runtime is absent. Microsoft terms and
  deployment documentation govern the bootstrapper.
- ModdingFlow infrastructure roles, subprocessors, hosting region, retention
  and controller/processor allocation require an owner-maintained register.
- Nexus Mods and Google/Gemini roles, terms, retention, regional processing
  and transfer safeguards require a release-time factual check.
- No automatic telemetry, log upload, crash upload, project upload, mod upload
  or AI-history upload was identified as an intended product flow. Any future
  implementation of one of those flows requires a policy, UI, legal-basis and
  retention update before release.

## Article 13 and German desktop-product checklist

- Controller identity and contact: present, subject to operator confirmation.
- Purposes, categories, recipients, intended legal bases, transfers, retention
  criteria, rights and complaint right: present, with unresolved provider facts
  explicitly gated.
- DDG section 5 operator information and VSBG section 36 statement: adapted to
  the desktop product in each Legal Notice and Terms document.
- TDDDG section 25: the policy states only the intended strictly-necessary
  analysis for requested local desktop storage; counsel must confirm it.
- BGB section 327f: Terms explain signed updates, user confirmation and the
  possible consequence of not installing a properly disclosed required update
  without overstating or waiving mandatory rights.
- The discontinued EU dispute platform is described without linking to its
  former submission endpoint.

## Blocking factual questions

The release must remain blocked until all of the following are answered and
reflected in all three languages:

1. Confirm the operator name, service address and both email contacts.
2. Confirm the exact ModdingFlow, Nexus and managed-AI subprocessors, hosting
   regions, roles, retention and transfer safeguards.
3. Confirm that current builds still perform no automatic telemetry, crash or
   log upload and that documented deletion/reset controls exist and work.
4. Confirm every stated retention rule against code and clean-machine
   acceptance, including the two-record update cache, 90-day Nexus pruning and
   AI rollback caps.
5. Confirm the German legal bases, legitimate-interest assessment,
   TDDDG analysis, consumer-dispute wording and update obligations with
   qualified German counsel.
6. Have the operator and counsel review the German original and the English and
   Russian translations, then record release approval outside this repository.

## Authoritative sources reviewed

- GDPR, including Article 13:
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679
- DDG section 5: https://www.gesetze-im-internet.de/ddg/__5.html
- VSBG section 36: https://www.gesetze-im-internet.de/vsbg/__36.html
- TDDDG section 25: https://www.gesetze-im-internet.de/ttdsg/__25.html
- BGB section 327f: https://www.gesetze-im-internet.de/bgb/__327f.html
- GitHub General Privacy Statement:
  https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
- European Commission notice that the former dispute platform was discontinued
  on 20 July 2025:
  https://consumer-redress.ec.europa.eu/site-relocation_en
- Microsoft WebView2 distribution guidance:
  https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Tauri WebView2 deployment guidance:
  https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options
- ModdingFlow operator source:
  https://www.moddingflow.com/impressum/?lang=en
