# ModdingFlow production evidence runbook

This runbook is an operator gate, not an automated rollout step. Keep `MODDINGFLOW_MANAGER_HANDOFF_ENABLED` off until the applicable desktop/Website evidence is reviewed. `FLUXORA_HANDOFF_ENABLED` is a deprecated alias permitted for one transition deployment only; do not use it for a new rollout. Never paste authorization codes, state, verifier, nonce, access/refresh/ID tokens, callback queries, signed URLs, cookies, credential blobs, email addresses, or stable account UUIDs into an evidence file.

## Evidence record

Create one dated record for each run and include only:

- Fluxora installer version and SHA-256;
- Website/API deployment version;
- UTC start/end timestamps;
- environment and OAuth client ID (`desktop_mod_manager` in production);
- redacted operation, request and trace IDs;
- each scenario result and duration;
- resulting safe connection/error state;
- log-scan result;
- reviewer and approval decision.

A failed or interrupted run remains evidence. Do not rewrite it as green; create a new record for the next candidate.

## Gate A: production OAuth proof

Keep `MODDINGFLOW_MANAGER_HANDOFF_ENABLED` and catalog downloads off. Use a dedicated test account and the approved installer.

1. Confirm discovery pins issuer `https://moddingflow.com`, S256, the apex token/revoke endpoints, and the expected JWKS URI.
2. Start Connect. Confirm Fluxora binds `127.0.0.1:<dynamic-port>` before opening the exact ModdingFlow authorization page.
3. Complete browser consent for exactly `openid profile:read mods:read files:download install_plans:resolve`.
4. Confirm the callback requires exact state and RFC 9207 `iss`, the ID token passes RS256/issuer/audience/nonce/time validation, and profile `user_id` matches `sub`.
5. Close and restart Fluxora. Confirm a single refresh restores the account and atomically rotates the Windows credential.
6. Exercise concurrent startup/API requests. Confirm they share one refresh and Nexus remains responsive.
7. Reuse a previously rotated refresh token only in the controlled server test. Confirm the family is revoked and Fluxora enters reauthentication-required without retrying the stale token.
8. Disconnect with the network available, then repeat with the network unavailable. Both runs must remove the local credential and memory-only tokens; remote revocation failure is reported without preventing local logout.
9. Scan UI, core, bridge, operation, download and crash logs for the forbidden material listed above. Any match is a release stop.

## Gate B: Windows activation proof

Run only after trusted metadata and confirmation UI are complete and the Windows scheme is present in the approved installer.

1. Test the exact canonical `moddingflow://download?v=1&artifact_id=<uuid>` URI, using a canonical UUID, with Fluxora closed, running, minimized and busy.
2. Confirm cold start, warm deep-link and second-instance sources converge on one activation inbox, duplicate launch events coalesce, and an explicit later retry is still possible.
3. Confirm the exact `fluxora://moddingflow/download?v=1&artifact_id=<uuid>` legacy alias is accepted by Fluxora, while the Website never emits it.
4. Reject wrong case, host/path, versions, duplicate/extra/encoded parameters, fragments, credentials, noncanonical UUIDs and inputs over 2 KiB.
5. Confirm public artifact metadata and download resolution are requested anonymously. For account-protected content, confirm only a `401`/`403` launches the `desktop_mod_manager` PKCE flow and the request is retried with bearer authorization after successful authentication.
6. Confirm no transfer starts before trusted native metadata is shown, an instance/profile is selected, and the user accepts.
7. Test unknown, deleted, unsafe, quarantined, ineligible and unsupported-game artifacts.
8. With no compatible handler registered, test the manager CTA in current Chrome, Edge and Firefox. Confirm the browser Downloads folder and browser file/network requests do not change and no HTTP, archive, direct or signed-URL fallback occurs. Confirm the separate manual button still uses its existing protected browser-download path.
9. Register a test third-party manager and select it as the Windows default. Confirm it receives the same canonical `moddingflow://` URI and Fluxora/the Website do not override that choice.
10. Install Fluxora while another handler is the default, repair Fluxora registration, and run the explicit unregister maintenance operation. Confirm Fluxora changes only its own ProgID/capability and does not replace or remove the foreign default. Record the automatic uninstall lifecycle as failed/pending until the approved uninstaller actually invokes the ownership-checked unregister path.
11. Re-run NXM cold/warm activation scenarios.

## Gate C: remote download proof

Use a controlled large immutable artifact and a controllable origin. Preserve only stable IDs, byte counts, expected hashes and nonsecret timings in evidence.

1. Interrupt a multi-gigabyte transfer, restart Fluxora, re-resolve the artifact, HEAD the new representation and resume with Range plus same-provider If-Match.
2. Expire the first signed grant mid-transfer. Confirm 401/403/410 causes grant re-resolution, not OAuth refresh.
3. Force a provider failover. Confirm a new HEAD occurs and the old provider ETag is never reused.
4. Exercise 206, Range-ignored 200, 416, changed ETag, DNS/redirect rejection, cancellation and crash-during-sidecar-write cases.
5. Confirm OAuth Authorization/Cookie headers never reach storage origins.
6. Confirm exact size and SHA-256 gates precede atomic final promotion and installer visibility. Hash mismatch, truncation and unsafe archive contents must not install.
7. Re-run existing Nexus download, resume, duplicate and install-source scenarios.

For each enabled `external_provider_reference` provider, repeat with a public free test artifact and record only nonsecret identifiers and hashes:

8. Confirm the resolve response has an exact provider/reference revision, short-lived provider transport, exact size/hash, current server attestation and truthful capability flags; stale, blocked, deleted, withdrawn or mismatched references must fail before a URL is returned.
9. Confirm Fluxora sends no OAuth/cookie header to the provider, never invokes Bunny/R2 or browser fallback, and performs no HEAD or `If-Match` when conditional requests are unavailable.
10. Interrupt once with Range support and once without it. The first run may resume from the hash-bound checkpoint; the second must restart from byte zero. Both must verify the final SHA-256 before atomic promotion.
11. Exercise provider `404`, `429` with `Retry-After`, `5xx`, redirect-to-private-address, size drift and hash drift. Freshness expiry and any identity drift must remain fail-closed.

## Rollout and rollback

Enable capabilities independently and in order: account connection for internal builds, catalog/download for alpha, deploy the strict Website manager flow with its button disabled, release the compatible installer and pass Gate B, then enable `MODDINGFLOW_MANAGER_HANDOFF_ENABLED` for a bounded beta cohort. The deprecated `FLUXORA_HANDOFF_ENABLED` alias may be read for the single transition deployment only and must not survive the next deployment. Stop on token leakage, browser fallback, default-handler takeover, resume corruption, unexplained hash mismatch, OAuth success below the agreed threshold, refresh-reuse spikes, Nexus regression, wrong-artifact handoff, or material API 5xx/429 regression.

Rollback disables the affected switch without deleting locally verified archives or changing Nexus behavior. Retention scheduling, legacy-client disablement, legacy redirect retirement, and secret deletion are separate reversible operator changes. Each requires a fresh dry run or usage audit immediately before execution; none is performed by the desktop build.
