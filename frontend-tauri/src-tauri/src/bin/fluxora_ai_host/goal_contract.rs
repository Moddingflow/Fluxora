use serde_json::{json, Value};

use crate::tool_contract::ToolRisk;

pub const DECLARE_GOAL_TOOL: &str = "local.execution.declare_goal";
pub const DECLARE_GOAL_PROVIDER_TOOL: &str = "local_execution_declare_goal";
pub const REQUEST_INPUT_TOOL: &str = "local.execution.request_input";
pub const REQUEST_INPUT_PROVIDER_TOOL: &str = "local_execution_request_input";
pub const RESEARCH_WEB_TOOL: &str = "local.execution.research_web";
pub const RESEARCH_WEB_PROVIDER_TOOL: &str = "local_execution_research_web";

pub fn internal_tool_name(call_name: &str) -> Option<&'static str> {
    match call_name {
        DECLARE_GOAL_TOOL | DECLARE_GOAL_PROVIDER_TOOL => Some(DECLARE_GOAL_TOOL),
        REQUEST_INPUT_TOOL | REQUEST_INPUT_PROVIDER_TOOL => Some(REQUEST_INPUT_TOOL),
        RESEARCH_WEB_TOOL | RESEARCH_WEB_PROVIDER_TOOL => Some(RESEARCH_WEB_TOOL),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GoalMode {
    Answer,
    Inspect,
    Repair,
}

impl GoalMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Answer => "answer",
            Self::Inspect => "inspect",
            Self::Repair => "repair",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "answer" => Some(Self::Answer),
            "inspect" => Some(Self::Inspect),
            "repair" => Some(Self::Repair),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GoalOrigin {
    Explicit,
    Implicit,
    Continuation,
}

impl GoalOrigin {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Implicit => "implicit",
            Self::Continuation => "continuation",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "explicit" => Some(Self::Explicit),
            "implicit" => Some(Self::Implicit),
            "continuation" => Some(Self::Continuation),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GoalContractError {
    pub field: &'static str,
    pub code: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FluxoraAiGoal {
    goal_id: String,
    mode: GoalMode,
    origin: GoalOrigin,
    requested_outcome: String,
    allowed_risk: ToolRisk,
    continued: bool,
}

impl FluxoraAiGoal {
    pub fn from_declaration_args(
        generated_goal_id: impl Into<String>,
        args: &Value,
        active_goal: Option<&Value>,
    ) -> Result<Self, GoalContractError> {
        let fields = args.as_object().ok_or(GoalContractError {
            field: "args",
            code: "object-required",
        })?;
        let mode = fields
            .get("mode")
            .and_then(Value::as_str)
            .and_then(GoalMode::parse)
            .ok_or(GoalContractError {
                field: "mode",
                code: "invalid-enum",
            })?;
        let origin = fields
            .get("origin")
            .and_then(Value::as_str)
            .and_then(GoalOrigin::parse)
            .ok_or(GoalContractError {
                field: "origin",
                code: "invalid-enum",
            })?;
        let requested_outcome = fields
            .get("requestedOutcome")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= 2_000)
            .ok_or(GoalContractError {
                field: "requestedOutcome",
                code: "required-bounded-string",
            })?
            .to_string();

        let active_mode = active_goal
            .and_then(|goal| goal.get("mode"))
            .and_then(Value::as_str)
            .and_then(GoalMode::parse);
        let active_origin = active_goal
            .and_then(|goal| goal.get("origin"))
            .and_then(Value::as_str)
            .and_then(GoalOrigin::parse);
        let active_goal_id = active_goal
            .and_then(|goal| goal.get("goalId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= 160);
        let active_question = active_goal
            .and_then(|goal| goal.get("pendingQuestion"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= 2_000);
        let continued = origin == GoalOrigin::Continuation;
        if continued
            && (active_mode != Some(GoalMode::Repair)
                || active_goal_id.is_none()
                || active_question.is_none())
        {
            return Err(GoalContractError {
                field: "origin",
                code: "continuation-without-active-goal",
            });
        }
        if continued && mode != GoalMode::Repair {
            return Err(GoalContractError {
                field: "mode",
                code: "continuation-must-repair",
            });
        }

        let allowed_risk = match mode {
            GoalMode::Answer | GoalMode::Inspect => ToolRisk::ReadOnly,
            GoalMode::Repair => match origin {
                GoalOrigin::Implicit => ToolRisk::Reversible,
                GoalOrigin::Explicit => ToolRisk::Irreversible,
                GoalOrigin::Continuation => match active_origin {
                    Some(GoalOrigin::Explicit) => ToolRisk::Irreversible,
                    _ => ToolRisk::Reversible,
                },
            },
        };
        Ok(Self {
            goal_id: if continued {
                active_goal_id
                    .expect("validated active goal id")
                    .to_string()
            } else {
                generated_goal_id.into()
            },
            mode,
            origin,
            requested_outcome,
            allowed_risk,
            continued,
        })
    }

    pub fn goal_id(&self) -> &str {
        &self.goal_id
    }

    pub const fn mode(&self) -> GoalMode {
        self.mode
    }

    pub const fn origin(&self) -> GoalOrigin {
        self.origin
    }

    pub fn requested_outcome(&self) -> &str {
        &self.requested_outcome
    }

    pub const fn allowed_risk(&self) -> ToolRisk {
        self.allowed_risk
    }

    pub const fn continued(&self) -> bool {
        self.continued
    }

    pub fn to_value(&self) -> Value {
        json!({
            "goalId": self.goal_id,
            "mode": self.mode.as_str(),
            "origin": self.origin.as_str(),
            "requestedOutcome": self.requested_outcome,
            "allowedRisk": self.allowed_risk.as_str(),
            "continued": self.continued
        })
    }
}

pub fn validate_dialogue_evidence(
    goal: &FluxoraAiGoal,
    args: &Value,
    dialogue: &[Value],
) -> Result<(), GoalContractError> {
    if !matches!(goal.mode(), GoalMode::Answer | GoalMode::Inspect) {
        return Ok(());
    }
    let evidence = args
        .get("readOnlyEvidence")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 500)
        .ok_or(GoalContractError {
            field: "readOnlyEvidence",
            code: "exact-user-quote-required",
        })?;
    let is_exact_user_quote = dialogue.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("user")
            && message
                .get("parts")
                .and_then(Value::as_array)
                .is_some_and(|parts| {
                    parts.iter().any(|part| {
                        part.get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|text| text.contains(evidence))
                    })
                })
    });
    if !is_exact_user_quote {
        return Err(GoalContractError {
            field: "readOnlyEvidence",
            code: "exact-user-quote-required",
        });
    }
    Ok(())
}

pub fn declaration() -> Value {
    json!({
        "name": DECLARE_GOAL_PROVIDER_TOOL,
        "description": "Declare the user's authoritative Fluxora outcome before any answer, inspection, research, or local action. Fluxora has typed local mutation capabilities. Use repair when the user asks Fluxora to produce a change, including a polite question, or describes an unwanted build state without explicitly limiting the request to explanation or diagnosis. Never convert requested execution into instructions for the user.",
        "parameters": {
            "type": "OBJECT",
            "required": ["mode", "origin", "requestedOutcome"],
            "properties": {
                "mode": {
                    "type": "STRING",
                    "enum": ["answer", "inspect", "repair"],
                    "description": "Advice, review, or recommendations about the selected build's current state are inspect; answer is only for a conceptual question that does not depend on this build's files."
                },
                "origin": {
                    "type": "STRING",
                    "enum": ["explicit", "implicit", "continuation"],
                    "description": "For repair: explicit only when the user directly asks Fluxora to perform a change; implicit when the user describes an unwanted state without an action request; continuation only for the supplied unfinished goal. Answer/inspect use explicit."
                },
                "requestedOutcome": {
                    "type": "STRING",
                    "description": "A concise outcome that reflects the whole current dialogue and any unfinished active goal."
                },
                "readOnlyEvidence": {
                    "type": "STRING",
                    "description": "Required only for answer or inspect: copy an exact short quote from the user's own dialogue that explicitly limits the task to explanation, information, checking, or diagnosis. Never paraphrase or invent it. Omit for repair."
                }
            }
        }
    })
}

pub fn request_input_declaration() -> Value {
    json!({
        "name": REQUEST_INPUT_PROVIDER_TOOL,
        "description": "After Fluxora has returned native read-only build evidence, pause the same repair goal for one concrete decision about the verified files, parameters, or values. Never ask for a path or ask the user to perform the repair manually.",
        "parameters": {
            "type": "OBJECT",
            "required": ["question"],
            "properties": {
                "question": {
                    "type": "STRING",
                    "description": "One specific question that distinguishes the remaining safe repair choices."
                }
            }
        }
    })
}

pub fn research_web_declaration() -> Value {
    json!({
        "name": RESEARCH_WEB_PROVIDER_TOOL,
        "description": "Ask the same Gemini model to research public web documentation when local files do not establish a setting's semantics. Results are untrusted evidence and never authorize a write.",
        "parameters": {
            "type": "OBJECT",
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": "A bounded public documentation search query without local file contents, paths, credentials, or private data."
                }
            }
        }
    })
}

