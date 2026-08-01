use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const MAX_ACTIVATION_BYTES: usize = 2 * 1024;
pub(crate) const MAX_INBOX_ITEMS: usize = 32;
const CANONICAL_ACTIVATION_PREFIX: &str = "moddingflow://download?";
const LEGACY_ACTIVATION_PREFIX: &str = "fluxora://moddingflow/download?";
const MAX_OPERATION_ID_BYTES: usize = 256;
static NEXT_ACTIVATION_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FluxoraActivationAction {
    Download,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FluxoraActivationSource {
    Startup,
    DeepLink,
    SecondInstance,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ParsedFluxoraActivation {
    pub(crate) version: u8,
    pub(crate) action: FluxoraActivationAction,
    pub(crate) artifact_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FluxoraActivationItem {
    pub(crate) activation_id: String,
    pub(crate) version: u8,
    pub(crate) action: FluxoraActivationAction,
    pub(crate) artifact_id: String,
    pub(crate) timestamp: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum FluxoraActivationCapture {
    Queued(FluxoraActivationItem),
    Duplicate { activation_id: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FluxoraActivationParseError {
    TooLarge,
    InvalidEnvelope,
    InvalidQuery,
    UnknownParameter,
    DuplicateParameter,
    EmptyParameter,
    UnsupportedVersion,
    InvalidArtifactId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FluxoraActivationInboxError {
    Parse(FluxoraActivationParseError),
    Full,
    OperationIdRequired,
    InvalidOperationId,
    ActivationNotFound,
}

impl From<FluxoraActivationParseError> for FluxoraActivationInboxError {
    fn from(value: FluxoraActivationParseError) -> Self {
        Self::Parse(value)
    }
}

pub(crate) fn parse_fluxora_activation(
    value: &str,
) -> Result<ParsedFluxoraActivation, FluxoraActivationParseError> {
    if value.len() > MAX_ACTIVATION_BYTES {
        return Err(FluxoraActivationParseError::TooLarge);
    }
    if value.is_empty()
        || value.bytes().any(|byte| byte.is_ascii_control())
        || value.contains('%')
        || value.contains('#')
    {
        return Err(FluxoraActivationParseError::InvalidEnvelope);
    }

    let query = value
        .strip_prefix(CANONICAL_ACTIVATION_PREFIX)
        .or_else(|| value.strip_prefix(LEGACY_ACTIVATION_PREFIX))
        .ok_or(FluxoraActivationParseError::InvalidEnvelope)?;
    if query.is_empty() || query.contains('?') {
        return Err(FluxoraActivationParseError::InvalidQuery);
    }

    let mut version = None;
    let mut artifact_id = None;
    for parameter in query.split('&') {
        if parameter.is_empty() {
            return Err(FluxoraActivationParseError::EmptyParameter);
        }
        let (name, value) = parameter
            .split_once('=')
            .ok_or(FluxoraActivationParseError::InvalidQuery)?;
        if name.is_empty() || value.is_empty() || value.contains('=') {
            return Err(FluxoraActivationParseError::EmptyParameter);
        }

        match name {
            "v" => set_once(&mut version, value)?,
            "artifact_id" => set_once(&mut artifact_id, value)?,
            _ => return Err(FluxoraActivationParseError::UnknownParameter),
        }
    }

    let version = version.ok_or(FluxoraActivationParseError::InvalidQuery)?;
    if version != "1" {
        return Err(FluxoraActivationParseError::UnsupportedVersion);
    }
    let artifact_id = artifact_id.ok_or(FluxoraActivationParseError::InvalidQuery)?;
    if !is_canonical_lowercase_uuid(artifact_id) {
        return Err(FluxoraActivationParseError::InvalidArtifactId);
    }

    Ok(ParsedFluxoraActivation {
        version: 1,
        action: FluxoraActivationAction::Download,
        artifact_id: artifact_id.to_string(),
    })
}

fn set_once<'a>(
    slot: &mut Option<&'a str>,
    value: &'a str,
) -> Result<(), FluxoraActivationParseError> {
    if slot.is_some() {
        return Err(FluxoraActivationParseError::DuplicateParameter);
    }
    *slot = Some(value);
    Ok(())
}

fn is_canonical_lowercase_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }

    let bytes = value.as_bytes();
    bytes.iter().copied().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            byte == b'-'
        } else {
            byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
        }
    }) && (b'1'..=b'8').contains(&bytes[14])
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
}

#[derive(Default)]
pub(crate) struct FluxoraActivationInbox {
    items: VecDeque<FluxoraActivationItem>,
}

impl FluxoraActivationInbox {
    pub(crate) fn capture(
        &mut self,
        value: &str,
        source: FluxoraActivationSource,
    ) -> Result<FluxoraActivationCapture, FluxoraActivationInboxError> {
        self.capture_at(value, source, unix_timestamp_millis())
    }

    fn capture_at(
        &mut self,
        value: &str,
        source: FluxoraActivationSource,
        timestamp: u64,
    ) -> Result<FluxoraActivationCapture, FluxoraActivationInboxError> {
        let parsed = parse_fluxora_activation(value)?;
        match source {
            FluxoraActivationSource::Startup
            | FluxoraActivationSource::DeepLink
            | FluxoraActivationSource::SecondInstance => {}
        }

        if let Some(existing) = self
            .items
            .iter()
            .find(|item| item.artifact_id == parsed.artifact_id)
        {
            return Ok(FluxoraActivationCapture::Duplicate {
                activation_id: existing.activation_id.clone(),
            });
        }
        if self.items.len() >= MAX_INBOX_ITEMS {
            return Err(FluxoraActivationInboxError::Full);
        }

        let item = FluxoraActivationItem {
            activation_id: new_opaque_activation_id(),
            version: parsed.version,
            action: parsed.action,
            artifact_id: parsed.artifact_id,
            timestamp,
        };
        self.items.push_back(item.clone());
        Ok(FluxoraActivationCapture::Queued(item))
    }

    pub(crate) fn snapshot(&self) -> Vec<FluxoraActivationItem> {
        self.items.iter().cloned().collect()
    }

    pub(crate) fn remove_for_delivery(&mut self, activation_id: &str) -> bool {
        let Some(index) = self
            .items
            .iter()
            .position(|item| item.activation_id == activation_id)
        else {
            return false;
        };
        self.items.remove(index).is_some()
    }

    pub(crate) fn accept(
        &mut self,
        activation_id: &str,
        operation_id: &str,
    ) -> Result<FluxoraActivationItem, FluxoraActivationInboxError> {
        self.remove(activation_id, operation_id)
    }

    pub(crate) fn dismiss(
        &mut self,
        activation_id: &str,
        operation_id: &str,
    ) -> Result<FluxoraActivationItem, FluxoraActivationInboxError> {
        self.remove(activation_id, operation_id)
    }

    fn remove(
        &mut self,
        activation_id: &str,
        operation_id: &str,
    ) -> Result<FluxoraActivationItem, FluxoraActivationInboxError> {
        validate_operation_id(operation_id)?;
        let index = self
            .items
            .iter()
            .position(|item| item.activation_id == activation_id)
            .ok_or(FluxoraActivationInboxError::ActivationNotFound)?;
        self.items
            .remove(index)
            .ok_or(FluxoraActivationInboxError::ActivationNotFound)
    }
}

fn validate_operation_id(value: &str) -> Result<(), FluxoraActivationInboxError> {
    if value.trim().is_empty() {
        return Err(FluxoraActivationInboxError::OperationIdRequired);
    }
    if value.len() > MAX_OPERATION_ID_BYTES
        || value.trim() != value
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(FluxoraActivationInboxError::InvalidOperationId);
    }
    Ok(())
}

