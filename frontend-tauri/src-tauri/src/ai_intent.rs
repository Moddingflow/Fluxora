use serde_json::{json, Value};

pub const INTENT_ROUTE_SCHEMA: &str = "fluxora.ai.intent-route.v1";

#[derive(Clone, Debug)]
pub struct AiIntentRoute {
    pub prompt_language: String,
    pub reply_language: String,
    pub confidence: f64,
    pub signals: Vec<Value>,
    pub canonical_intent: String,
    pub scope: String,
    pub explicit_targets: Vec<Value>,
    pub nexus_api_requested: bool,
    pub public_web_requested: bool,
    pub requires_external_network: bool,
    pub clarification_required: bool,
}

impl AiIntentRoute {
    pub fn payload(&self) -> Value {
        json!({
            "schema": INTENT_ROUTE_SCHEMA,
            "promptLanguage": self.prompt_language,
            "replyLanguage": self.reply_language,
            "confidence": self.confidence,
            "signals": self.signals,
            "canonicalIntent": self.canonical_intent,
            "scope": self.scope,
            "explicitTargets": self.explicit_targets,
            "nexusApiRequested": self.nexus_api_requested,
            "publicWebRequested": self.public_web_requested,
            "requiresExternalNetwork": self.requires_external_network,
            "clarificationRequired": self.clarification_required
        })
    }

    pub fn is_requirement_audit(&self) -> bool {
        self.canonical_intent == "requirement-audit"
    }

    pub fn is_batch_requirement_audit(&self) -> bool {
        self.is_requirement_audit()
            && matches!(
                self.scope.as_str(),
                "batch-requirements" | "full-build-requirements"
            )
    }

    pub fn requests_compatibility_or_requirements(&self) -> bool {
        matches!(
            self.canonical_intent.as_str(),
            "nexus-api-research" | "requirement-audit" | "compatibility-check"
        )
    }

    pub fn is_read_only_analysis(&self) -> bool {
        matches!(
            self.canonical_intent.as_str(),
            "nexus-api-research"
                | "requirement-audit"
                | "compatibility-check"
                | "local-build-diagnosis"
        )
    }

    pub fn has_explicit_nexus_target(&self) -> bool {
        self.explicit_targets.iter().any(|target| {
            target
                .get("kind")
                .and_then(Value::as_str)
                .map(|kind| {
                    matches!(
                        kind,
                        "nexus-url" | "nxm-link" | "game-domain-mod-id" | "local-nexus-metadata"
                    )
                })
                .unwrap_or(false)
        })
    }
}

const REQUIREMENT_TERMS: &[&str] = &[
    "dependency",
    "dependencies",
    "requirement",
    "requirements",
    "required mods",
    "missing requirement",
    "missing requirements",
    "требован",
    "зависим",
    "нужные моды",
    "отсутствующие требования",
    "недостающие требования",
    "вимог",
    "залежност",
    "brakujące wymagania",
    "wymag",
    "zależ",
    "fehlende anforderungen",
    "anforder",
    "abhäng",
    "requisitos faltantes",
    "requisito",
    "dependencia",
    "exigences manquantes",
    "exigence",
    "dépend",
    "requisitos ausentes",
    "dependência",
    "eksik gereksin",
    "gereksin",
    "bağıml",
    "المتطلبات",
    "تبعيات",
    "आवश्यक",
    "निर्भर",
    "缺失要求",
    "要求",
    "依赖",
    "不足している要件",
    "要件",
    "依存",
    "누락된 요구",
    "요구",
    "종속",
];

const FULL_SCOPE_TERMS: &[&str] = &[
    "all mods",
    "every mod",
    "whole build",
    "entire build",
    "full audit",
    "все мод",
    "кажд",
    "всю сбор",
    "вся сбор",
    "усі мод",
    "всі мод",
    "wszystkie mody",
    "każd",
    "alle mods",
    "todos los mods",
    "tous les mods",
    "todos os mods",
    "tüm mod",
    "جميع",
    "كل المودات",
    "सभी मॉड",
    "所有",
    "全部",
    "すべてのmod",
    "全mod",
    "모든 모드",
];

const COMPATIBILITY_TERMS: &[&str] = &[
    "compat",
    "compatibility",
    "conflict",
    "conflicts",
    "совмест",
    "конфликт",
    "суміс",
    "konflikt",
    "kompatyb",
    "kompatibil",
    "conflicto",
    "compatibilité",
    "conflit",
    "compatibilidade",
    "uyuml",
    "çakış",
    "توافق",
    "تعارض",
    "संगत",
    "冲突",
    "兼容",
    "互換",
    "競合",
    "호환",
    "충돌",
];

