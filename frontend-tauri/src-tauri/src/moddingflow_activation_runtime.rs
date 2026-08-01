use crate::moddingflow_activation::{
    parse_fluxora_activation, FluxoraActivationCapture, FluxoraActivationInbox,
    FluxoraActivationInboxError, FluxoraActivationItem, FluxoraActivationSource,
};
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub(crate) const MODDINGFLOW_ACTIVATION_CAPTURED_EVENT: &str =
    "fluxora:moddingflow:activation-captured";
pub(crate) const MODDINGFLOW_ACTIVATION_FEATURE_ENABLED: bool = true;
const MAX_RECENT_ARTIFACTS: usize = 128;
const RECENT_ARTIFACT_DEDUPE_WINDOW_MS: u64 = 5_000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeModdingFlowActivation {
    pub(crate) v: u8,
    pub(crate) artifact_id: String,
}

impl From<&FluxoraActivationItem> for SafeModdingFlowActivation {
    fn from(item: &FluxoraActivationItem) -> Self {
        Self {
            v: item.version,
            artifact_id: item.artifact_id.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct ActivationRouteReport {
    pub(crate) disabled: bool,
    pub(crate) queued: usize,
    pub(crate) duplicates: usize,
    pub(crate) rejected: usize,
    pub(crate) full: usize,
    pub(crate) delivered: usize,
}

#[derive(Default)]
struct ActivationRuntimeInner {
    inbox: FluxoraActivationInbox,
    renderer_ready: bool,
    recent_artifacts: VecDeque<RecentArtifact>,
    in_flight_activation_ids: HashSet<String>,
}

struct RecentArtifact {
    artifact_id: String,
    captured_at_ms: u64,
}

pub(crate) struct ModdingFlowActivationRuntimeState {
    enabled: bool,
    inner: Mutex<ActivationRuntimeInner>,
    now_millis: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl Default for ModdingFlowActivationRuntimeState {
    fn default() -> Self {
        Self::new(MODDINGFLOW_ACTIVATION_FEATURE_ENABLED)
    }
}

impl ModdingFlowActivationRuntimeState {
    pub(crate) fn new(enabled: bool) -> Self {
        let started = Instant::now();
        Self::new_with_clock(
            enabled,
            Arc::new(move || started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)),
        )
    }

    fn new_with_clock(enabled: bool, now_millis: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self {
            enabled,
            inner: Mutex::new(ActivationRuntimeInner::default()),
            now_millis,
        }
    }

    #[cfg(test)]
    pub(crate) fn enabled(&self) -> bool {
        self.enabled
    }

    pub(crate) fn capture_args<I, S, F>(
        &self,
        args: I,
        source: FluxoraActivationSource,
        mut deliver: F,
    ) -> ActivationRouteReport
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
        F: FnMut(&SafeModdingFlowActivation) -> bool,
    {
        if !self.enabled {
            return ActivationRouteReport {
                disabled: true,
                ..ActivationRouteReport::default()
            };
        }

        let mut report = ActivationRouteReport::default();
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        for arg in args {
            let value = arg.as_ref();
            if !is_fluxora_activation_candidate(value) {
                continue;
            }

            let parsed = match parse_fluxora_activation(value) {
                Ok(parsed) => parsed,
                Err(_) => {
                    report.rejected += 1;
                    continue;
                }
            };
            let now_millis = (self.now_millis)();
            prune_expired_recent_artifacts(&mut inner, now_millis);
            if inner
                .recent_artifacts
                .iter()
                .any(|recent| recent.artifact_id == parsed.artifact_id)
            {
                report.duplicates += 1;
                continue;
            }

            match inner.inbox.capture(value, source) {
                Ok(FluxoraActivationCapture::Queued(item)) => {
                    remember_recent_artifact(&mut inner, item.artifact_id.clone(), now_millis);
                    report.queued += 1;
                }
                Ok(FluxoraActivationCapture::Duplicate { .. }) => {
                    report.duplicates += 1;
                }
                Err(FluxoraActivationInboxError::Full) => {
                    report.full += 1;
                }
                Err(FluxoraActivationInboxError::Parse(_)) => {
                    report.rejected += 1;
                }
                Err(_) => {
                    report.rejected += 1;
                }
            }
        }

        let deliveries = claim_pending_deliveries(&mut inner);
        drop(inner);

        for item in deliveries {
            let safe = SafeModdingFlowActivation::from(&item);
            let delivered = deliver(&safe);
            let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            if !inner.in_flight_activation_ids.remove(&item.activation_id) {
                continue;
            }
            if delivered && inner.inbox.remove_for_delivery(&item.activation_id) {
                report.delivered += 1;
            }
        }
        report
    }

    pub(crate) fn consume_pending(&self) -> Vec<SafeModdingFlowActivation> {
        if !self.enabled {
            return Vec::new();
        }
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner.renderer_ready = true;
        let pending = inner
            .inbox
            .snapshot()
            .into_iter()
            .filter(|item| !inner.in_flight_activation_ids.contains(&item.activation_id))
            .collect::<Vec<_>>();
        for item in &pending {
            inner.inbox.remove_for_delivery(&item.activation_id);
        }
        pending
            .iter()
            .map(SafeModdingFlowActivation::from)
            .collect()
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .inbox
            .snapshot()
            .len()
    }
}

fn is_fluxora_activation_candidate(value: &str) -> bool {
    let candidate = value.trim_start_matches(|character: char| {
        character.is_ascii_whitespace() || matches!(character, '"' | '\'')
    });
    candidate
        .get(..12)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("moddingflow:"))
        || candidate
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("fluxora:"))
}

fn claim_pending_deliveries(inner: &mut ActivationRuntimeInner) -> Vec<FluxoraActivationItem> {
    if !inner.renderer_ready {
        return Vec::new();
    }

    let deliveries = inner
        .inbox
        .snapshot()
        .into_iter()
        .filter(|item| !inner.in_flight_activation_ids.contains(&item.activation_id))
        .collect::<Vec<_>>();
    inner
        .in_flight_activation_ids
        .extend(deliveries.iter().map(|item| item.activation_id.clone()));
    deliveries
}

fn prune_expired_recent_artifacts(inner: &mut ActivationRuntimeInner, now_millis: u64) {
    while inner.recent_artifacts.front().is_some_and(|recent| {
        now_millis >= recent.captured_at_ms
            && now_millis - recent.captured_at_ms >= RECENT_ARTIFACT_DEDUPE_WINDOW_MS
    }) {
        inner.recent_artifacts.pop_front();
    }
}

fn remember_recent_artifact(
    inner: &mut ActivationRuntimeInner,
    artifact_id: String,
    captured_at_ms: u64,
) {
    while inner.recent_artifacts.len() >= MAX_RECENT_ARTIFACTS {
        inner.recent_artifacts.pop_front();
    }
    inner.recent_artifacts.push_back(RecentArtifact {
        artifact_id,
        captured_at_ms,
    });
}

#[tauri::command]
pub(crate) fn fluxora_moddingflow_consume_activations(
    state: tauri::State<'_, ModdingFlowActivationRuntimeState>,
) -> Vec<SafeModdingFlowActivation> {
    state.consume_pending()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::moddingflow_activation::{MAX_ACTIVATION_BYTES, MAX_INBOX_ITEMS};
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;

    const ARTIFACT_ID: &str = "01234567-89ab-4cde-8fab-0123456789ab";

    fn activation(artifact_id: &str) -> String {
        format!("moddingflow://download?v=1&artifact_id={artifact_id}")
    }

    fn legacy_activation(artifact_id: &str) -> String {
        format!("fluxora://moddingflow/download?v=1&artifact_id={artifact_id}")
    }

    fn artifact_id(index: usize) -> String {
        format!("00000000-0000-4000-8000-{index:012x}")
    }

    #[test]
    fn explicitly_disabled_capture_has_no_side_effects() {
        let state = ModdingFlowActivationRuntimeState::new(false);
        let report = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::Startup,
            |_| panic!("disabled capture must not deliver"),
        );
        assert_eq!(
            report,
            ActivationRouteReport {
                disabled: true,
                ..ActivationRouteReport::default()
            }
        );
        assert_eq!(state.pending_count(), 0);
        assert!(state.consume_pending().is_empty());
    }

