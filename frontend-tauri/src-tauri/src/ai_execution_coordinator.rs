use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::goal_contract::{FluxoraAiGoal, GoalMode, GoalOrigin};
pub use crate::tool_contract::ToolDomain as AiExecutionDomain;
use crate::tool_contract::{tool_contract, ToolOperation, ToolRisk, ToolVerification};
#[cfg(test)]
use crate::tool_contract::{ToolCompensation, TOOL_CONTRACT_REGISTRY};

pub const AI_TOOL_OUTCOME_SCHEMA: &str = "fluxora.ai.tool-outcome.v1";
pub const MAX_RECOVERY_ATTEMPTS_PER_CAUSE: u8 = 2;
pub const MAX_CONSECUTIVE_NO_EVIDENCE: u8 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiExecutionKind {
    Action,
    Answer,
}

impl AiExecutionKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Action => "action",
            Self::Answer => "answer",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiExecutionPhase {
    Discover,
    Inspect,
    Mutate,
    Verify,
    Report,
}

impl AiExecutionPhase {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Discover => "discover",
            Self::Inspect => "inspect",
            Self::Mutate => "mutate",
            Self::Verify => "verify",
            Self::Report => "report",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiExecutionState {
    Running,
    NeedsInput,
    Blocked,
    Completed,
}

impl AiExecutionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::NeedsInput => "needs-input",
            Self::Blocked => "blocked",
            Self::Completed => "completed",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiToolOutcomeStatus {
    Ok,
    Blocked,
    NeedsInput,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRecoveryDirective {
    pub action: String,
    pub cause: String,
    pub attempt: u8,
    pub max_attempts: u8,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolOutcome {
    pub schema: &'static str,
    pub status: AiToolOutcomeStatus,
    pub error_code: Option<String>,
    pub evidence_delta: Vec<String>,
    pub recovery_directive: Option<AiRecoveryDirective>,
    pub compensation_token: Option<String>,
    pub operation_id: String,
}

impl AiToolOutcome {
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| {
            json!({
                "schema": AI_TOOL_OUTCOME_SCHEMA,
                "status": "blocked",
                "errorCode": "outcome-serialization-failed",
                "evidenceDelta": [],
                "operationId": self.operation_id
            })
        })
    }
}

#[derive(Debug)]
pub struct AiExecutionCoordinator {
    goal_id: String,
    kind: AiExecutionKind,
    mode: GoalMode,
    origin: GoalOrigin,
    requested_outcome: String,
    domain: AiExecutionDomain,
    phase: AiExecutionPhase,
    state: AiExecutionState,
    evidence: HashSet<String>,
    verified_effects: Vec<Value>,
    recovery_attempts: HashMap<String, u8>,
    new_evidence_count: usize,
    stagnant_result_count: u8,
    phase_transitions: Vec<String>,
    pending_question: Option<String>,
    terminal_reason: Option<String>,
}

impl AiExecutionCoordinator {
    pub fn new(
        goal_id: impl Into<String>,
        kind: AiExecutionKind,
        domain: AiExecutionDomain,
    ) -> Self {
        Self {
            goal_id: goal_id.into(),
            kind,
            mode: if kind == AiExecutionKind::Action {
                GoalMode::Repair
            } else {
                GoalMode::Answer
            },
            origin: GoalOrigin::Explicit,
            requested_outcome: "Complete the validated Fluxora task.".to_string(),
            domain,
            phase: AiExecutionPhase::Discover,
            state: AiExecutionState::Running,
            evidence: HashSet::new(),
            verified_effects: Vec::new(),
            recovery_attempts: HashMap::new(),
            new_evidence_count: 0,
            stagnant_result_count: 0,
            phase_transitions: Vec::new(),
            pending_question: None,
            terminal_reason: None,
        }
    }

    #[cfg(test)]
    pub fn from_prompt(goal_id: impl Into<String>, prompt: &str, action: bool) -> Self {
        Self::new(
            goal_id,
            if action {
                AiExecutionKind::Action
            } else {
                AiExecutionKind::Answer
            },
            infer_domain(prompt),
        )
    }

