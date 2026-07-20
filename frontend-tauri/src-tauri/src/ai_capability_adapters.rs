use serde_json::{json, Map, Value};
use std::collections::HashMap;

use crate::ai_tool_contract::{tool_contract, ToolDomain, ToolRisk};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum AiEntityKind {
    Mod,
    Plugin,
    Download,
    Install,
}

impl AiEntityKind {
    const fn prefix(self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::Plugin => "plugin",
            Self::Download => "download",
            Self::Install => "operation",
        }
    }
}

#[derive(Default)]
pub struct AiEntityRefRegistry {
    entries: HashMap<String, (AiEntityKind, String)>,
}

impl AiEntityRefRegistry {
    pub fn register(&mut self, kind: AiEntityKind, native_id: &str) -> String {
        if let Some((opaque_ref, _)) = self
            .entries
            .iter()
            .find(|(_, (entry_kind, entry_id))| *entry_kind == kind && entry_id == native_id)
        {
            return opaque_ref.clone();
        }
        let base = format!("{}_{}", kind.prefix(), stable_hash(native_id));
        let mut opaque_ref = base.clone();
        let mut suffix = 1_u16;
        while self.entries.contains_key(&opaque_ref) {
            suffix = suffix.saturating_add(1);
            opaque_ref = format!("{base}_{suffix}");
        }
        self.entries
            .insert(opaque_ref.clone(), (kind, native_id.to_string()));
        opaque_ref
    }

    pub fn resolve(&self, kind: AiEntityKind, opaque_ref: &str) -> Option<&str> {
        self.entries
            .get(opaque_ref)
            .filter(|(entry_kind, _)| *entry_kind == kind)
            .map(|(_, native_id)| native_id.as_str())
    }

    pub fn current_refs(&self, kind: AiEntityKind) -> Vec<String> {
        let mut refs = self
            .entries
            .iter()
            .filter(|(_, (entry_kind, _))| *entry_kind == kind)
            .map(|(opaque_ref, _)| opaque_ref.clone())
            .collect::<Vec<_>>();
        refs.sort();
        refs
    }
}

fn stable_hash(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn copy_fields(source: &Map<String, Value>, names: &[&str]) -> Map<String, Value> {
    names
        .iter()
        .filter_map(|name| {
            source
                .get(*name)
                .cloned()
                .map(|value| ((*name).to_string(), value))
        })
        .collect()
}

fn array_from_payload<'a>(payload: &'a Value, field: &str) -> &'a [Value] {
    payload
        .get(field)
        .and_then(Value::as_array)
        .or_else(|| payload.as_array())
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub fn sanitize_mod_workspace(payload: &Value, refs: &mut AiEntityRefRegistry) -> Value {
    let installed_mods = array_from_payload(payload, "installedMods")
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let native_id = item.get("id").and_then(Value::as_str)?;
            let mut clean = copy_fields(
                item,
                &[
                    "name",
                    "version",
                    "latestVersion",
                    "updateStatus",
                    "conflictStatus",
                    "fileCount",
                    "isEnabled",
                    "hasUpdate",
                    "isLocal",
                    "isTranslation",
                    "isPatch",
                ],
            );
            clean.insert(
                "modRef".to_string(),
                json!(refs.register(AiEntityKind::Mod, native_id)),
            );
            Some(Value::Object(clean))
        })
        .collect::<Vec<_>>();
    json!({ "mods": installed_mods, "count": installed_mods.len() })
}

pub fn sanitize_plugins(payload: &Value, refs: &mut AiEntityRefRegistry) -> Value {
    let plugins = array_from_payload(payload, "items")
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let native_id = item
                .get("orderId")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)?;
            let mut clean = copy_fields(
                item,
                &[
                    "kind",
                    "order",
                    "isSeparator",
                    "isPlugin",
                    "name",
                    "separatorTitle",
                    "extension",
                    "sourceMod",
                    "isEnabled",
                    "isMaster",
                    "isLight",
                    "isLocked",
                    "lockReason",
                    "masterFiles",
                    "missingMasters",
                ],
            );
            clean.insert(
                "pluginRef".to_string(),
                json!(refs.register(AiEntityKind::Plugin, native_id)),
            );
            Some(Value::Object(clean))
        })
        .collect::<Vec<_>>();
    json!({ "plugins": plugins, "count": plugins.len() })
}

pub fn sanitize_downloads(payload: &Value, refs: &mut AiEntityRefRegistry) -> Value {
    let downloads = array_from_payload(payload, "items")
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let native_id = item
                .get("localPath")
                .or_else(|| item.get("downloadPath"))
                .and_then(Value::as_str)?;
            let mut clean = copy_fields(
                item,
                &[
                    "name",
                    "fileName",
                    "source",
                    "buildStatus",
                    "transferState",
                    "sizeText",
                    "progressPercent",
                    "progressText",
                    "etaText",
                    "downloadSpeedText",
                    "isDownloading",
                    "hasResolvedFileName",
                    "canResume",
                    "canInstall",
                    "canDelete",
                ],
            );
            clean.insert(
                "downloadRef".to_string(),
                json!(refs.register(AiEntityKind::Download, native_id)),
            );
            Some(Value::Object(clean))
        })
        .collect::<Vec<_>>();
    json!({ "downloads": downloads, "count": downloads.len() })
}