    #[test]
    fn production_default_accepts_canonical_and_legacy_activation_contracts() {
        let state = ModdingFlowActivationRuntimeState::default();
        assert!(state.enabled());
        let report = state.capture_args(
            [activation(ARTIFACT_ID), legacy_activation(ARTIFACT_ID)],
            FluxoraActivationSource::Startup,
            |_| panic!("cold-start activation must remain queued"),
        );
        assert_eq!(report.queued, 1);
        assert_eq!(report.duplicates, 1);
        assert_eq!(state.consume_pending().len(), 1);
    }

    #[test]
    fn cold_start_queues_until_consume_marks_the_renderer_ready() {
        let state = ModdingFlowActivationRuntimeState::new(true);
        let report = state.capture_args(
            ["Fluxora.exe".to_string(), activation(ARTIFACT_ID)],
            FluxoraActivationSource::Startup,
            |_| panic!("cold-start activation must remain queued"),
        );
        assert_eq!(report.queued, 1);
        assert_eq!(report.delivered, 0);
        assert_eq!(state.pending_count(), 1);

        assert_eq!(
            state.consume_pending(),
            vec![SafeModdingFlowActivation {
                v: 1,
                artifact_id: ARTIFACT_ID.to_string(),
            }]
        );
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn warm_activation_emits_after_readiness_and_never_starts_other_work() {
        let state = ModdingFlowActivationRuntimeState::new(true);
        assert!(state.consume_pending().is_empty());
        let mut delivered = Vec::new();
        let report = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::DeepLink,
            |activation| {
                delivered.push(activation.clone());
                true
            },
        );

        assert_eq!(report.queued, 1);
        assert_eq!(report.delivered, 1);
        assert_eq!(delivered.len(), 1);
        assert_eq!(delivered[0].artifact_id, ARTIFACT_ID);
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn deduplicates_cold_warm_and_concurrent_duplicate_inputs() {
        let state = Arc::new(ModdingFlowActivationRuntimeState::new(true));
        let cold = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::Startup,
            |_| false,
        );
        let warm = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::SecondInstance,
            |_| false,
        );
        assert_eq!(cold.queued, 1);
        assert_eq!(warm.duplicates, 1);
        assert_eq!(state.consume_pending().len(), 1);

