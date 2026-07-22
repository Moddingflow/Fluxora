use serde_json::{json, Map, Value};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskKind {
    Action,
    Answer,
}

impl TaskKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Action => "action",
            Self::Answer => "answer",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderRouting {
    LocalRequired,
    LocalAuto,
    WebSearch,
    None,
}

impl ProviderRouting {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LocalRequired => "local-required",
            Self::LocalAuto => "local-auto",
            Self::WebSearch => "web-search",
            Self::None => "none",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum ToolDomain {
    Files,
    Mods,
    Plugins,
    Downloads,
    Installs,
    Profiles,
    Settings,
    Projects,
    FluxPack,
    General,
}

impl ToolDomain {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Files => "files",
            Self::Mods => "mods",
            Self::Plugins => "plugins",
            Self::Downloads => "downloads",
            Self::Installs => "installs",
            Self::Profiles => "profiles",
            Self::Settings => "settings",
            Self::Projects => "projects",
            Self::FluxPack => "fluxpack",
            Self::General => "general",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolOperation {
    Discover,
    Inspect,
    Stage,
    Commit,
    Mutate,
    Verify,
    RequestInput,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolRisk {
    ReadOnly,
    Reversible,
    Irreversible,
}

impl ToolRisk {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::Reversible => "reversible",
            Self::Irreversible => "irreversible-with-confirmation",
        }
    }

