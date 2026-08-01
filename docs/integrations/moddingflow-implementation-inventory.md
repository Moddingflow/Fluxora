# ModdingFlow implementation inventory

This ledger records how the ModdingFlow integration is merged into an already dirty workspace. It is not a claim that every current diff belongs to this integration. Files that were modified before this work remain user-owned, and no reset, checkout, broad rewrite, commit, push, deployment, migration apply, secret mutation, or protocol registration is part of this implementation.

## Merge policy

| Shared area | Integration-owned change | Preserve/merge strategy |
| --- | --- | --- |
| `backend/CMakeLists.txt`, `backend/tests/CMakeLists.txt` | Add focused auth, API, remote-download, transport, log-redaction sources and tests | Re-read the live lists before every insertion; retain every unrelated target/source row |
| `backend/include/FluxoraCore/Core.hpp`, `backend/src/Core.cpp` | Feature-gated provider capability and authoritative connection restore | Keep existing service construction/order and unrelated WIP; no renderer-owned business logic |
| `backend/include/FluxoraCore/FluxoraCoreApi.hpp`, `backend/src/FluxoraCoreApi.cpp`, `backend/src/BridgeHost/FluxoraBridgeHost.cpp` | Private typed connection seam, metadata-only artifact preview, hash-bound activation-plan preview and managed queue seams | Keep the routes feature-gated, download-lane-only and blocked from generic renderer dispatch; preserve existing protocol methods and `operationId` behavior |
| `frontend-tauri/src-tauri/src/lib.rs` | Loopback/activation routing, capability publication, redacted Tauri logging | Add focused modules/commands and small registrations; preserve AI, media, NXM, window, and bridge WIP |
| `frontend-tauri/src/renderer/App.tsx` | Render one focused activation host | Do not add activation stores/coordinators to the master component; all orchestration lives under `features/moddingflow/` |
| `frontend-tauri/src/shared/fluxora-api.ts`, `frontend-tauri/src/tauri/fluxora-api.ts` | Token-free allowlisted DTOs and facade validation | Preserve all existing facade routes; never add renderer fetch, configurable origins, tokens, headers, or signed URLs |
| Settings renderer/state files | Generic provider status/action presentation | Preserve Nexus semantics and unrelated settings redesign WIP; provider row is absent while capability is off |
| Installer legal resources | EN/DE/RU disclosure drafts for browser OAuth, local credential storage, and API communication | Additive text only; legal-owner approval remains an external release gate |
| Website Public API/OpenAPI/SDK files | Profile contract and metadata/control-plane additions | Additive `/v1` contract with `/api/v1` alias; generated artifacts updated together; no production deploy |
| Website forum download files/locales | Guarded, neutral artifact-only manager handoff with no browser fallback | Preserve the separate protected manual-download behavior; server remains the sole authority for the eligible one-to-one artifact target |
| Supabase migrations/tests | Public-client reconciliation and bounded retention cleanup | New canonical migrations only; no remote apply, scheduler enablement, client retirement, or secret deletion |
| `graphify-out/` in both repositories | Generated graph updates | Dirty generated graph files are expected; refresh only after code/config stabilizes |

## Frozen identities and versions

- Product version stays at the current non-release value during local implementation. It is not changed to `0.1.0` until the approved installer passes the real production gates.
- `frontend-tauri/src-tauri/tauri.conf.json` is the packaging-time product-version source. `Build.ps1` rejects npm/Cargo drift and passes that value to CMake and the custom installer publish; the native bridge and ModdingFlow User-Agent consume the same value.
- The site handoff is independently versioned as `v=1`. The Website emits only `moddingflow://download?v=1&artifact_id=<uuid>` with a canonical UUID; Fluxora accepts `fluxora://moddingflow/download?v=1&artifact_id=<uuid>` only as a read-only legacy alias.
- The production OAuth/API/client/scope/loopback contract is frozen in [moddingflow.md](moddingflow.md).
- Account connection, catalog/download access and Website handoff rollout remain independent. `MODDINGFLOW_MANAGER_HANDOFF_ENABLED` is the Website rollout flag; `FLUXORA_HANDOFF_ENABLED` is accepted only as a deprecated alias for one transition deployment.
- Tauri bridge processes now carry an explicit lane identity. In packaged runtime, ModdingFlow auth, metadata and queue capability is registered only for `FLUXORA_BRIDGE_LANE=download`; an unset lane remains available only to direct native tests/C API fixtures. Generic renderer bridge dispatch denies the private OAuth, metadata and managed-queue methods.
- The production ModdingFlow capability owns the public catalog and install-plan resolver beside auth, artifact lookup and the API client. Activation is explicitly two-phase: the shell first revalidates the selected project/profile and game version and returns only aggregate counts, required disk size, conflict count and `planId`; the renderer must then confirm that exact `planId`. Accept resolves the hash-bound plan again through the private download lane, rejects a changed plan and every conflict, leaves optional dependencies off, and queues required steps in provider order with stable per-artifact job identities. Hashes, dependency identities, local paths and transport grants never enter the renderer summary. Controlled multi-gigabyte resume/failover remains an external Gate C rather than inferred from local harnesses.
- Tauri declares both the neutral `moddingflow` scheme and the legacy `fluxora` alias, initializes single-instance routing before deep-link handling, and routes cold, warm and second-instance input through one enabled strict activation inbox. The resulting artifact preview still requires trusted server revalidation, explicit local confirmation and a selected instance/profile before queueing.
- ModdingFlow Public API requests are anonymous first. Only account-scoped `401`/`403` responses may invoke the existing `desktop_mod_manager` PKCE flow and retry with bearer authorization; the handoff URI never transports Website session data, OAuth material, HTTP/signed URLs or other secrets.
- The custom installer has an ownership-scoped Fluxora ProgID/capability registration service plus explicit repair/unregister maintenance commands. It does not replace a foreign default handler. Automatic uninstall invocation is not yet wired, and no real Windows install/repair/uninstall or browser/third-party-manager E2E has been recorded, so Gate B remains open.

## Local implementation boundary

The local candidate may contain compiled, tested adapters while they remain undiscoverable and unreachable in the default build. A green mock/fake transport test is not production evidence. The following remain operator or hardware gates and must not be inferred from compilation:

- real browser consent/profile/refresh/reuse/revoke against production;
- Windows cold/warm/second-instance/no-handler/third-party-handler custom-scheme acceptance from the approved installer;
- install/repair/uninstall ownership acceptance, including preservation of a foreign default handler and the still-missing automatic uninstall hook;
- controlled multi-gigabyte interruption, expiry, resume, and failover;
- live Nexus regression acceptance;
- production migration dry runs, deployment, legacy-client disablement, scheduler activation, and secret retirement;
- legal-owner approval and the required stability window.

Evidence for those gates belongs in dated records following [moddingflow-production-evidence.md](moddingflow-production-evidence.md), with credential material omitted.