pub fn sanitize_install(payload: &Value, refs: &mut AiEntityRefRegistry) -> Value {
    let Some(item) = payload.as_object() else {
        return json!({});
    };
    let Some(operation_id) = item.get("operationId").and_then(Value::as_str) else {
        return json!({});
    };
    let mut clean = copy_fields(
        item,
        &[
            "sourceKind",
            "profileName",
            "state",
            "stage",
            "progressPercent",
            "indeterminate",
            "errorCode",
        ],
    );
    if let Some(installed) = item.get("result").and_then(Value::as_object) {
        clean.insert(
            "installedMod".to_string(),
            Value::Object(copy_fields(
                installed,
                &["name", "version", "isEnabled", "fileCount"],
            )),
        );
    }
    clean.insert(
        "operationRef".to_string(),
        json!(refs.register(AiEntityKind::Install, operation_id)),
    );
    let state = item
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let progress = item
        .get("progressPercent")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    clean.insert(
        "revision".to_string(),
        json!(format!("{state}:{progress:.2}")),
    );
    Value::Object(clean)
}

pub fn sanitize_installs(payload: &Value, refs: &mut AiEntityRefRegistry) -> Value {
    let installs = array_from_payload(payload, "items")
        .iter()
        .map(|item| sanitize_install(item, refs))
        .filter(|item| item.get("operationRef").is_some())
        .collect::<Vec<_>>();
    json!({ "installs": installs, "count": installs.len() })
}

pub fn find_mod_enabled(payload: &Value, native_id: &str) -> Option<bool> {
    array_from_payload(payload, "installedMods")
        .iter()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(native_id))
        .and_then(|item| item.get("isEnabled"))
        .and_then(Value::as_bool)
}

pub fn find_plugin_order(payload: &Value, native_id: &str) -> Option<u64> {
    array_from_payload(payload, "items")
        .iter()
        .find(|item| {
            item.get("orderId")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                == Some(native_id)
        })
        .and_then(|item| item.get("order"))
        .and_then(Value::as_u64)
}

pub fn find_download_state<'a>(payload: &'a Value, native_id: &str) -> Option<&'a str> {
    array_from_payload(payload, "items")
        .iter()
        .find(|item| {
            item.get("localPath")
                .or_else(|| item.get("downloadPath"))
                .and_then(Value::as_str)
                == Some(native_id)
        })
        .and_then(|item| item.get("transferState"))
        .and_then(Value::as_str)
}

pub fn find_download_can_install(payload: &Value, native_id: &str) -> Option<bool> {
    array_from_payload(payload, "items")
        .iter()
        .find(|item| {
            item.get("localPath")
                .or_else(|| item.get("downloadPath"))
                .and_then(Value::as_str)
                == Some(native_id)
        })
        .and_then(|item| item.get("canInstall"))
        .and_then(Value::as_bool)
}

pub fn is_capability_tool(name: &str) -> bool {
    tool_contract(name).is_some_and(|contract| contract.domain != ToolDomain::Files)
}

pub fn is_read_only_capability_tool(name: &str) -> bool {
    tool_contract(name).is_some_and(|contract| {
        contract.domain != ToolDomain::Files && contract.risk == ToolRisk::ReadOnly
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_refs_are_stable_and_never_reveal_absolute_paths() {
        let mut refs = AiEntityRefRegistry::default();
        let path = r"C:\Builds\Example\mods\SkyUI";
        let first = refs.register(AiEntityKind::Mod, path);
        assert_eq!(refs.register(AiEntityKind::Mod, path), first);
        assert!(!first.contains("Builds"));
        assert_eq!(refs.resolve(AiEntityKind::Mod, &first), Some(path));
        assert_eq!(refs.resolve(AiEntityKind::Download, &first), None);
    }

    #[test]
    fn domain_payloads_remove_native_paths_and_keep_actionable_refs() {
        let mut refs = AiEntityRefRegistry::default();
        let mods = sanitize_mod_workspace(
            &json!({ "installedMods": [{
                "id": "C:\\Builds\\Example\\mods\\SkyUI",
                "name": "SkyUI",
                "version": "5.2",
                "isEnabled": true
            }]}),
            &mut refs,
        );
        let downloads = sanitize_downloads(
            &json!([{ "localPath": "C:\\Downloads\\SkyUI.7z", "fileName": "SkyUI.7z", "transferState": "idle", "canInstall": true }]),
            &mut refs,
        );
        let encoded = format!("{mods}{downloads}");
        assert!(!encoded.contains("C:\\\\"));
        assert!(encoded.contains("modRef"));
        assert!(encoded.contains("downloadRef"));
    }

    #[test]
    fn verification_helpers_match_native_postconditions() {
        let mods = json!({ "installedMods": [{ "id": "native-mod", "isEnabled": false }] });
        let plugins = json!([{ "orderId": "plugin-order", "order": 4 }]);
        let downloads = json!([{ "localPath": "download-path", "transferState": "paused" }]);
        assert_eq!(find_mod_enabled(&mods, "native-mod"), Some(false));
        assert_eq!(find_plugin_order(&plugins, "plugin-order"), Some(4));
        assert_eq!(
            find_download_state(&downloads, "download-path"),
            Some("paused")
        );
        let installable = json!([{ "localPath": "download-path", "canInstall": true }]);
        assert_eq!(
            find_download_can_install(&installable, "download-path"),
            Some(true)
        );
    }
}