        let delivered = Arc::new(AtomicUsize::new(0));
        let concurrent_id = artifact_id(99);
        let mut workers = Vec::new();
        for _ in 0..8 {
            let state = Arc::clone(&state);
            let delivered = Arc::clone(&delivered);
            let activation = activation(&concurrent_id);
            workers.push(std::thread::spawn(move || {
                state.capture_args(
                    [activation],
                    FluxoraActivationSource::SecondInstance,
                    |_| {
                        delivered.fetch_add(1, Ordering::SeqCst);
                        true
                    },
                )
            }));
        }
        let reports = workers
            .into_iter()
            .map(|worker| worker.join().expect("capture worker"))
            .collect::<Vec<_>>();
        assert_eq!(reports.iter().map(|report| report.queued).sum::<usize>(), 1);
        assert_eq!(
            reports
                .iter()
                .map(|report| report.duplicates)
                .sum::<usize>(),
            7
        );
        assert_eq!(delivered.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn recent_dedupe_expires_and_allows_a_later_explicit_retry() {
        let now = Arc::new(AtomicU64::new(1_000));
        let clock = Arc::clone(&now);
        let state = ModdingFlowActivationRuntimeState::new_with_clock(
            true,
            Arc::new(move || clock.load(Ordering::SeqCst)),
        );
        assert!(state.consume_pending().is_empty());

        let first = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::SecondInstance,
            |_| true,
        );
        let duplicate = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::SecondInstance,
            |_| panic!("short-window duplicate must not deliver"),
        );
        assert_eq!(first.queued, 1);
        assert_eq!(first.delivered, 1);
        assert_eq!(duplicate.duplicates, 1);