const PUBLIC_WEB_TERMS: &[&str] = &[
    "web",
    "internet",
    "google",
    "search the web",
    "browse",
    "latest",
    "поищи",
    "поиск",
    "интернет",
    "актуальн",
    "свеж",
    "пошук",
    "szukaj",
    "internet",
    "suche",
    "buscar",
    "busca",
    "chercher",
    "rechercher",
    "araştır",
    "ابحث",
    "वेब",
    "खोज",
    "搜索",
    "最新",
    "検索",
    "探して",
    "검색",
];

const NO_PUBLIC_NETWORK_TERMS: &[&str] = &[
    "do not use internet",
    "don't use internet",
    "do not use the internet",
    "do not use web",
    "don't use web",
    "do not browse",
    "no internet",
    "no web",
    "without internet",
    "without web",
    "не используй интернет",
    "не использовать интернет",
    "без интернета",
    "без веб",
    "не ищи в интернете",
    "не шукай в інтернеті",
    "bez internetu",
    "nicht im internet",
    "kein internet",
    "sin internet",
    "sem internet",
    "sans internet",
    "internet kullanma",
    "بدون إنترنت",
    "इंटरनेट का उपयोग न करें",
    "不要使用互联网",
    "ネットを使わない",
    "인터넷 사용하지",
];

const MUTATION_TERMS: &[&str] = &[
    "install",
    "delete",
    "remove",
    "move",
    "enable",
    "disable",
    "create",
    "update",
    "установ",
    "удали",
    "удалить",
    "перемести",
    "включи",
    "отключи",
    "створи",
    "usuń",
    "zainstaluj",
    "installiere",
    "lösche",
    "instala",
    "elimina",
    "installe",
    "supprime",
];

const LOCAL_DIAGNOSIS_TERMS: &[&str] = &[
    "diagnose",
    "diagnostic",
    "troubleshoot",
    "crash",
    "logs",
    "missing masters",
    "load order",
    "диагност",
    "краш",
    "лог",
    "порядок загрузки",
    "мастер",
    "діагност",
    "awaria",
    "protokół",
    "absturz",
    "protokoll",
    "registro",
    "crash",
    "journal",
];

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn push_signal(signals: &mut Vec<Value>, kind: &str, value: &str, confidence: f64, source: &str) {
    signals.push(json!({
        "kind": kind,
        "value": value,
        "confidence": confidence,
        "source": source
    }));
}

fn detect_language(prompt: &str) -> String {
    let lower = prompt.to_lowercase();
    if lower
        .chars()
        .any(|c| ('\u{0600}'..='\u{06ff}').contains(&c))
    {
        return "ar".to_string();
    }
    if lower
        .chars()
        .any(|c| ('\u{0900}'..='\u{097f}').contains(&c))
    {
        return "hi".to_string();
    }
    if lower
        .chars()
        .any(|c| ('\u{3040}'..='\u{30ff}').contains(&c))
    {
        return "ja".to_string();
    }
    if lower
        .chars()
        .any(|c| ('\u{ac00}'..='\u{d7af}').contains(&c))
    {
        return "ko".to_string();
    }
    if lower
        .chars()
        .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
    {
        return "zh".to_string();
    }
    if lower.contains('і') || lower.contains('ї') || lower.contains('є') || lower.contains('ґ')
    {
        return "uk".to_string();
    }
    if lower.chars().any(|c| ('а'..='я').contains(&c) || c == 'ё') {
        return "ru".to_string();
    }
    if lower.contains('ą')
        || lower.contains('ę')
        || lower.contains('ł')
        || lower.contains('ń')
        || lower.contains('ś')
        || lower.contains('ź')
        || lower.contains('ż')
    {
        return "pl".to_string();
    }
    if lower.contains('ß') || lower.contains("prüf") || lower.contains("fehlende anforderungen") {
        return "de".to_string();
    }
    if lower.contains('ñ') || lower.contains("requisitos faltantes") {
        return "es".to_string();
    }
    if lower.contains("vérifie") || lower.contains("exigences manquantes") {
        return "fr".to_string();
    }
    if lower.contains('ã') || lower.contains("requisitos ausentes") {
        return "pt".to_string();
    }
    if lower.contains('ü') || lower.contains('ı') || lower.contains('ğ') || lower.contains('ş')
    {
        return "tr".to_string();
    }
    "en".to_string()
}

fn research_enabled_param(params: &Value) -> Option<bool> {
    params
        .get("research")
        .and_then(|research| research.get("enabled"))
        .and_then(Value::as_bool)
}