    pub fn from_goal(goal: &FluxoraAiGoal, prompt: &str) -> Self {
        let mut coordinator = Self::new(
            goal.goal_id(),
            if goal.mode() == GoalMode::Repair {
                AiExecutionKind::Action
            } else {
                AiExecutionKind::Answer
            },
            infer_domain(prompt),
        );
        coordinator.mode = goal.mode();
        coordinator.origin = goal.origin();
        coordinator.requested_outcome = goal.requested_outcome().to_string();
        coordinator
    }

    #[cfg(test)]
    pub const fn phase(&self) -> AiExecutionPhase {
        self.phase
    }

    pub const fn state(&self) -> AiExecutionState {
        self.state
    }

    #[cfg(test)]
    pub const fn domain(&self) -> AiExecutionDomain {
        self.domain
    }

    pub fn terminal_reason(&self) -> Option<&str> {
        self.terminal_reason.as_deref()
    }

    pub fn pending_question(&self) -> Option<&str> {
        self.pending_question.as_deref()
    }

    pub fn request_input(&mut self, question: impl Into<String>) {
        if self.state != AiExecutionState::Running {
            return;
        }
        self.state = AiExecutionState::NeedsInput;
        self.pending_question = Some(question.into());
        self.terminal_reason = Some("needs-input".to_string());
    }

    pub const fn new_evidence_count(&self) -> usize {
        self.new_evidence_count
    }

    pub const fn stagnant_result_count(&self) -> u8 {
        self.stagnant_result_count
    }

    pub fn observe_host_evidence(&mut self, label: &str, result: &Value) {
        if self.state != AiExecutionState::Running {
            return;
        }
        let delta = collect_evidence_delta(&mut self.evidence, label, result);
        if delta.is_empty() {
            self.stagnant_result_count = self.stagnant_result_count.saturating_add(1);
        } else {
            self.new_evidence_count = self.new_evidence_count.saturating_add(delta.len());
            self.stagnant_result_count = 0;
            self.transition_to(AiExecutionPhase::Inspect);
        }
        if self.stagnant_result_count >= MAX_CONSECUTIVE_NO_EVIDENCE {
            self.block("no-new-evidence".to_string());
        }
    }

    pub fn phase_transitions(&self) -> &[String] {
        &self.phase_transitions
    }

    pub fn mark_terminal_blocker(&mut self, reason: impl Into<String>) {
        if self.state == AiExecutionState::Running {
            self.block(reason.into());
        }
    }