fn unix_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn new_opaque_activation_id() -> String {
    let nonce = NEXT_ACTIVATION_NONCE.fetch_add(1, Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut hasher = Sha256::new();
    hasher.update(now.to_le_bytes());
    hasher.update(nonce.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    let digest = hasher.finalize();

    let mut id = String::with_capacity(36);
    id.push_str("act_");
    for byte in &digest[..16] {
        write!(&mut id, "{byte:02x}").expect("writing to String cannot fail");
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn parses_the_canonical_contract_and_exact_legacy_alias() {
        let parsed = parse_fluxora_activation(&activation(ARTIFACT_ID)).expect("valid activation");

        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.action, FluxoraActivationAction::Download);
        assert_eq!(parsed.artifact_id, ARTIFACT_ID);
        assert_eq!(
            parse_fluxora_activation(&legacy_activation(ARTIFACT_ID))
                .expect("legacy alias remains compatible"),
            parsed
        );
        let reversed = format!("moddingflow://download?artifact_id={ARTIFACT_ID}&v=1");
        assert_eq!(
            parse_fluxora_activation(&reversed).expect("parameter order is not semantic"),
            parsed
        );
    }

    #[test]
    fn rejects_oversized_case_variant_credential_fragment_and_noncanonical_inputs() {
        let uppercase_uuid = ARTIFACT_ID.to_ascii_uppercase();
        for invalid in [
            "ModdingFlow://download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "moddingflow://Download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "moddingflow://user@download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "moddingflow://download:80?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "Fluxora://moddingflow/download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "fluxora://ModdingFlow/download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "fluxora://moddingflow/Download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "fluxora://user@moddingflow/download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            "fluxora://moddingflow:80/download?v=1&artifact_id=01234567-89ab-4cde-8fab-0123456789ab".to_string(),
            format!("{}#private", activation(ARTIFACT_ID)),
            activation(&uppercase_uuid),
            activation("00000000-0000-0000-0000-000000000000"),
            activation("01234567-89ab-0cde-8fab-0123456789ab"),
            activation("01234567-89ab-4cde-7fab-0123456789ab"),
            activation("{01234567-89ab-4cde-8fab-0123456789ab}"),
            activation("0123456789ab4cde8fab0123456789ab"),
        ] {
            assert!(
                parse_fluxora_activation(&invalid).is_err(),
                "accepted noncanonical activation"
            );
        }

        assert_eq!(
            parse_fluxora_activation(&"x".repeat(MAX_ACTIVATION_BYTES + 1)),
            Err(FluxoraActivationParseError::TooLarge)
        );
    }

    #[test]
    fn rejects_unknown_duplicate_empty_missing_and_unsupported_parameters() {
        for invalid in [
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&extra=1"),
            format!("moddingflow://download?v=1&v=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=&artifact_id={ARTIFACT_ID}"),
            "moddingflow://download?v=1&artifact_id=".to_string(),
            "moddingflow://download?v=1".to_string(),
            format!("moddingflow://download?v=2&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=01&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1&&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&token=secret"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&code=secret"),
            format!("moddingflow://download?v=1&artifact_id={ARTIFACT_ID}&signed_url=https://example.invalid"),
        ] {
            assert!(
                parse_fluxora_activation(&invalid).is_err(),
                "accepted invalid parameter set"
            );
        }
    }

    #[test]
    fn rejects_encoded_path_query_and_separator_confusion() {
        for invalid in [
            format!("moddingflow://%64ownload?v=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download%3Fv=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?%76=1&artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1&artifact%5fid={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1%26artifact_id={ARTIFACT_ID}"),
            format!("moddingflow://download?v=1?artifact_id={ARTIFACT_ID}"),
        ] {
            assert!(
                parse_fluxora_activation(&invalid).is_err(),
                "accepted encoded path or query confusion"
            );
        }
    }

    #[test]
    fn deduplicates_an_artifact_across_startup_and_second_instance_sources() {
        let mut inbox = FluxoraActivationInbox::default();
        let first = inbox
            .capture_at(
                &activation(ARTIFACT_ID),
                FluxoraActivationSource::Startup,
                100,
            )
            .expect("queue startup activation");
        let first_id = match first {
            FluxoraActivationCapture::Queued(item) => item.activation_id,
            FluxoraActivationCapture::Duplicate { .. } => panic!("first activation was duplicate"),
        };
        let second = inbox
            .capture_at(
                &activation(ARTIFACT_ID),
                FluxoraActivationSource::SecondInstance,
                200,
            )
            .expect("dedupe second-instance activation");

        assert_eq!(
            second,
            FluxoraActivationCapture::Duplicate {
                activation_id: first_id.clone()
            }
        );
        let items = inbox.snapshot();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].activation_id, first_id);
        assert_eq!(items[0].timestamp, 100);
    }

    #[test]
    fn caps_the_inbox_at_32_without_evicting_or_duplicating() {
        let mut inbox = FluxoraActivationInbox::default();
        for index in 0..MAX_INBOX_ITEMS {
            inbox
                .capture_at(
                    &activation(&artifact_id(index)),
                    FluxoraActivationSource::Startup,
                    index as u64,
                )
                .expect("fill inbox");
        }
        let first_snapshot = inbox.snapshot();
        assert_eq!(first_snapshot.len(), MAX_INBOX_ITEMS);

        assert!(matches!(
            inbox.capture_at(
                &activation(&artifact_id(MAX_INBOX_ITEMS)),
                FluxoraActivationSource::SecondInstance,
                33,
            ),
            Err(FluxoraActivationInboxError::Full)
        ));
        assert_eq!(inbox.snapshot(), first_snapshot);

        assert!(matches!(
            inbox.capture_at(
                &activation(&artifact_id(0)),
                FluxoraActivationSource::SecondInstance,
                34,
            ),
            Ok(FluxoraActivationCapture::Duplicate { .. })
        ));
        assert_eq!(inbox.snapshot(), first_snapshot);
    }

    #[test]
    fn accept_requires_operation_id_and_only_removes_the_selected_item() {
        let mut inbox = FluxoraActivationInbox::default();
        let queued = inbox
            .capture_at(
                &activation(ARTIFACT_ID),
                FluxoraActivationSource::Startup,
                500,
            )
            .expect("queue activation");
        let item = match queued {
            FluxoraActivationCapture::Queued(item) => item,
            FluxoraActivationCapture::Duplicate { .. } => panic!("unexpected duplicate"),
        };

        assert_eq!(
            inbox.accept(&item.activation_id, ""),
            Err(FluxoraActivationInboxError::OperationIdRequired)
        );
        assert_eq!(
            inbox.accept(&item.activation_id, " operation-1"),
            Err(FluxoraActivationInboxError::InvalidOperationId)
        );
        assert_eq!(inbox.snapshot(), vec![item.clone()]);

        assert_eq!(
            inbox
                .accept(&item.activation_id, "operation-accept-1")
                .expect("accept activation"),
            item
        );
        assert!(inbox.snapshot().is_empty());
    }

    #[test]
    fn dismiss_requires_operation_id_and_does_not_touch_other_items() {
        let mut inbox = FluxoraActivationInbox::default();
        let first = match inbox
            .capture_at(
                &activation(&artifact_id(1)),
                FluxoraActivationSource::Startup,
                600,
            )
            .expect("queue first")
        {
            FluxoraActivationCapture::Queued(item) => item,
            FluxoraActivationCapture::Duplicate { .. } => panic!("unexpected duplicate"),
        };
        let second = match inbox
            .capture_at(
                &activation(&artifact_id(2)),
                FluxoraActivationSource::SecondInstance,
                700,
            )
            .expect("queue second")
        {
            FluxoraActivationCapture::Queued(item) => item,
            FluxoraActivationCapture::Duplicate { .. } => panic!("unexpected duplicate"),
        };

        assert_eq!(
            inbox.dismiss(&first.activation_id, "\n"),
            Err(FluxoraActivationInboxError::OperationIdRequired)
        );
        assert_eq!(
            inbox
                .dismiss(&first.activation_id, "operation-dismiss-1")
                .expect("dismiss activation"),
            first
        );
        assert_eq!(inbox.snapshot(), vec![second]);
    }

    #[test]
    fn activation_ids_are_opaque_and_records_store_only_normalized_metadata() {
        let mut inbox = FluxoraActivationInbox::default();
        let item = match inbox
            .capture_at(
                &activation(ARTIFACT_ID),
                FluxoraActivationSource::Startup,
                1_234,
            )
            .expect("queue activation")
        {
            FluxoraActivationCapture::Queued(item) => item,
            FluxoraActivationCapture::Duplicate { .. } => panic!("unexpected duplicate"),
        };

        assert!(item.activation_id.starts_with("act_"));
        assert_eq!(item.activation_id.len(), 36);
        assert!(!item.activation_id.contains(ARTIFACT_ID));
        assert_eq!(item.version, 1);
        assert_eq!(item.action, FluxoraActivationAction::Download);
        assert_eq!(item.artifact_id, ARTIFACT_ID);
        assert_eq!(item.timestamp, 1_234);
    }
}