fn target_key(target: &Value) -> String {
    format!(
        "{}:{}:{}",
        target
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        target
            .get("gameDomain")
            .or_else(|| target.get("value"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
        target
            .get("modId")
            .and_then(Value::as_str)
            .unwrap_or_default()
    )
}

fn push_target(targets: &mut Vec<Value>, target: Value) {
    let key = target_key(&target);
    if !targets.iter().any(|existing| target_key(existing) == key) {
        targets.push(target);
    }
}

fn detect_text_targets(prompt: &str, normalized: &str) -> Vec<Value> {
    let mut targets = Vec::new();
    if normalized.contains("nexusmods.com") {
        push_target(
            &mut targets,
            json!({
                "kind": "nexus-url",
                "value": prompt
                    .split_whitespace()
                    .find(|part| part.to_lowercase().contains("nexusmods.com"))
                    .unwrap_or("nexusmods.com")
            }),
        );
    }
    if normalized.contains("nxm://") {
        push_target(
            &mut targets,
            json!({
                "kind": "nxm-link",
                "value": prompt
                    .split_whitespace()
                    .find(|part| part.to_lowercase().contains("nxm://"))
                    .unwrap_or("nxm://")
            }),
        );
    }

    for raw in prompt.split_whitespace() {
        let token = raw.trim_matches(|c: char| {
            matches!(
                c,
                ',' | ';' | '.' | ')' | '(' | '[' | ']' | '{' | '}' | '"' | '\''
            )
        });
        let Some((game_domain, mod_id)) = token.split_once(':') else {
            continue;
        };
        if game_domain.len() >= 3
            && game_domain
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            && mod_id.chars().all(|c| c.is_ascii_digit())
        {
            push_target(
                &mut targets,
                json!({
                    "kind": "game-domain-mod-id",
                    "value": token,
                    "gameDomain": game_domain,
                    "modId": mod_id
                }),
            );
        }
    }

    targets
}

fn collect_local_nexus_targets(value: &Value, targets: &mut Vec<Value>, max_targets: usize) {
    if targets.len() >= max_targets {
        return;
    }
    match value {
        Value::Object(fields) => {
            if let (Some(game_domain), Some(mod_id)) = (
                fields.get("gameDomain").and_then(Value::as_str),
                fields
                    .get("modId")
                    .and_then(Value::as_str)
                    .or_else(|| fields.get("modId").and_then(Value::as_u64).map(|_| "")),
            ) {
                let mod_id_value = if mod_id.is_empty() {
                    fields
                        .get("modId")
                        .and_then(Value::as_u64)
                        .map(|value| value.to_string())
                        .unwrap_or_default()
                } else {
                    mod_id.to_string()
                };
                if !game_domain.trim().is_empty() && !mod_id_value.trim().is_empty() {
                    push_target(
                        targets,
                        json!({
                            "kind": "local-nexus-metadata",
                            "gameDomain": game_domain,
                            "modId": mod_id_value
                        }),
                    );
                }
            }
            for nested in fields.values() {
                collect_local_nexus_targets(nested, targets, max_targets);
                if targets.len() >= max_targets {
                    break;
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_local_nexus_targets(item, targets, max_targets);
                if targets.len() >= max_targets {
                    break;
                }
            }
        }
        _ => {}
    }
}

fn confidence_for(
    deterministic_target: bool,
    requirement: bool,
    full_scope: bool,
    compatibility: bool,
    public_web: bool,
    local_diagnosis: bool,
    mutation: bool,
) -> f64 {
    if deterministic_target {
        0.98
    } else if requirement && full_scope {
        0.94
    } else if requirement || compatibility {
        0.88
    } else if public_web || local_diagnosis || mutation {
        0.76
    } else {
        0.35
    }
}

pub fn route_ai_intent(
    params: &Value,
    prompt: &str,
    local_snapshot: Option<&Value>,
    context_bundle: Option<&Value>,
) -> AiIntentRoute {
    let normalized = prompt.trim().to_lowercase();
    let language = detect_language(prompt);
    let mut signals = Vec::new();
    let mut explicit_targets = detect_text_targets(prompt, &normalized);

    if normalized.contains("nexusmods.com") {
        push_signal(
            &mut signals,
            "nexus-url",
            "nexusmods.com",
            0.99,
            "deterministic",
        );
    }
    if normalized.contains("nxm://") {
        push_signal(&mut signals, "nxm-link", "nxm://", 0.99, "deterministic");
    }
    if normalized.contains("nexus.api.research")
        || normalized.contains("nexus.research")
        || normalized.contains("nexus.getauthstatus")
    {
        push_signal(&mut signals, "tool-id", "nexus", 0.97, "deterministic");
    }

    let local_target_count_before = explicit_targets.len();
    if let Some(snapshot) = local_snapshot {
        collect_local_nexus_targets(snapshot, &mut explicit_targets, 8);
    }
    if let Some(bundle) = context_bundle {
        collect_local_nexus_targets(bundle, &mut explicit_targets, 8);
    }
    if explicit_targets.len() > local_target_count_before {
        push_signal(
            &mut signals,
            "local-nexus-metadata",
            "selected-or-build-context",
            0.96,
            "deterministic",
        );
    }

    if research_enabled_param(params).is_some() {
        push_signal(
            &mut signals,
            "research-params",
            "research.enabled",
            0.95,
            "deterministic",
        );
    }

    let requirement = contains_any(&normalized, REQUIREMENT_TERMS);
    let full_scope = contains_any(&normalized, FULL_SCOPE_TERMS);
    let compatibility = contains_any(&normalized, COMPATIBILITY_TERMS);
    let no_public_network = contains_any(&normalized, NO_PUBLIC_NETWORK_TERMS);
    let mut public_web = contains_any(&normalized, PUBLIC_WEB_TERMS);
    let mutation = contains_any(&normalized, MUTATION_TERMS);
    let local_diagnosis = contains_any(&normalized, LOCAL_DIAGNOSIS_TERMS);
    let nexus_named = normalized.contains("nexus");
    let nexus_api_phrase = normalized.contains("nexus api")
        || normalized.contains("nexus/api")
        || normalized.contains("nexus-api")
        || (nexus_named && (normalized.contains(" api") || normalized.contains("апи")))
        || normalized.contains("официальный nexus")
        || normalized.contains("через nexus")
        || normalized.contains("via nexus")
        || normalized.contains("über nexus")
        || normalized.contains("con nexus")
        || normalized.contains("par nexus");

    if requirement {
        push_signal(
            &mut signals,
            "semantic-requirement",
            "requirements/dependencies",
            0.88,
            "multilingual-examples",
        );
    }
    if full_scope {
        push_signal(
            &mut signals,
            "semantic-scope",
            "all-mods-or-build",
            0.88,
            "multilingual-examples",
        );
    }
    if compatibility {
        push_signal(
            &mut signals,
            "semantic-compatibility",
            "compatibility/conflicts",
            0.84,
            "multilingual-examples",
        );
    }
    if no_public_network {
        push_signal(
            &mut signals,
            "negative-public-web",
            "do-not-use-internet-or-web",
            0.9,
            "deterministic",
        );
        public_web = false;
    }

    let has_explicit_nexus_target = !explicit_targets.is_empty();
    let nexus_api_requested = nexus_api_phrase
        || has_explicit_nexus_target
        || (requirement && !no_public_network)
        || (nexus_named && (requirement || compatibility))
        || (research_enabled_param(params).unwrap_or(false)
            && (requirement || compatibility || nexus_named));
    let public_web_requested = public_web && !nexus_api_requested;
    let requires_external_network =
        nexus_api_requested || (public_web_requested && !no_public_network);

    let canonical_intent = if requirement {
        "requirement-audit"
    } else if nexus_api_requested && !compatibility {
        "nexus-api-research"
    } else if compatibility {
        "compatibility-check"
    } else if public_web_requested {
        "public-web-research"
    } else if mutation {
        "mutation-request"
    } else if local_diagnosis || no_public_network {
        "local-build-diagnosis"
    } else {
        "unknown"
    };

    let scope = if requirement && full_scope {
        "full-build-requirements"
    } else if has_explicit_nexus_target {
        "targeted-nexus"
    } else if canonical_intent == "public-web-research" {
        "public-web"
    } else if canonical_intent == "mutation-request" {
        "mutation"
    } else if canonical_intent == "local-build-diagnosis" {
        "local-only"
    } else {
        "targeted"
    };

    // The renderer sends permissive research params for every prompt, so their
    // presence is not a user signal; only an explicit Nexus target is
    // deterministic.
    let confidence = confidence_for(
        has_explicit_nexus_target,
        requirement,
        full_scope,
        compatibility,
        public_web_requested,
        local_diagnosis || no_public_network,
        mutation,
    );
    let clarification_required = confidence < 0.5 && canonical_intent == "unknown";

    AiIntentRoute {
        prompt_language: language.clone(),
        reply_language: language,
        confidence,
        signals,
        canonical_intent: canonical_intent.to_string(),
        scope: scope.to_string(),
        explicit_targets,
        nexus_api_requested,
        public_web_requested,
        requires_external_network,
        clarification_required,
    }
}