    pub fn observe_tool_result(
        &mut self,
        tool_name: &str,
        result: &Value,
        operation_id: &str,
    ) -> AiToolOutcome {
        let Some(contract) = tool_contract(tool_name) else {
            self.block("unknown-tool-contract".to_string());
            return AiToolOutcome {
                schema: AI_TOOL_OUTCOME_SCHEMA,
                status: AiToolOutcomeStatus::Blocked,
                error_code: Some("protected".to_string()),
                evidence_delta: Vec::new(),
                recovery_directive: None,
                compensation_token: None,
                operation_id: operation_id.to_string(),
            };
        };
        self.domain = contract.domain;
        if self.kind == AiExecutionKind::Answer && contract.risk != ToolRisk::ReadOnly {
            self.block("answer-mutation-not-authorized".to_string());
            return AiToolOutcome {
                schema: AI_TOOL_OUTCOME_SCHEMA,
                status: AiToolOutcomeStatus::Blocked,
                error_code: Some("protected".to_string()),
                evidence_delta: Vec::new(),
                recovery_directive: None,
                compensation_token: None,
                operation_id: operation_id.to_string(),
            };
        }
        let ok = result.pointer("/result/ok").and_then(Value::as_bool) == Some(true);
        let error_code = (!ok).then(|| error_code_from_result(result));
        let mut evidence_delta = if ok {
            collect_evidence_delta(&mut self.evidence, tool_name, result)
        } else {
            Vec::new()
        };
        if ok && contract.operation == ToolOperation::Stage {
            push_unique_evidence(
                &mut self.evidence,
                &mut evidence_delta,
                format!("staged-effect:{tool_name}"),
            );
        }
        if ok && verified_effect(contract.verification, result) {
            let mut effect = json!({
                "tool": tool_name,
                "operationId": operation_id,
                "verification": "native-postcondition"
            });
            if let Some(compensation_token) = result
                .pointer("/result/data/compensationToken")
                .and_then(Value::as_str)
            {
                effect["compensationToken"] = json!(compensation_token);
            }
            self.verified_effects.push(effect);
            push_unique_evidence(
                &mut self.evidence,
                &mut evidence_delta,
                format!("verified-effect:{tool_name}"),
            );
        }

        let mut recovery_directive = None;
        let mut status = if ok {
            AiToolOutcomeStatus::Ok
        } else {
            AiToolOutcomeStatus::Blocked
        };

        if let Some(code) = error_code.as_deref() {
            match recovery_action(code) {
                RecoveryAction::Retry(action) => {
                    let attempts = self.recovery_attempts.entry(code.to_string()).or_default();
                    *attempts = attempts.saturating_add(1);
                    if *attempts <= MAX_RECOVERY_ATTEMPTS_PER_CAUSE {
                        recovery_directive = Some(AiRecoveryDirective {
                            action: action.to_string(),
                            cause: code.to_string(),
                            attempt: *attempts,
                            max_attempts: MAX_RECOVERY_ATTEMPTS_PER_CAUSE,
                        });
                    } else {
                        self.block(format!("recovery-exhausted:{code}"));
                    }
                }
                RecoveryAction::Question => {
                    status = AiToolOutcomeStatus::NeedsInput;
                    self.state = AiExecutionState::NeedsInput;
                    self.pending_question = Some(question_from_result(result, code));
                    self.terminal_reason = Some(code.to_string());
                }
                RecoveryAction::Terminal => self.block(code.to_string()),
            }
        }

        if ok {
            if evidence_delta.is_empty() {
                self.stagnant_result_count = self.stagnant_result_count.saturating_add(1);
            } else {
                self.new_evidence_count =
                    self.new_evidence_count.saturating_add(evidence_delta.len());
                self.stagnant_result_count = 0;
                self.advance_phase(contract.operation, contract.verification, result);
            }
        }
        if self.stagnant_result_count >= MAX_CONSECUTIVE_NO_EVIDENCE
            && self.state == AiExecutionState::Running
        {
            self.block("no-new-evidence".to_string());
        }
        if self.state == AiExecutionState::Blocked {
            status = AiToolOutcomeStatus::Blocked;
            recovery_directive = None;
        }

        AiToolOutcome {
            schema: AI_TOOL_OUTCOME_SCHEMA,
            status,
            error_code,
            evidence_delta,
            recovery_directive,
            compensation_token: result
                .pointer("/result/data/compensationToken")
                .and_then(Value::as_str)
                .map(str::to_string),
            operation_id: operation_id.to_string(),
        }
    }

    pub fn attach_outcome(result: &mut Value, outcome: &AiToolOutcome) {
        if let Some(fields) = result.get_mut("result").and_then(Value::as_object_mut) {
            fields.insert("toolOutcome".to_string(), outcome.to_value());
        }
    }

    pub fn mark_reported(&mut self) {
        self.transition_to(AiExecutionPhase::Report);
        if self.kind == AiExecutionKind::Answer || !self.verified_effects.is_empty() {
            self.state = AiExecutionState::Completed;
            self.terminal_reason = None;
        } else if self.state == AiExecutionState::Running {
            self.block("action-without-verified-effect".to_string());
        }
    }

    pub fn execution_value(&self) -> Value {
        json!({
            "goalId": self.goal_id,
            "kind": self.kind.as_str(),
            "mode": self.mode.as_str(),
            "origin": self.origin.as_str(),
            "requestedOutcome": self.requested_outcome,
            "domain": self.domain.as_str(),
            "phase": self.phase.as_str(),
            "state": self.state.as_str(),
            "verifiedEffects": self.verified_effects,
            "pendingQuestion": self.pending_question,
            "terminalReason": self.terminal_reason
        })
    }

