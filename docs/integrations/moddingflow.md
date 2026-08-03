# ModdingFlow integration contract

This document is the implementation contract for the native ModdingFlow integration. It is intentionally stricter than a generic OAuth or download client because the application is a public desktop client and signed storage URLs are bearer-like capabilities.

The dirty-worktree merge ledger and version decision are recorded in the [implementation inventory](moddingflow-implementation-inventory.md).

## Ownership

- The C++ core owns OAuth/OIDC validation, access-token refresh, Public API calls, catalog and install-plan parsing, remote download resolution, integrity checks, and provider state.
- The Tauri Rust shell owns the temporary loopback listener, browser launch, application lifecycle, single-instance/deep-link activation routing, and the dedicated action that opens Windows default-app settings.
- The approved custom installer owns Fluxora's per-user `moddingflow` ProgID/capability registration and its narrowly scoped repair/unregister maintenance operations. It must not choose the default handler for the user.
- The renderer receives only typed connection, catalog, progress, and activation DTOs. It must never receive OAuth transactions, tokens, authorization or callback URLs, arbitrary headers, signed storage URLs, or configurable production origins.
- ModdingFlow and Nexus use independent provider adapters and failure domains. Provider-specific behavior must not become conditionals spread through renderer or download orchestration.
- Every Tauri bridge child is tagged with `FLUXORA_BRIDGE_LANE`. The production ModdingFlow capability is composed only in the `download` child, and trusted OAuth, artifact-preview, restore, and managed-queue calls are pinned to that child. This keeps rotating refresh-token ownership, resolver state, and the download queue in one process while the generic connection lane continues to own Nexus.

## Frozen production contract

| Property | Value |
| --- | --- |
| OAuth issuer | `https://moddingflow.com` |
| Public API base | `https://moddingflow.com/v1` |
| Client ID | `desktop_mod_manager` |
| Client authentication | public client, `none`, no client secret |
| Authorization flow | authorization code with PKCE S256 |
| Loopback callback | `http://127.0.0.1:<dynamic-port>/oauth/fluxora/callback` |
| Scopes | `openid profile:read mods:read files:download install_plans:resolve` |
| Site handoff | `moddingflow://download?v=1&artifact_id=<uuid>`; the UUID must be canonical |
| Legacy input alias | `fluxora://moddingflow/download?v=1&artifact_id=<uuid>`; accepted by Fluxora only, never emitted by the Website |
| Public API authorization | anonymous first; retry with OAuth bearer only after an account-scoped `401` or `403` |

The loopback listener binds before the authorization URL is created. Callback success and error responses both require an exact state and the RFC 9207 issuer value `https://moddingflow.com`. ID tokens accept only RS256 and require a valid signature, issuer, audience, subject, nonce, issued-at, and expiry. An unknown key ID permits one bounded JWKS refresh and no algorithm or key-source fallback.

Access and ID tokens are memory-only. Only the rotating refresh token is persisted, under a production/environment/client-specific Windows Credential Manager target. Renderer storage, settings files, operation payloads, and logs are not credential stores.

The handoff URI is deliberately provider-neutral and nonsecret. It carries only the protocol version and an opaque canonical artifact UUID. The Website session, OAuth transactions or codes, bearer tokens, signed URLs, HTTP URLs, headers, cookies, filenames, local paths, and install instructions must never enter the URI. The Website emits only the canonical `moddingflow://` form; `fluxora://moddingflow/download` is a read-only compatibility alias for older links.

## Download invariants

- Durable state contains stable provider, artifact, mod, version, job and grant identifiers plus expected size/hash and representation metadata. It never contains a signed URL.
- Artifact metadata, install-plan and download-resolution control-plane requests start anonymously. Only an explicit account-scoped `401` or `403` may start the existing `desktop_mod_manager` Authorization Code + PKCE S256 flow and retry the request with a bearer token. Transport failures, malformed responses and every other status fail closed.
- The resolver accepts exactly two server-owned logical transports. `rehosted_blob` (the backward-compatible resolve payload still identifies its artifact source as `r2_blob`) preserves the existing R2/Bunny session, HEAD, Range, validator and fallback behavior. `external_provider_reference` accepts only the reviewed GitHub, Modrinth, Hangar, Codeberg and gated mod.io representation providers, and only when the response binds the provider reference to exact size, SHA-256, fresh server scan evidence and a short-lived URL.
- A resumed managed-blob transfer re-resolves the stable artifact and performs a fresh HEAD before sending a Range request. Range append requires a compatible same-provider representation validator; an ETag is never reused across failover providers.
- An external-reference response must advertise `fallback.available=false`, no fallback URL/endpoint, no conditional-request capability and truthful HEAD/Range/resume flags. Fluxora never asks the fallback resolver for this transport. When Range is supported, a partial transfer is bound to the server-attested content SHA-256 and resumed without fabricating `If-Match`; when Range is unsupported, the partial is discarded and the next grant starts from byte zero.
- Signed transport accepts HTTPS destinations without credentials or fragments, revalidates every redirect and DNS result, and rejects loopback, private, link-local, and otherwise non-public destinations.
- OAuth bearer and cookie headers are never forwarded to a storage origin.
- Both transport kinds share the same final trust boundary: the archive is not promoted from its partial path until exact size and SHA-256 verification pass. A changed external representation therefore deletes the partial instead of becoming installer-visible. Existing archive/path-safety and malware eligibility checks remain mandatory.
- Site-activation queue requests use a deterministic, domain-separated UUID derived from the artifact and exact local instance/profile choice. Replaying an ambiguous accept response therefore reuses the same native manifest instead of creating a second grant or worker.