        now.store(1_000 + RECENT_ARTIFACT_DEDUPE_WINDOW_MS, Ordering::SeqCst);
        let retry = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::SecondInstance,
            |_| true,
        );
        assert_eq!(retry.queued, 1);
        assert_eq!(retry.delivered, 1);
    }

    #[test]
    fn delivery_callback_can_reenter_capture_without_mutex_deadlock() {
        let state = Arc::new(ModdingFlowActivationRuntimeState::new(true));
        assert!(state.consume_pending().is_empty());
        let nested_artifact_id = artifact_id(777);
        let nested_delivered = Arc::new(AtomicUsize::new(0));
        let callback_state = Arc::clone(&state);
        let callback_delivered = Arc::clone(&nested_delivered);

        let outer = state.capture_args(
            [activation(ARTIFACT_ID)],
            FluxoraActivationSource::SecondInstance,
            move |_| {
                let nested = callback_state.capture_args(
                    [activation(&nested_artifact_id)],
                    FluxoraActivationSource::SecondInstance,
                    |_| {
                        callback_delivered.fetch_add(1, Ordering::SeqCst);
                        true
                    },
                );
                assert_eq!(nested.delivered, 1);
                true
            },
        );

        assert_eq!(outer.delivered, 1);
        assert_eq!(nested_delivered.load(Ordering::SeqCst), 1);
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn rejects_unsupported_and_deceptive_inputs_without_exposing_them() {
        let state = ModdingFlowActivationRuntimeState::new(true);
        let invalid = [
            format!("moddingflow://download?v=2&artifact_id={ARTIFACT_ID}"),
            format!("ModdingFlow://download?v=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://user@download?v=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://%64ownload?v=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}#secret"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&token=secret"),
            format!(" {}", activation(ARTIFACT_ID)),
            format!("{} ", activation(ARTIFACT_ID)),
            format!("\"{}\"", activation(ARTIFACT_ID)),
            format!("'{}'", activation(ARTIFACT_ID)),
            activation("00000000-0000-0000-0000-000000000000"),
            activation("01234567-89ab-0cde-8fab-0123456789ab"),
            activation("01234567-89ab-4cde-7fab-0123456789ab"),
            "x".repeat(MAX_ACTIVATION_BYTES + 1)
                .replacen('x', "moddingflow:", 1),
        ];
        let report = state.capture_args(invalid, FluxoraActivationSource::Startup, |_| {
            panic!("invalid activation must not deliver")
        });
        assert_eq!(report.rejected, 14);
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn inbox_overflow_is_bounded_without_evicting_pending_items() {
        let state = ModdingFlowActivationRuntimeState::new(true);
        let inputs = (0..=MAX_INBOX_ITEMS)
            .map(|index| activation(&artifact_id(index)))
            .collect::<Vec<_>>();
        let report = state.capture_args(inputs, FluxoraActivationSource::Startup, |_| {
            panic!("renderer is not ready")
        });
        assert_eq!(report.queued, MAX_INBOX_ITEMS);
        assert_eq!(report.full, 1);
        assert_eq!(state.pending_count(), MAX_INBOX_ITEMS);
        assert_eq!(state.consume_pending().len(), MAX_INBOX_ITEMS);
    }

    #[test]
    fn renderer_dto_serializes_only_version_and_artifact_uuid() {
        let value = serde_json::to_value(SafeModdingFlowActivation {
            v: 1,
            artifact_id: ARTIFACT_ID.to_string(),
        })
        .expect("serialize activation");
        assert_eq!(
            value,
            serde_json::json!({
                "v": 1,
                "artifactId": ARTIFACT_ID,
            })
        );
    }
}