    const fn allows(self, candidate: Self) -> bool {
        match self {
            Self::ReadOnly => matches!(candidate, Self::ReadOnly),
            Self::Reversible => !matches!(candidate, Self::Irreversible),
            Self::Irreversible => true,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolVerification {
    SemanticResult,
    StagedState,
    NativePostcondition,
    FileCommit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolCompensation {
    None,
    DiscardStaged,
    Undo,
    DeleteCreated,
    RestorePrevious,
    ConfirmationRequired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ToolContract {
    pub provider_name: &'static str,
    pub internal_name: &'static str,
    pub operation: ToolOperation,
    pub domain: ToolDomain,
    pub risk: ToolRisk,
    pub verification: ToolVerification,
    pub compensation: ToolCompensation,
}

const fn contract(
    provider_name: &'static str,
    internal_name: &'static str,
    operation: ToolOperation,
    domain: ToolDomain,
    risk: ToolRisk,
    verification: ToolVerification,
    compensation: ToolCompensation,
) -> ToolContract {
    ToolContract {
        provider_name,
        internal_name,
        operation,
        domain,
        risk,
        verification,
        compensation,
    }
}

pub const TOOL_RESULT_PAGE_TOOL: &str = "local.tool_result.read_page";

pub const TOOL_CONTRACT_REGISTRY: &[ToolContract] = &[
    contract(
        "local_files_discover",
        "local.files.discover",
        ToolOperation::Discover,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_files_search",
        "local.files.search",
        ToolOperation::Discover,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_files_stat",
        "local.files.stat",
        ToolOperation::Inspect,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_text_read",
        "local.text.read",
        ToolOperation::Inspect,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_text_search",
        "local.text.search",
        ToolOperation::Discover,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_tool_result_read_page",
        TOOL_RESULT_PAGE_TOOL,
        ToolOperation::Inspect,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_json_query",
        "local.json.query",
        ToolOperation::Inspect,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_ini_query",
        "local.ini.query",
        ToolOperation::Inspect,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_config_inspect_recipe",
        "local.config.inspect_recipe",
        ToolOperation::Inspect,
        ToolDomain::Files,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_text_stage_patch",
        "local.text.stage_patch",
        ToolOperation::Stage,
        ToolDomain::Files,
        ToolRisk::Reversible,
        ToolVerification::StagedState,
        ToolCompensation::DiscardStaged,
    ),
    contract(
        "local_text_stage_create",
        "local.text.stage_create",
        ToolOperation::Stage,
        ToolDomain::Files,
        ToolRisk::Reversible,
        ToolVerification::StagedState,
        ToolCompensation::DiscardStaged,
    ),
    contract(
        "local_json_stage_set_pointer",
        "local.json.stage_set_pointer",
        ToolOperation::Stage,
        ToolDomain::Files,
        ToolRisk::Reversible,
        ToolVerification::StagedState,
        ToolCompensation::DiscardStaged,
    ),
    contract(
        "local_ini_stage_set_key",
        "local.ini.stage_set_key",
        ToolOperation::Stage,
        ToolDomain::Files,
        ToolRisk::Reversible,
        ToolVerification::StagedState,
        ToolCompensation::DiscardStaged,
    ),
    contract(
        "local_files_commit",
        "local.files.commit",
        ToolOperation::Commit,
        ToolDomain::Files,
        ToolRisk::Reversible,
        ToolVerification::FileCommit,
        ToolCompensation::Undo,
    ),
    contract(
        "local_mods_list",
        "local.mods.list",
        ToolOperation::Discover,
        ToolDomain::Mods,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_mods_set_enabled",
        "local.mods.set_enabled",
        ToolOperation::Mutate,
        ToolDomain::Mods,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::RestorePrevious,
    ),
    contract(
        "local_plugins_list",
        "local.plugins.list",
        ToolOperation::Discover,
        ToolDomain::Plugins,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_plugins_move",
        "local.plugins.move",
        ToolOperation::Mutate,
        ToolDomain::Plugins,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::RestorePrevious,
    ),
    contract(
        "local_downloads_list",
        "local.downloads.list",
        ToolOperation::Discover,
        ToolDomain::Downloads,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_downloads_cancel",
        "local.downloads.cancel",
        ToolOperation::Mutate,
        ToolDomain::Downloads,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::RestorePrevious,
    ),
    contract(
        "local_downloads_resume",
        "local.downloads.resume",
        ToolOperation::Mutate,
        ToolDomain::Downloads,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::RestorePrevious,
    ),
    contract(
        "local_installs_list",
        "local.installs.list",
        ToolOperation::Discover,
        ToolDomain::Installs,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_installs_submit_download",
        "local.installs.submit_download",
        ToolOperation::Mutate,
        ToolDomain::Installs,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::DeleteCreated,
    ),
    contract(
        "local_installs_get",
        "local.installs.get",
        ToolOperation::Verify,
        ToolDomain::Installs,
        ToolRisk::ReadOnly,
        ToolVerification::NativePostcondition,
        ToolCompensation::None,
    ),
    contract(
        "local_installs_cancel",
        "local.installs.cancel",
        ToolOperation::Mutate,
        ToolDomain::Installs,
        ToolRisk::Irreversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::ConfirmationRequired,
    ),
    contract(
        "local_profiles_list",
        "local.profiles.list",
        ToolOperation::Discover,
        ToolDomain::Profiles,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_profiles_create",
        "local.profiles.create",
        ToolOperation::Mutate,
        ToolDomain::Profiles,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::DeleteCreated,
    ),
    contract(
        "local_settings_get_language",
        "local.settings.get_language",
        ToolOperation::Inspect,
        ToolDomain::Settings,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_settings_set_language",
        "local.settings.set_language",
        ToolOperation::Mutate,
        ToolDomain::Settings,
        ToolRisk::Reversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::RestorePrevious,
    ),
    contract(
        "local_projects_current",
        "local.projects.current",
        ToolOperation::Inspect,
        ToolDomain::Projects,
        ToolRisk::ReadOnly,
        ToolVerification::SemanticResult,
        ToolCompensation::None,
    ),
    contract(
        "local_projects_request_create",
        "local.projects.request_create",
        ToolOperation::RequestInput,
        ToolDomain::Projects,
        ToolRisk::Irreversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::ConfirmationRequired,
    ),
    contract(
        "local_fluxpack_request_selection",
        "local.fluxpack.request_selection",
        ToolOperation::RequestInput,
        ToolDomain::FluxPack,
        ToolRisk::Irreversible,
        ToolVerification::NativePostcondition,
        ToolCompensation::ConfirmationRequired,
    ),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolValidationError {
    pub field: String,
    pub code: &'static str,
    pub hint: String,
}

#[derive(Clone, Copy)]
enum ParameterKind {
    String {
        non_empty: bool,
    },
    StringArray {
        non_empty: bool,
        allowed: &'static [&'static str],
    },
    Integer,
    Boolean,
    Enum(&'static [&'static str]),
}

#[derive(Clone, Copy)]
struct ParameterSpec {
    name: &'static str,
    required: bool,
    kind: ParameterKind,
}

#[derive(Clone)]
struct ToolSpec {
    internal_name: &'static str,
    description: &'static str,
    parameters: Vec<ParameterSpec>,
}

const STRING: ParameterKind = ParameterKind::String { non_empty: false };
const NON_EMPTY_STRING: ParameterKind = ParameterKind::String { non_empty: true };
const STRING_ARRAY: ParameterKind = ParameterKind::StringArray {
    non_empty: false,
    allowed: &[],
};
const NON_EMPTY_STRING_ARRAY: ParameterKind = ParameterKind::StringArray {
    non_empty: true,
    allowed: &[],
};
const SCOPES: ParameterKind = ParameterKind::StringArray {
    non_empty: false,
    allowed: &["build", "game", "downloads"],
};

const fn required(name: &'static str, kind: ParameterKind) -> ParameterSpec {
    ParameterSpec {
        name,
        required: true,
        kind,
    }
}

const fn optional(name: &'static str, kind: ParameterKind) -> ParameterSpec {
    ParameterSpec {
        name,
        required: false,
        kind,
    }
}

fn tool_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            internal_name: "local.files.discover",
            description: "Discover effective allowlisted files across registered build roots. Continue with revision and cursor until complete. Core owns unique, ambiguous, or not-found resolution. Never stage an ambiguous candidate; refine its exact relative path through local.files.search first.",
            parameters: vec![
                optional("scopes", SCOPES),
                required("aliases", NON_EMPTY_STRING_ARRAY),
                optional("extensions", STRING_ARRAY),
                optional("configHints", STRING_ARRAY),
                optional("semanticKeys", STRING_ARRAY),
                optional("revision", STRING),
                optional("cursor", STRING),
            ],
        },
        ToolSpec {
            internal_name: "local.files.search",
            description: "Search the complete allowlisted filename and relative-path index. Query must be non-empty.",
            parameters: vec![
                optional("scope", ParameterKind::Enum(&["build", "game", "downloads"])),
                required("query", NON_EMPTY_STRING),
                optional("revision", STRING),
                optional("cursor", STRING),
            ],
        },
        ToolSpec {
            internal_name: "local.files.stat",
            description: "Read allowlisted metadata for an opaque fileRef.",
            parameters: vec![required("fileRef", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.text.read",
            description: "Read bounded text through an opaque fileRef.",
            parameters: vec![
                required("fileRef", NON_EMPTY_STRING),
                optional("startLine", ParameterKind::Integer),
                optional("maxLines", ParameterKind::Integer),
                optional("maxBytes", ParameterKind::Integer),
            ],
        },
        ToolSpec {
            internal_name: "local.text.search",
            description: "Search a non-empty fixed string across allowlisted text files with revision-aware paging.",
            parameters: vec![
                optional("scope", ParameterKind::Enum(&["build", "game", "downloads"])),
                required("query", NON_EMPTY_STRING),
                optional("revision", STRING),
                optional("cursor", STRING),
            ],
        },
        ToolSpec {
            internal_name: TOOL_RESULT_PAGE_TOOL,
            description: "Continue a large prior tool response without repeating the native operation. Copy resultRef and nextOffset exactly from providerResultPage, then read pages until complete=true before claiming exhaustive results.",
            parameters: vec![
                required("resultRef", NON_EMPTY_STRING),
                required("offset", ParameterKind::Integer),
            ],
        },
        ToolSpec {
            internal_name: "local.json.query",
            description: "Query JSON or JSONC by RFC 6901 pointer.",
            parameters: vec![required("fileRef", NON_EMPTY_STRING), required("pointer", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.ini.query",
            description: "Query an INI section and key while preserving its line model.",
            parameters: vec![
                required("fileRef", NON_EMPTY_STRING),
                optional("section", STRING),
                required("key", NON_EMPTY_STRING),
            ],
        },
        ToolSpec {
            internal_name: "local.config.inspect_recipe",
            description: "Preflight an allowlisted JSON or JSONC pointer and normalize its current and requested JSON values before staging.",
            parameters: vec![
                required("fileRef", NON_EMPTY_STRING),
                required("targetPointer", NON_EMPTY_STRING),
                required("requestedValue", NON_EMPTY_STRING),
            ],
        },
        ToolSpec {
            internal_name: "local.text.stage_patch",
            description: "Stage one exact-text replacement. This does not write; call local.files.commit after all files are staged.",
            parameters: vec![
                required("fileRef", NON_EMPTY_STRING),
                required("revision", NON_EMPTY_STRING),
                required("baseSha256", NON_EMPTY_STRING),
                required("expectedText", STRING),
                required("replacementText", STRING),
                required("format", ParameterKind::Enum(&["plain-text", "exact-text"])),
            ],
        },
        ToolSpec {
            internal_name: "local.text.stage_create",
            description: "Stage creation of one allowlisted text or config file under an opaque folder ref. This never overwrites.",
            parameters: vec![
                required("parentRef", NON_EMPTY_STRING),
                required("fileName", NON_EMPTY_STRING),
                required("content", STRING),
                required("expectedAbsent", ParameterKind::Boolean),
                required("format", ParameterKind::Enum(&["plain-text", "json", "jsonc", "ini", "exact-text"])),
            ],
        },
        ToolSpec {
            internal_name: "local.json.stage_set_pointer",
            description: "Stage one server-validated JSON or JSONC pointer change after local.config.inspect_recipe. Use the inspection's targetPointer, currentValue as expectedValue, encodedValue as value, and format exactly. The source mod remains unchanged.",
            parameters: vec![
                required("fileRef", NON_EMPTY_STRING),
                required("revision", NON_EMPTY_STRING),
                required("baseSha256", NON_EMPTY_STRING),
                required("pointer", NON_EMPTY_STRING),
                required("expectedValue", NON_EMPTY_STRING),
                required("value", NON_EMPTY_STRING),
                required("format", ParameterKind::Enum(&["json", "jsonc"])),
                optional("allowKnownConflict", ParameterKind::Boolean),
            ],
        },
        ToolSpec {
            internal_name: "local.ini.stage_set_key",
            description: "Stage one server-validated INI set, add, or remove operation. The source mod remains unchanged.",
            parameters: vec![
                required("fileRef", NON_EMPTY_STRING),
                required("revision", NON_EMPTY_STRING),
                required("baseSha256", NON_EMPTY_STRING),
                optional("section", STRING),
                required("key", NON_EMPTY_STRING),
                required("expectedValue", STRING),
                required("value", STRING),
                required("operation", ParameterKind::Enum(&["set", "add", "remove"])),
            ],
        },
        ToolSpec {
            internal_name: "local.files.commit",
            description: "Atomically validate, write, reread, and verify every staged file as one bounded batch. Required for action completion.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.mods.list",
            description: "List installed mods through opaque modRef values. Native paths are never returned.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.mods.set_enabled",
            description: "Enable or disable one discovered modRef. Fluxora rereads native persisted state and returns an Undo token.",
            parameters: vec![
                required("modRef", NON_EMPTY_STRING),
                required("isEnabled", ParameterKind::Boolean),
            ],
        },
        ToolSpec {
            internal_name: "local.plugins.list",
            description: "List the current profile plugin order through opaque pluginRef values, without native paths.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.plugins.move",
            description: "Move one discovered pluginRef to a non-negative target index, then verify the persisted order.",
            parameters: vec![
                required("pluginRef", NON_EMPTY_STRING),
                required("targetIndex", ParameterKind::Integer),
            ],
        },
        ToolSpec {
            internal_name: "local.downloads.list",
            description: "List download state through opaque downloadRef values, without local paths.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.downloads.cancel",
            description: "Cancel one active downloadRef and verify its native state. The action can be compensated by resume when native state permits.",
            parameters: vec![required("downloadRef", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.downloads.resume",
            description: "Resume one discovered downloadRef and verify its native state. The action can be compensated by cancel.",
            parameters: vec![required("downloadRef", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.installs.list",
            description: "List native install operations through opaque operationRef values.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.installs.submit_download",
            description: "Submit installation of a discovered installable downloadRef. Fluxora keeps the native source path private and returns a cancellable operationRef.",
            parameters: vec![
                required("downloadRef", NON_EMPTY_STRING),
                required("modName", NON_EMPTY_STRING),
            ],
        },
        ToolSpec {
            internal_name: "local.installs.get",
            description: "Read one operationRef and mark success only after the native install reaches completed.",
            parameters: vec![required("operationRef", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.installs.cancel",
            description: "Cancel one discovered native operationRef and verify the cancelled state.",
            parameters: vec![required("operationRef", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.profiles.list",
            description: "List profiles for the current selected build.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.profiles.create",
            description: "Create a profile inside the selected build and verify it by rereading the native profile list. Returns an Undo token.",
            parameters: vec![required("profileName", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.settings.get_language",
            description: "Read the current Fluxora application language.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.settings.set_language",
            description: "Set an allowed Fluxora language and verify it by native reread. Returns an Undo token.",
            parameters: vec![required(
                "language",
                ParameterKind::Enum(&["en-us", "ru-ru", "de-de"]),
            )],
        },
        ToolSpec {
            internal_name: "local.projects.current",
            description: "Read the selected project metadata without exposing its config or installation paths.",
            parameters: vec![],
        },
        ToolSpec {
            internal_name: "local.projects.request_create",
            description: "Request the exact user decision needed before native project creation. Arbitrary model-supplied filesystem paths are never accepted.",
            parameters: vec![required("projectName", NON_EMPTY_STRING)],
        },
        ToolSpec {
            internal_name: "local.fluxpack.request_selection",
            description: "Request selection and confirmation for FluxPack work. The model cannot supply an arbitrary local pack path.",
            parameters: vec![],
        },
    ]
}

pub fn tool_contract(internal_name: &str) -> Option<&'static ToolContract> {
    TOOL_CONTRACT_REGISTRY
        .iter()
        .find(|contract| contract.internal_name == internal_name)
}

pub fn provider_tool_name(internal_name: &str) -> Option<&'static str> {
    tool_contract(internal_name).map(|contract| contract.provider_name)
}

pub fn internal_tool_name(call_name: &str) -> Option<&'static str> {
    TOOL_CONTRACT_REGISTRY
        .iter()
        .find(|mapping| mapping.provider_name == call_name || mapping.internal_name == call_name)
        .map(|mapping| mapping.internal_name)
}

fn parameter_schema(kind: ParameterKind) -> Value {
    match kind {
        ParameterKind::String { .. } => json!({ "type": "STRING" }),
        ParameterKind::StringArray { allowed, .. } => {
            let mut items = json!({ "type": "STRING" });
            if !allowed.is_empty() {
                items["enum"] = json!(allowed);
            }
            json!({ "type": "ARRAY", "items": items })
        }
        ParameterKind::Integer => json!({ "type": "INTEGER" }),
        ParameterKind::Boolean => json!({ "type": "BOOLEAN" }),
        ParameterKind::Enum(values) => json!({ "type": "STRING", "enum": values }),
    }
}

pub fn typed_tool_declarations() -> Vec<Value> {
    tool_specs()
        .into_iter()
        .map(|spec| {
            let required = spec
                .parameters
                .iter()
                .filter(|parameter| parameter.required)
                .map(|parameter| parameter.name)
                .collect::<Vec<_>>();
            let properties = spec
                .parameters
                .iter()
                .map(|parameter| (parameter.name.to_string(), parameter_schema(parameter.kind)))
                .collect::<Map<_, _>>();
            json!({
                "name": provider_tool_name(spec.internal_name)
                    .expect("every tool contract entry must have a provider-safe name"),
                "description": spec.description,
                "parameters": { "type": "OBJECT", "required": required, "properties": properties }
            })
        })
        .collect()
}

#[cfg(test)]
pub fn tool_declarations_for_task_kind(task_kind: TaskKind) -> Vec<Value> {
    tool_declarations_for_risk(match task_kind {
        TaskKind::Action => ToolRisk::Irreversible,
        TaskKind::Answer => ToolRisk::ReadOnly,
    })
}

pub fn tool_declarations_for_risk(allowed_risk: ToolRisk) -> Vec<Value> {
    typed_tool_declarations()
        .into_iter()
        .filter(|declaration| {
            let Some(contract) = declaration
                .get("name")
                .and_then(Value::as_str)
                .and_then(internal_tool_name)
                .and_then(tool_contract)
            else {
                return false;
            };
            allowed_risk.allows(contract.risk)
        })
        .collect()
}

pub fn normalize_tool_args(name: &str, args: &Value) -> Value {
    if !matches!(name, "local.files.search" | "local.text.search") {
        return args.clone();
    }
    let mut normalized = args.as_object().cloned().unwrap_or_default();
    let scope_is_empty = normalized
        .get("scope")
        .and_then(Value::as_str)
        .is_none_or(|scope| scope.trim().is_empty());
    if scope_is_empty {
        normalized.insert("scope".to_string(), json!("build"));
    }
    Value::Object(normalized)
}

fn validation_error(
    field: impl Into<String>,
    code: &'static str,
    hint: impl Into<String>,
) -> ToolValidationError {
    ToolValidationError {
        field: field.into(),
        code,
        hint: hint.into(),
    }
}

pub fn validate_tool_call(name: &str, args: &Value) -> Result<(), ToolValidationError> {
    let spec = tool_specs()
        .into_iter()
        .find(|spec| spec.internal_name == name)
        .ok_or_else(|| {
            validation_error(
                "name",
                "unknown-tool",
                "Use one declared Fluxora tool name.",
            )
        })?;
    let object = args.as_object().ok_or_else(|| {
        validation_error(
            "args",
            "expected-object",
            "Pass a JSON object for tool arguments.",
        )
    })?;

    if let Some(field) = object.keys().find(|field| {
        !spec
            .parameters
            .iter()
            .any(|parameter| parameter.name == field.as_str())
    }) {
        return Err(validation_error(
            field,
            "unknown-field",
            "Remove this field and use only the declared operation arguments.",
        ));
    }

    for parameter in &spec.parameters {
        let Some(value) = object.get(parameter.name) else {
            if parameter.required {
                return Err(validation_error(
                    parameter.name,
                    "required",
                    format!("Provide the required '{}' field.", parameter.name),
                ));
            }
            continue;
        };
        match parameter.kind {
            ParameterKind::String { non_empty } => {
                let Some(text) = value.as_str() else {
                    return Err(validation_error(
                        parameter.name,
                        "expected-string",
                        format!("'{}' must be a string.", parameter.name),
                    ));
                };
                if non_empty && text.trim().is_empty() {
                    return Err(validation_error(
                        parameter.name,
                        "required-non-empty",
                        format!("Provide a non-empty '{}' string.", parameter.name),
                    ));
                }
            }
            ParameterKind::StringArray { non_empty, allowed } => {
                let Some(items) = value.as_array() else {
                    return Err(validation_error(
                        parameter.name,
                        "expected-array",
                        format!("'{}' must be an array of strings.", parameter.name),
                    ));
                };
                if non_empty && items.is_empty() {
                    return Err(validation_error(
                        parameter.name,
                        "required-non-empty",
                        format!("Provide at least one non-empty '{}' value.", parameter.name),
                    ));
                }
                for item in items {
                    let Some(text) = item.as_str() else {
                        return Err(validation_error(
                            parameter.name,
                            "expected-string-array",
                            format!("Every '{}' item must be a string.", parameter.name),
                        ));
                    };
                    if text.trim().is_empty() {
                        return Err(validation_error(
                            parameter.name,
                            "required-non-empty",
                            format!("Every '{}' item must be non-empty.", parameter.name),
                        ));
                    }
                    if !allowed.is_empty() && !allowed.contains(&text) {
                        return Err(validation_error(
                            parameter.name,
                            "invalid-enum",
                            format!("Use one of: {}.", allowed.join(", ")),
                        ));
                    }
                }
            }
            ParameterKind::Integer if value.as_u64().is_none() => {
                return Err(validation_error(
                    parameter.name,
                    "expected-integer",
                    format!("'{}' must be a non-negative integer.", parameter.name),
                ));
            }
            ParameterKind::Boolean if value.as_bool().is_none() => {
                return Err(validation_error(
                    parameter.name,
                    "expected-boolean",
                    format!("'{}' must be true or false.", parameter.name),
                ));
            }
            ParameterKind::Enum(values) => {
                let Some(text) = value.as_str() else {
                    return Err(validation_error(
                        parameter.name,
                        "expected-string",
                        format!("'{}' must be a string enum.", parameter.name),
                    ));
                };
                if !values.contains(&text) {
                    return Err(validation_error(
                        parameter.name,
                        "invalid-enum",
                        format!("Use one of: {}.", values.join(", ")),
                    ));
                }
            }
            _ => {}
        }
    }

    if name == "local.text.stage_create"
        && object.get("expectedAbsent").and_then(Value::as_bool) != Some(true)
    {
        return Err(validation_error(
            "expectedAbsent",
            "must-be-true",
            "Set expectedAbsent=true; Fluxora AI never overwrites during create.",
        ));
    }
    Ok(())
}

pub fn is_staging_tool(name: &str) -> bool {
    tool_contract(name).is_some_and(|contract| contract.operation == ToolOperation::Stage)
}

pub fn is_commit_tool(name: &str) -> bool {
    tool_contract(name).is_some_and(|contract| contract.operation == ToolOperation::Commit)
}

pub const fn provider_routing(task_kind: TaskKind, has_file_workspace: bool) -> ProviderRouting {
    match (task_kind, has_file_workspace) {
        (TaskKind::Action, true) => ProviderRouting::LocalRequired,
        (TaskKind::Action, false) => ProviderRouting::None,
        (TaskKind::Answer, true) => ProviderRouting::LocalAuto,
        (TaskKind::Answer, false) => ProviderRouting::WebSearch,
    }
}