## Activation invariants

The site may pass only handoff version 1 and one canonical artifact UUID. Unknown, duplicate, additional, encoded-confusion, oversized, or non-canonical inputs are rejected before renderer delivery. Canonical `moddingflow://` input and the exact legacy alias converge on the same bounded, deduplicating activation inbox. The inbox is enabled for cold-start arguments/current deep links, warm `on_open_url` events, and second-instance arguments; single-instance routing is initialized before deep-link handling.

An activation is a nonsecret request to show trusted metadata. It never authorizes or starts a download. Fluxora re-fetches the artifact through the native provider; account-protected metadata may offer the existing OAuth connection flow after `401`/`403` and retry only after successful authentication. Fluxora then requires explicit local user confirmation and instance/profile selection before the ordinary download pipeline is invoked. Accept re-fetches metadata again, re-lists the selected project and its provider-specific game aliases, re-lists the exact profile, and passes only stable artifact/mod/version/job identifiers into the native queue. Renderer metadata and renderer-selected paths are never authoritative.

The manager flow is fail-closed end to end. Fluxora never converts it into a browser download, HTTP navigation, new-tab action, archive/direct target, or signed-URL fallback. If no compatible handler is selected, the Website attempt remains only a handoff attempt; the user can select/install a compatible manager or use the separate manual-download control.

## Windows association boundary

- Fluxora registers its own per-user ProgID and application capability for the neutral `moddingflow` scheme. It may advertise itself through Open With/default-app UI, but it does not overwrite an existing scheme default.
- Windows and the user decide which compatible manager is the default handler. Neither the Website, a mod author, nor Fluxora silently assigns that choice.
- Repair may recreate only Fluxora-owned registration values. It must not modify another manager's ProgID, command, capability, or current default.
- Unregister removes Fluxora's entries only when the recorded owner and executable path match the installation being removed. A foreign or moved registration fails closed.
- The maintenance repair/unregister commands provide the ownership-safe boundary, but the approved installer does not yet invoke unregister from an automatic uninstall lifecycle. That hook and real install/repair/uninstall/default-handler acceptance remain release gates, not completed evidence.

## Rollout switches

The account/catalog capabilities and the Website handoff rollout remain independently controlled:

- `moddingflow_account_connection`
- `moddingflow_catalog_download`
- `MODDINGFLOW_MANAGER_HANDOFF_ENABLED` on the Website

The activation inbox and strict parser may be enabled in the desktop build without enabling the Website button because receiving an artifact ID cannot start a transfer. The account provider is not advertised when its native adapter is not registered. The Website continues to expose the separate protected manual-download path while manager handoff is disabled.

`FLUXORA_HANDOFF_ENABLED` is a deprecated Website alias for exactly one transition deployment. During that deployment the new flag is authoritative when present; the alias exists only to avoid an accidental rollout regression and must be removed after the transition. Neither flag permits an HTTP/browser fallback.

Rollout order is: deploy the strict Website flow with the manager button disabled; release the compatible Fluxora installer and pass the Windows lifecycle gate; then enable `MODDINGFLOW_MANAGER_HANDOFF_ENABLED` for a bounded cohort. No production OAuth client mutation, secret removal, retention scheduling, default-handler takeover, or release-policy promotion is implied by compiled desktop support.

## Release gates

Automated tests must cover native OAuth/OIDC, credential rotation and races, strict HTTP parsing, provider isolation, catalog pagination, install-plan idempotency, durable resume/failover/integrity, Rust loopback and activation routing, renderer DTO boundaries, Website handoff safety, and database retention permissions. The full repository build must produce only the approved installer at `output-installer/FluxoraSetup.exe`.

Production enablement additionally requires evidence from a real browser-based consent/profile/refresh/reuse/revoke cycle; Windows cold/warm/second-instance activation; no-handler and third-party-handler behavior; install/repair/uninstall ownership; managed and external interrupted multi-gigabyte runs; provider withdrawal/staleness behavior; Nexus regression acceptance; forbidden-secret log review; the agreed stability window; and legal-owner review. These live Windows and production E2E scenarios have not been established by the local automated implementation. Follow the separate [production evidence runbook](moddingflow-production-evidence.md) without recording credential material. Legacy clients, redirects, and secrets are retired only after a fresh usage audit and remain operational decisions outside the build.