    fn advance_phase(
        &mut self,
        operation: ToolOperation,
        verification: ToolVerification,
        result: &Value,
    ) {
        if verified_effect(verification, result) {
            self.transition_to(AiExecutionPhase::Report);
            self.state = AiExecutionState::Completed;
            return;
        }
        match operation {
            ToolOperation::Discover => self.transition_to(AiExecutionPhase::Inspect),
            ToolOperation::Inspect => self.transition_to(if self.kind == AiExecutionKind::Action {
                AiExecutionPhase::Mutate
            } else {
                AiExecutionPhase::Inspect
            }),
            ToolOperation::Stage | ToolOperation::Mutate | ToolOperation::Verify => {
                self.transition_to(AiExecutionPhase::Verify)
            }
            ToolOperation::Commit => self.transition_to(AiExecutionPhase::Verify),
            ToolOperation::RequestInput => {}
        }
    }

    fn transition_to(&mut self, next: AiExecutionPhase) {
        if phase_rank(next) > phase_rank(self.phase) {
            self.phase_transitions
                .push(format!("{}->{}", self.phase.as_str(), next.as_str()));
            self.phase = next;
        }
    }

    fn block(&mut self, reason: String) {
        self.state = AiExecutionState::Blocked;
        self.terminal_reason = Some(reason);
    }
}

pub fn infer_domain(prompt: &str) -> AiExecutionDomain {
    let normalized = prompt.to_lowercase();
    for (domain, markers) in [
        (AiExecutionDomain::FluxPack, &["fluxpack", "flux pack"][..]),
        (
            AiExecutionDomain::Installs,
            &["install", "установ", "инстал"][..],
        ),
        (
            AiExecutionDomain::Downloads,
            &["download", "загрузк", "скач"][..],
        ),
        (
            AiExecutionDomain::Plugins,
            &["plugin", "плагин", "load order"][..],
        ),
        (AiExecutionDomain::Mods, &["mod", "мод"][..]),
        (AiExecutionDomain::Profiles, &["profile", "профил"][..]),
        (
            AiExecutionDomain::Settings,
            &["setting", "настройк", "theme", "тема", "language", "язык"][..],
        ),
        (
            AiExecutionDomain::Projects,
            &["project", "build", "проект", "сборк"][..],
        ),
        (
            AiExecutionDomain::Files,
            &["file", "config", "файл", "конфиг"][..],
        ),
    ] {
        if markers.iter().any(|marker| normalized.contains(marker)) {
            return domain;
        }
    }
    AiExecutionDomain::General
}

fn verified_effect(verification: ToolVerification, result: &Value) -> bool {
    if !matches!(
        verification,
        ToolVerification::NativePostcondition | ToolVerification::FileCommit
    ) {
        return false;
    }
    let files = result
        .pointer("/result/data/files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    (verification == ToolVerification::FileCommit
        && !files.is_empty()
        && files.iter().all(|file| {
            file.get("verification")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        }))
        || result
            .pointer("/result/data/postconditionVerified")
            .and_then(Value::as_bool)
            == Some(true)
}

fn error_code_from_result(result: &Value) -> String {
    result
        .pointer("/result/error/errorCode")
        .or_else(|| result.pointer("/result/error/validationCode"))
        .or_else(|| result.pointer("/result/error/code"))
        .and_then(Value::as_str)
        .unwrap_or("unknown-tool-failure")
        .to_string()
}

enum RecoveryAction {
    Retry(&'static str),
    Question,
    Terminal,
}

fn recovery_action(code: &str) -> RecoveryAction {
    match code {
        "session-inactive" | "expired-reference" | "expired-ref" => {
            RecoveryAction::Retry("reopen-native-session-and-rediscover")
        }
        "stale-version" | "stale-revision" => RecoveryAction::Retry("reread-current-revision"),
        "native-timeout" => RecoveryAction::Retry("reread-native-state-and-retry"),
        "invalid-scope" | "invalid-arguments" | "validation-failed" => {
            RecoveryAction::Retry("normalize-arguments-and-retry")
        }
        "ambiguous" | "conflict" | "needs-input" | "dirty-editor" => RecoveryAction::Question,
        "outside-scope" | "path-escape" | "protected" | "permission-denied" => {
            RecoveryAction::Terminal
        }
        _ => RecoveryAction::Terminal,
    }
}

fn question_from_result(result: &Value, code: &str) -> String {
    result
        .pointer("/result/error/message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Fluxora needs one concrete decision to resolve {code}."))
}

fn collect_evidence_delta(
    existing: &mut HashSet<String>,
    tool_name: &str,
    result: &Value,
) -> Vec<String> {
    let mut delta = Vec::new();
    let semantic = semantic_result_value(result.get("result").unwrap_or(result));
    let encoded = serde_json::to_vec(&semantic).unwrap_or_default();
    let mut fingerprint = 0xcbf29ce484222325_u64;
    for byte in tool_name.as_bytes().iter().chain(encoded.iter()) {
        fingerprint ^= u64::from(*byte);
        fingerprint = fingerprint.wrapping_mul(0x100000001b3);
    }
    push_unique_evidence(
        existing,
        &mut delta,
        format!("semantic-result:{fingerprint:016x}"),
    );
    delta
}

fn semantic_result_value(value: &Value) -> Value {
    match value {
        Value::Object(fields) => {
            let mut keys = fields.keys().collect::<Vec<_>>();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .filter(|key| {
                        !matches!(
                            key.as_str(),
                            "operationId"
                                | "runId"
                                | "timestamp"
                                | "createdAt"
                                | "checkedAt"
                                | "elapsedMs"
                                | "durationMs"
                        )
                    })
                    .map(|key| (key.clone(), semantic_result_value(&fields[key])))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(semantic_result_value).collect()),
        value => value.clone(),
    }
}

const fn phase_rank(phase: AiExecutionPhase) -> u8 {
    match phase {
        AiExecutionPhase::Discover => 0,
        AiExecutionPhase::Inspect => 1,
        AiExecutionPhase::Mutate => 2,
        AiExecutionPhase::Verify => 3,
        AiExecutionPhase::Report => 4,
    }
}

fn push_unique_evidence(
    existing: &mut HashSet<String>,
    delta: &mut Vec<String>,
    candidate: String,
) {
    if existing.insert(candidate.clone()) {
        delta.push(candidate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_capability_declares_risk_verification_and_rollback_or_confirmation() {
        let domains = TOOL_CONTRACT_REGISTRY
            .iter()
            .map(|contract| contract.domain)
            .collect::<HashSet<_>>();
        assert_eq!(domains.len(), 9);
        for contract in TOOL_CONTRACT_REGISTRY {
            assert!(!contract.internal_name.is_empty());
            assert!(!contract.provider_name.is_empty());
            if contract.risk == ToolRisk::ReadOnly {
                assert_eq!(
                    contract.compensation,
                    ToolCompensation::None,
                    "read-only tool {} cannot claim compensation",
                    contract.internal_name
                );
            } else if contract.risk == ToolRisk::Irreversible {
                assert_eq!(
                    contract.compensation,
                    ToolCompensation::ConfirmationRequired
                );
            } else {
                assert_ne!(contract.compensation, ToolCompensation::None);
                assert_ne!(
                    contract.compensation,
                    ToolCompensation::ConfirmationRequired
                );
            }
        }
    }

    #[test]
    fn selected_tool_contract_sets_actual_domain_and_monotonic_phase() {
        let mut coordinator =
            AiExecutionCoordinator::from_prompt("goal-actual-domain", "Измени язык Fluxora", true);
        assert_eq!(coordinator.domain(), AiExecutionDomain::Settings);

        let listed = coordinator.observe_tool_result(
            "local.mods.list",
            &json!({
                "result": {
                    "ok": true,
                    "data": { "mods": [{ "modRef": "mod-1", "isEnabled": true }] }
                }
            }),
            "operation-actual-domain",
        );
        assert_eq!(listed.status, AiToolOutcomeStatus::Ok);
        assert_eq!(coordinator.domain(), AiExecutionDomain::Mods);
        assert_eq!(coordinator.phase(), AiExecutionPhase::Inspect);

        let verified = coordinator.observe_tool_result(
            "local.mods.set_enabled",
            &json!({
                "result": {
                    "ok": true,
                    "data": {
                        "modRef": "mod-1",
                        "isEnabled": false,
                        "postconditionVerified": true,
                        "compensationToken": "undo-mod-1"
                    }
                }
            }),
            "operation-actual-domain",
        );
        assert_eq!(verified.status, AiToolOutcomeStatus::Ok);
        assert_eq!(coordinator.domain(), AiExecutionDomain::Mods);
        assert_eq!(coordinator.phase(), AiExecutionPhase::Report);
        assert_eq!(coordinator.state(), AiExecutionState::Completed);
    }

    #[test]
    fn inactive_native_session_is_recoverable_twice_then_exactly_blocked() {
        let mut coordinator = AiExecutionCoordinator::new(
            "goal-1",
            AiExecutionKind::Action,
            AiExecutionDomain::Files,
        );
        let failed = json!({
            "result": {
                "ok": false,
                "error": { "code": "session-inactive", "message": "native session restarted" }
            }
        });

        for expected_attempt in 1..=2 {
            let outcome =
                coordinator.observe_tool_result("local.files.search", &failed, "operation-1");
            assert_eq!(outcome.status, AiToolOutcomeStatus::Blocked);
            assert_eq!(
                outcome
                    .recovery_directive
                    .as_ref()
                    .map(|value| value.attempt),
                Some(expected_attempt)
            );
            assert_eq!(coordinator.state(), AiExecutionState::Running);
        }
        let outcome = coordinator.observe_tool_result("local.files.search", &failed, "operation-1");
        assert!(outcome.recovery_directive.is_none());
        assert_eq!(coordinator.state(), AiExecutionState::Blocked);
        assert_eq!(
            coordinator
                .execution_value()
                .get("terminalReason")
                .and_then(Value::as_str),
            Some("recovery-exhausted:session-inactive")
        );
    }

    #[test]
    fn three_semantically_repeated_successes_stop_the_loop() {
        let mut coordinator = AiExecutionCoordinator::new(
            "goal-2",
            AiExecutionKind::Action,
            AiExecutionDomain::Files,
        );
        let empty_success = json!({ "result": { "ok": true, "data": { "entries": [] } } });
        let first =
            coordinator.observe_tool_result("local.files.search", &empty_success, "operation-2");
        assert_eq!(first.evidence_delta.len(), 1);
        assert_eq!(coordinator.new_evidence_count(), 1);
        assert_eq!(coordinator.stagnant_result_count(), 0);
        for expected_stagnant in 1..=3 {
            let _ = coordinator.observe_tool_result(
                "local.files.search",
                &empty_success,
                "operation-2",
            );
            assert_eq!(coordinator.stagnant_result_count(), expected_stagnant);
        }
        assert_eq!(coordinator.state(), AiExecutionState::Blocked);
        assert_eq!(
            coordinator
                .execution_value()
                .get("terminalReason")
                .and_then(Value::as_str),
            Some("no-new-evidence")
        );
    }

    #[test]
    fn semantic_evidence_tracer_reaches_verified_file_commit() {
        let mut coordinator = AiExecutionCoordinator::new(
            "goal-semantic-evidence",
            AiExecutionKind::Action,
            AiExecutionDomain::Files,
        );
        let observations = [
            (
                "local.files.search",
                json!({
                    "result": {
                        "ok": true,
                        "data": {
                            "revision": "index-r1",
                            "cursor": "page-1",
                            "nextCursor": "page-2",
                            "entries": [{ "fileRef": "file-settings", "name": "SettingsUser.json" }]
                        }
                    }
                }),
            ),
            (
                "local.text.read",
                json!({
                    "result": {
                        "ok": true,
                        "data": {
                            "fileRef": "file-settings",
                            "revision": "index-r1",
                            "startLine": 1,
                            "endLine": 40,
                            "content": "first bounded range"
                        }
                    }
                }),
            ),
            (
                "local.text.read",
                json!({
                    "result": {
                        "ok": true,
                        "data": {
                            "fileRef": "file-settings",
                            "revision": "index-r1",
                            "startLine": 41,
                            "endLine": 80,
                            "content": "second bounded range"
                        }
                    }
                }),
            ),
            (
                "local.text.search",
                json!({
                    "result": {
                        "ok": true,
                        "data": {
                            "revision": "index-r1",
                            "matches": [{
                                "fileRef": "file-settings",
                                "line": 17,
                                "value": "ToggleKey"
                            }]
                        }
                    }
                }),
            ),
            (
                "local.json.query",
                json!({
                    "result": {
                        "ok": true,
                        "data": {
                            "fileRef": "file-settings",
                            "revision": "index-r1",
                            "pointer": "/Menu/ToggleKey",
                            "value": "35"
                        }
                    }
                }),
            ),
            (
                "local.config.inspect_recipe",
                json!({
                    "result": {
                        "ok": true,
                        "data": {
                            "fileRef": "file-settings",
                            "revision": "index-r1",
                            "targetPointer": "/Menu/ToggleKey",
                            "currentValue": "35",
                            "encodedValue": "34",
                            "requestedValue": "PageDown"
                        }
                    }
                }),
            ),
            (
                "local.json.stage_set_pointer",
                json!({
                    "result": {
                        "ok": true,
                        "data": { "staged": true, "stagedCount": 1 }
                    }
                }),
            ),
        ];

        for (tool, result) in observations {
            let outcome = coordinator.observe_tool_result(tool, &result, "operation-semantic");
            assert_eq!(
                coordinator.state(),
                AiExecutionState::Running,
                "{tool} must count as progress: {outcome:?}"
            );
            assert!(
                !outcome.evidence_delta.is_empty(),
                "{tool} must contribute semantic evidence"
            );
        }

        let committed = json!({
            "result": {
                "ok": true,
                "data": {
                    "postconditionVerified": true,
                    "compensationToken": "undo-toggle-key",
                    "files": [{ "verification": "json-pointer-matched-after-reread" }]
                }
            }
        });
        let outcome =
            coordinator.observe_tool_result("local.files.commit", &committed, "operation-semantic");
        assert_eq!(outcome.status, AiToolOutcomeStatus::Ok);
        assert_eq!(coordinator.state(), AiExecutionState::Completed);
        assert_eq!(coordinator.phase(), AiExecutionPhase::Report);
    }

    #[test]
    fn verified_native_postcondition_is_the_only_action_completion_evidence() {
        let mut coordinator = AiExecutionCoordinator::new(
            "goal-3",
            AiExecutionKind::Action,
            AiExecutionDomain::Files,
        );
        let committed = json!({
            "result": {
                "ok": true,
                "data": {
                    "postconditionVerified": true,
                    "compensationToken": "undo-effect-1"
                }
            }
        });
        let outcome =
            coordinator.observe_tool_result("local.files.commit", &committed, "operation-3");
        assert_eq!(outcome.status, AiToolOutcomeStatus::Ok);
        assert_eq!(coordinator.state(), AiExecutionState::Completed);
        assert_eq!(coordinator.phase(), AiExecutionPhase::Report);
        assert_eq!(
            coordinator
                .execution_value()
                .get("verifiedEffects")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            coordinator
                .execution_value()
                .pointer("/verifiedEffects/0/compensationToken")
                .and_then(Value::as_str),
            Some("undo-effect-1")
        );
    }

    #[test]
    fn recovery_classes_are_precise_and_terminal_guards_do_not_retry() {
        for (code, action) in [
            ("expired-reference", "reopen-native-session-and-rediscover"),
            ("stale-revision", "reread-current-revision"),
            ("invalid-scope", "normalize-arguments-and-retry"),
        ] {
            let mut coordinator = AiExecutionCoordinator::new(
                format!("goal-{code}"),
                AiExecutionKind::Action,
                AiExecutionDomain::Files,
            );
            let outcome = coordinator.observe_tool_result(
                "local.files.search",
                &json!({ "result": { "ok": false, "error": { "code": code } } }),
                "operation-recovery",
            );
            assert_eq!(
                outcome
                    .recovery_directive
                    .as_ref()
                    .map(|directive| directive.action.as_str()),
                Some(action)
            );
            assert_eq!(coordinator.state(), AiExecutionState::Running);
        }

        for code in ["outside-scope", "path-escape", "protected"] {
            let mut coordinator = AiExecutionCoordinator::new(
                format!("goal-{code}"),
                AiExecutionKind::Action,
                AiExecutionDomain::Files,
            );
            let outcome = coordinator.observe_tool_result(
                "local.text.read",
                &json!({ "result": { "ok": false, "error": { "code": code } } }),
                "operation-terminal",
            );
            assert!(outcome.recovery_directive.is_none());
            assert_eq!(coordinator.state(), AiExecutionState::Blocked);
            assert_eq!(coordinator.terminal_reason(), Some(code));
        }
    }

    #[test]
    fn recoverable_errors_never_consume_the_stagnation_budget() {
        let mut coordinator = AiExecutionCoordinator::new(
            "goal-recovery-budget",
            AiExecutionKind::Action,
            AiExecutionDomain::Files,
        );
        for code in ["session-inactive", "stale-revision", "native-timeout"] {
            let outcome = coordinator.observe_tool_result(
                "local.files.search",
                &json!({ "result": { "ok": false, "error": { "code": code } } }),
                "operation-recovery-budget",
            );
            assert!(outcome.recovery_directive.is_some());
            assert_eq!(coordinator.state(), AiExecutionState::Running);
            assert_eq!(coordinator.stagnant_result_count(), 0);
            assert_eq!(coordinator.new_evidence_count(), 0);
        }
    }

    #[test]
    fn conflict_and_ambiguity_ask_exactly_one_question_and_scope_escape_stops_bounded() {
        for (code, message) in [
            (
                "conflict",
                "Profile Default already exists. Choose a different name.",
            ),
            (
                "ambiguous",
                "Two matching profiles remain. Choose Default or Testing.",
            ),
        ] {
            let mut coordinator = AiExecutionCoordinator::new(
                format!("goal-{code}"),
                AiExecutionKind::Action,
                AiExecutionDomain::Profiles,
            );
            let result = json!({
                "result": {
                    "ok": false,
                    "error": {
                        "code": code,
                        "message": message
                    }
                }
            });
            let outcome = coordinator.observe_tool_result(
                "local.profiles.create",
                &result,
                "operation-question",
            );
            assert_eq!(coordinator.state(), AiExecutionState::NeedsInput);
            assert_eq!(coordinator.pending_question(), Some(message));
            assert!(outcome.recovery_directive.is_none());
            assert_eq!(coordinator.stagnant_result_count(), 0);
        }

        let mut regression = AiExecutionCoordinator::new(
            "goal-regression",
            AiExecutionKind::Action,
            AiExecutionDomain::Files,
        );
        for index in 0..5 {
            let _ = regression.observe_tool_result(
                "local.text.read",
                &json!({
                    "result": {
                        "ok": true,
                        "data": { "fileRef": format!("opaque-{index}"), "revision": format!("r{index}") }
                    }
                }),
                "operation-regression",
            );
        }
        let validation = regression.observe_tool_result(
            "local.text.search",
            &json!({ "result": { "ok": false, "error": { "code": "validation-failed" } } }),
            "operation-regression",
        );
        assert!(validation.recovery_directive.is_some());
        let terminal = regression.observe_tool_result(
            "local.text.read",
            &json!({ "result": { "ok": false, "error": { "code": "outside-scope" } } }),
            "operation-regression",
        );
        assert!(terminal.recovery_directive.is_none());
        assert_eq!(regression.state(), AiExecutionState::Blocked);
        assert_eq!(regression.terminal_reason(), Some("outside-scope"));
    }
}