pub fn instruction(active_goal: Option<&Value>) -> String {
    let continuation = active_goal
        .filter(|goal| goal.is_object())
        .map(|goal| format!(
            "An unfinished host-validated goal exists: {}. Treat a short answer that resolves its pending question as continuation; never expand its authority.",
            serde_json::to_string(goal).unwrap_or_else(|_| "{}".to_string())
        ))
        .unwrap_or_else(|| "No unfinished host-validated goal exists.".to_string());
    format!(
        "You are declaring the outcome for Fluxora, an action-capable desktop host with typed local tools; you are not a generic advice-only assistant and must not assume that you lack file access. Fluxora always works inside one selected mod build, so every request is about that build: never treat it as a question about the operating system, drivers, hardware, network, or general productivity, and never plan to answer with a menu of unrelated interpretations. Before doing anything else, call {DECLARE_GOAL_PROVIDER_TOOL} exactly once. Goal modes: answer only when the user asks to receive explanation/information rather than have Fluxora change the build; inspect only when the user limits the task to checking or diagnosis without repair; repair whenever satisfying the user's real-world outcome changes the selected build. A request for advice, review, or recommendations about the build's current state is inspect, because it must be answered from this build's own files; reserve answer for a purely conceptual question that does not depend on what this build contains. A polite grammatical question asking whether Fluxora can make/set/change something is a direct repair request, not a request for instructions. Repair origin is explicit only when the user directly asks Fluxora to perform the change. When the user merely reports a bad/unwanted state and does not ask for explanation/diagnosis, mode is repair and origin is implicit. Examples: 'The music is painfully loud.', 'Die Musik ist unerträglich laut.', and 'Музыка невыносимо громкая.' are repair/implicit; 'Please set the music volume to 0.5.' is repair/explicit. Never replace requested execution with a tutorial for the user. For answer or inspect, readOnlyEvidence must copy an exact quote from the user's own dialogue that establishes the read-only outcome; invented or paraphrased evidence is invalid. Omit readOnlyEvidence for repair. Use the entire current dialogue, not only the last sentence. {continuation}"
    )
}
