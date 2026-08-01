use base64::{engine::general_purpose::STANDARD, Engine as _};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey;
use reqwest::Url;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt;

pub(crate) const MAX_MANIFEST_BYTES: usize = 512 * 1024;
pub(crate) const MAX_UPDATE_PACKAGE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
pub(crate) const STABLE_UPDATE_PUBLIC_KEY_DER: &[u8] =
    include_bytes!("../resources/update/stable-public-key.der");
const MAX_SIGNATURE_TEXT_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateFile {
    pub(crate) path: String,
    pub(crate) size: u64,
    pub(crate) sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UpdateAssetKind {
    Full,
    Delta,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawUpdateAsset {
    kind: UpdateAssetKind,
    from_version: Option<String>,
    url: String,
    size: u64,
    sha256: String,
    base_file_manifest_sha256: Option<String>,
    target_file_manifest_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpdateAsset {
    pub(crate) kind: UpdateAssetKind,
    pub(crate) from_version: Option<Version>,
    pub(crate) url: String,
    pub(crate) size: u64,
    pub(crate) sha256: String,
    pub(crate) base_file_manifest_sha256: Option<String>,
    pub(crate) target_file_manifest_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawUpdateManifest {
    schema_version: u32,
    channel: String,
    version: String,
    target: String,
    application_executable: String,
    file_manifest_sha256: String,
    files: Vec<UpdateFile>,
    assets: Vec<RawUpdateAsset>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpdateManifest {
    pub(crate) schema_version: u32,
    pub(crate) channel: String,
    pub(crate) version: Version,
    pub(crate) target: String,
    pub(crate) application_executable: String,
    pub(crate) file_manifest_sha256: String,
    pub(crate) files: Vec<UpdateFile>,
    pub(crate) assets: Vec<UpdateAsset>,
}

impl UpdateManifest {
    #[cfg(test)]
    pub(crate) fn select_asset(&self, current_version: &Version) -> Option<&UpdateAsset> {
        if self.version <= *current_version {
            return None;
        }
        self.assets
            .iter()
            .find(|asset| {
                asset.kind == UpdateAssetKind::Delta
                    && asset.from_version.as_ref() == Some(current_version)
            })
            .or_else(|| {
                self.assets
                    .iter()
                    .find(|asset| asset.kind == UpdateAssetKind::Full)
            })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UpdateManifestError {
    ManifestTooLarge,
    SignatureTooLarge,
    SignatureEncoding,
    InvalidSignature,
    InvalidJson,
    InvalidAssetUrl,
    InvalidAssetSize,
    InvalidAssetShape,
    InvalidAssetSet,
    InvalidDigest,
    InvalidExecutable,
    FileManifestDigestMismatch,
    InvalidFilePath,
    InvalidFileOrder,
    DuplicateFilePath,
    InvalidVersion,
    UnsupportedChannel,
    UnsupportedSchema,
    UnsupportedTarget,
    UnstableVersion,
}

impl fmt::Display for UpdateManifestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ManifestTooLarge => "update manifest exceeds the size limit",
            Self::SignatureTooLarge => "update signature exceeds the size limit",
            Self::SignatureEncoding => "update signature encoding is invalid",
            Self::InvalidSignature => "update manifest signature is invalid",
            Self::InvalidJson => "update manifest JSON is invalid",
            Self::InvalidAssetUrl => "update asset URL is invalid",
            Self::InvalidAssetSize => "update asset size is invalid",
            Self::InvalidAssetShape => "update asset metadata is invalid",
            Self::InvalidAssetSet => "update asset set is invalid",
            Self::InvalidDigest => "update manifest contains an invalid SHA-256 digest",
            Self::InvalidExecutable => "update application executable is invalid",
            Self::FileManifestDigestMismatch => "update file manifest digest does not match",
            Self::InvalidFilePath => "update file path is invalid",
            Self::InvalidFileOrder => "update file manifest order is invalid",
            Self::DuplicateFilePath => "update file manifest contains duplicate paths",
            Self::InvalidVersion => "update manifest version is invalid",
            Self::UnsupportedChannel => "update manifest channel is unsupported",
            Self::UnsupportedSchema => "update manifest schema is unsupported",
            Self::UnsupportedTarget => "update manifest target is unsupported",
            Self::UnstableVersion => "stable update version contains a prerelease identifier",
        })
    }
}

pub(crate) fn verify_and_parse_stable_manifest(
    manifest_bytes: &[u8],
    signature_text: &[u8],
) -> Result<UpdateManifest, UpdateManifestError> {
    let verifying_key = VerifyingKey::from_public_key_der(STABLE_UPDATE_PUBLIC_KEY_DER)
        .map_err(|_| UpdateManifestError::SignatureEncoding)?;
    verify_and_parse_manifest_with_key(manifest_bytes, signature_text, &verifying_key)
}

#[cfg(test)]
pub(crate) fn verify_and_parse_manifest(
    manifest_bytes: &[u8],
    signature_text: &[u8],
    public_key_pem: &str,
) -> Result<UpdateManifest, UpdateManifestError> {
    let verifying_key = VerifyingKey::from_public_key_pem(public_key_pem)
        .map_err(|_| UpdateManifestError::SignatureEncoding)?;
    verify_and_parse_manifest_with_key(manifest_bytes, signature_text, &verifying_key)
}

fn verify_and_parse_manifest_with_key(
    manifest_bytes: &[u8],
    signature_text: &[u8],
    verifying_key: &VerifyingKey,
) -> Result<UpdateManifest, UpdateManifestError> {
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(UpdateManifestError::ManifestTooLarge);
    }
    if signature_text.len() > MAX_SIGNATURE_TEXT_BYTES {
        return Err(UpdateManifestError::SignatureTooLarge);
    }

    let signature_text = std::str::from_utf8(signature_text)
        .map_err(|_| UpdateManifestError::SignatureEncoding)?
        .trim();
    let signature_bytes = STANDARD
        .decode(signature_text)
        .map_err(|_| UpdateManifestError::SignatureEncoding)?;
    if signature_bytes.len() != 64 {
        return Err(UpdateManifestError::SignatureEncoding);
    }
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| UpdateManifestError::SignatureEncoding)?;
    verifying_key
        .verify(manifest_bytes, &signature)
        .map_err(|_| UpdateManifestError::InvalidSignature)?;

    let raw: RawUpdateManifest =
        serde_json::from_slice(manifest_bytes).map_err(|_| UpdateManifestError::InvalidJson)?;
    if raw.schema_version != 1 {
        return Err(UpdateManifestError::UnsupportedSchema);
    }
    if raw.channel != "stable" {
        return Err(UpdateManifestError::UnsupportedChannel);
    }
    if raw.target != "win-x64" {
        return Err(UpdateManifestError::UnsupportedTarget);
    }
    let version = Version::parse(&raw.version).map_err(|_| UpdateManifestError::InvalidVersion)?;
    if !version.pre.is_empty() {
        return Err(UpdateManifestError::UnstableVersion);
    }
    if !is_sha256_hex(&raw.file_manifest_sha256) {
        return Err(UpdateManifestError::InvalidDigest);
    }
    validate_file_manifest_digest(&raw.files, &raw.file_manifest_sha256)?;
    if !is_safe_relative_file_path(&raw.application_executable)
        || !raw
            .application_executable
            .to_ascii_lowercase()
            .ends_with(".exe")
        || !raw
            .files
            .iter()
            .any(|file| file.path == raw.application_executable)
    {
        return Err(UpdateManifestError::InvalidExecutable);
    }
    let target_file_manifest_sha256 = raw.file_manifest_sha256.clone();
    let assets = raw
        .assets
        .into_iter()
        .map(|asset| {
            validate_asset_url(&asset.url)?;
            if asset.size == 0 || asset.size > MAX_UPDATE_PACKAGE_BYTES {
                return Err(UpdateManifestError::InvalidAssetSize);
            }
            if !is_sha256_hex(&asset.sha256)
                || !is_sha256_hex(&asset.target_file_manifest_sha256)
                || asset
                    .base_file_manifest_sha256
                    .as_deref()
                    .is_some_and(|digest| !is_sha256_hex(digest))
            {
                return Err(UpdateManifestError::InvalidDigest);
            }
            if matches!(asset.kind, UpdateAssetKind::Full)
                && (asset.from_version.is_some() || asset.base_file_manifest_sha256.is_some())
            {
                return Err(UpdateManifestError::InvalidAssetShape);
            }
            if matches!(asset.kind, UpdateAssetKind::Delta)
                && (asset.from_version.is_none() || asset.base_file_manifest_sha256.is_none())
            {
                return Err(UpdateManifestError::InvalidAssetShape);
            }
            if asset.target_file_manifest_sha256 != target_file_manifest_sha256 {
                return Err(UpdateManifestError::InvalidAssetShape);
            }
            let from_version = asset
                .from_version
                .map(|value| Version::parse(&value))
                .transpose()
                .map_err(|_| UpdateManifestError::InvalidVersion)?;
            Ok(UpdateAsset {
                kind: asset.kind,
                from_version,
                url: asset.url,
                size: asset.size,
                sha256: asset.sha256,
                base_file_manifest_sha256: asset.base_file_manifest_sha256,
                target_file_manifest_sha256: asset.target_file_manifest_sha256,
            })
        })
        .collect::<Result<Vec<_>, UpdateManifestError>>()?;
    if assets.len() > 128
        || assets
            .iter()
            .filter(|asset| asset.kind == UpdateAssetKind::Full)
            .count()
            != 1
    {
        return Err(UpdateManifestError::InvalidAssetSet);
    }
    let mut delta_versions = HashSet::new();
    for asset in &assets {
        if asset.kind != UpdateAssetKind::Delta {
            continue;
        }
        let from_version = asset
            .from_version
            .as_ref()
            .ok_or(UpdateManifestError::InvalidAssetShape)?;
        if !from_version.pre.is_empty()
            || from_version >= &version
            || !delta_versions.insert(from_version.clone())
        {
            return Err(UpdateManifestError::InvalidAssetSet);
        }
    }

    Ok(UpdateManifest {
        schema_version: raw.schema_version,
        channel: raw.channel,
        version,
        target: raw.target,
        application_executable: raw.application_executable,
        file_manifest_sha256: raw.file_manifest_sha256,
        files: raw.files,
        assets,
    })
}

fn validate_file_manifest_digest(
    files: &[UpdateFile],
    expected: &str,
) -> Result<(), UpdateManifestError> {
    if files
        .windows(2)
        .any(|pair| pair[0].path.as_bytes() >= pair[1].path.as_bytes())
    {
        return Err(UpdateManifestError::InvalidFileOrder);
    }
    let mut windows_paths = HashSet::with_capacity(files.len());
    let mut hasher = Sha256::new();
    for file in files {
        if !is_safe_relative_file_path(&file.path) {
            return Err(UpdateManifestError::InvalidFilePath);
        }
        if !is_sha256_hex(&file.sha256) {
            return Err(UpdateManifestError::InvalidDigest);
        }
        if !windows_paths.insert(file.path.to_lowercase()) {
            return Err(UpdateManifestError::DuplicateFilePath);
        }
        hasher.update(file.path.as_bytes());
        hasher.update([0]);
        hasher.update(file.size.to_string().as_bytes());
        hasher.update([0]);
        hasher.update(file.sha256.as_bytes());
        hasher.update(b"\n");
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual == expected {
        Ok(())
    } else {
        Err(UpdateManifestError::FileManifestDigestMismatch)
    }
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_safe_relative_file_path(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 1024
        || value.starts_with('/')
        || value.contains(['\\', ':'])
        || value.chars().any(char::is_control)
    {
        return false;
    }

    value.split('/').all(|component| {
        !component.is_empty()
            && component != "."
            && component != ".."
            && !component.ends_with([' ', '.'])
            && !is_windows_reserved_component(component)
    })
}

fn is_windows_reserved_component(component: &str) -> bool {
    let stem = component
        .split_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(component)
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || stem.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
}

fn validate_asset_url(value: &str) -> Result<(), UpdateManifestError> {
    let url = Url::parse(value).map_err(|_| UpdateManifestError::InvalidAssetUrl)?;
    let valid = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url
            .path()
            .starts_with("/Moddingflow/Fluxora/releases/download/");
    if valid {
        Ok(())
    } else {
        Err(UpdateManifestError::InvalidAssetUrl)
    }
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use p256::ecdsa::{signature::Signer, Signature, SigningKey};
    use p256::pkcs8::{EncodePublicKey, LineEnding};
    use semver::Version;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    fn fixture_key() -> SigningKey {
        SigningKey::from_slice(&[7_u8; 32]).expect("fixture key must be valid")
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn valid_manifest_bytes() -> Vec<u8> {
        let file_sha = sha256_hex(b"Fluxora executable");
        let canonical = format!("Fluxora.exe\0{}\0{}\n", 18, file_sha);
        let file_manifest_sha = sha256_hex(canonical.as_bytes());
        serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "channel": "stable",
            "version": "1.2.0",
            "target": "win-x64",
            "applicationExecutable": "Fluxora.exe",
            "fileManifestSha256": file_manifest_sha,
            "files": [{
                "path": "Fluxora.exe",
                "size": 18,
                "sha256": file_sha
            }],
            "assets": [{
                "kind": "full",
                "fromVersion": null,
                "url": "https://github.com/Moddingflow/Fluxora/releases/download/v1.2.0/Fluxora-1.2.0-win-x64.zip",
                "size": 4096,
                "sha256": sha256_hex(b"full package"),
                "baseFileManifestSha256": null,
                "targetFileManifestSha256": file_manifest_sha
            }]
        }))
        .expect("fixture manifest must serialize")
    }

    fn sign(bytes: &[u8]) -> String {
        let signature: Signature = fixture_key().sign(bytes);
        STANDARD.encode(signature.to_bytes())
    }

    fn mutate_manifest(mutator: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut value: serde_json::Value =
            serde_json::from_slice(&valid_manifest_bytes()).expect("fixture JSON must parse");
        mutator(&mut value);
        serde_json::to_vec(&value).expect("mutated fixture manifest must serialize")
    }

    fn refresh_file_manifest_digest(value: &mut serde_json::Value) {
        let files = value["files"]
            .as_array()
            .expect("fixture files must be an array");
        let mut canonical = Vec::new();
        for file in files {
            canonical.extend_from_slice(
                file["path"]
                    .as_str()
                    .expect("fixture path must be a string")
                    .as_bytes(),
            );
            canonical.push(0);
            canonical.extend_from_slice(
                file["size"]
                    .as_u64()
                    .expect("fixture size must be an integer")
                    .to_string()
                    .as_bytes(),
            );
            canonical.push(0);
            canonical.extend_from_slice(
                file["sha256"]
                    .as_str()
                    .expect("fixture hash must be a string")
                    .as_bytes(),
            );
            canonical.push(b'\n');
        }
        let digest = sha256_hex(&canonical);
        value["fileManifestSha256"] = json!(digest);
        for asset in value["assets"]
            .as_array_mut()
            .expect("fixture assets must be an array")
        {
            asset["targetFileManifestSha256"] = json!(digest);
        }
    }

    #[test]
    fn accepts_a_valid_signed_stable_windows_manifest() {
        let bytes = valid_manifest_bytes();
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let manifest =
            super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
                .expect("signed manifest must verify");

        assert_eq!(manifest.version.to_string(), "1.2.0");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.assets.len(), 1);
    }

    #[test]
    fn rejects_a_non_stable_release_channel() {
        let bytes = mutate_manifest(|value| value["channel"] = json!("beta"));
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("non-stable channels must be rejected");

        assert_eq!(error, super::UpdateManifestError::UnsupportedChannel);
    }

    #[test]
    fn rejects_a_manifest_for_another_target() {
        let bytes = mutate_manifest(|value| value["target"] = json!("linux-x64"));
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("another target must be rejected");

        assert_eq!(error, super::UpdateManifestError::UnsupportedTarget);
    }

    #[test]
    fn rejects_an_unknown_manifest_schema_version() {
        let bytes = mutate_manifest(|value| value["schemaVersion"] = json!(2));
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("unknown schema versions must be rejected");

        assert_eq!(error, super::UpdateManifestError::UnsupportedSchema);
    }

    #[test]
    fn rejects_a_prerelease_on_the_stable_channel() {
        let bytes = mutate_manifest(|value| value["version"] = json!("1.2.0-rc.1"));
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("stable channel must reject prerelease versions");

        assert_eq!(error, super::UpdateManifestError::UnstableVersion);
    }

    #[test]
    fn rejects_an_asset_outside_the_fluxora_github_release_path() {
        let bytes = mutate_manifest(|value| {
            value["assets"][0]["url"] = json!("https://example.com/Fluxora.zip");
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("non-GitHub assets must be rejected");

        assert_eq!(error, super::UpdateManifestError::InvalidAssetUrl);
    }

    #[test]
    fn rejects_an_asset_larger_than_the_update_budget() {
        let bytes = mutate_manifest(|value| {
            value["assets"][0]["size"] = json!(super::MAX_UPDATE_PACKAGE_BYTES + 1);
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("oversized assets must be rejected");

        assert_eq!(error, super::UpdateManifestError::InvalidAssetSize);
    }

    #[test]
    fn rejects_a_file_list_that_does_not_match_its_signed_digest() {
        let bytes = mutate_manifest(|value| value["files"][0]["size"] = json!(19));
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("file manifest digest mismatch must be rejected");

        assert_eq!(
            error,
            super::UpdateManifestError::FileManifestDigestMismatch
        );
    }

    #[test]
    fn rejects_parent_traversal_in_a_target_file_path() {
        let bytes = mutate_manifest(|value| {
            value["files"][0]["path"] = json!("../Fluxora.exe");
            refresh_file_manifest_digest(value);
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("unsafe file paths must be rejected");

        assert_eq!(error, super::UpdateManifestError::InvalidFilePath);
    }

    #[test]
    fn rejects_windows_reserved_device_file_names() {
        for path in ["CON", "assets/NUL.dll", "tools/com1.exe", "Lpt9.txt"] {
            let bytes = mutate_manifest(|value| {
                value["files"][0]["path"] = json!(path);
                value["applicationExecutable"] = json!(path);
                refresh_file_manifest_digest(value);
            });
            let public_key = fixture_key()
                .verifying_key()
                .to_public_key_pem(LineEnding::LF)
                .expect("fixture public key must encode");
            let error =
                super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
                    .expect_err("reserved Windows device names must be rejected");
            assert_eq!(error, super::UpdateManifestError::InvalidFilePath, "{path}");
        }
    }

    #[test]
    fn rejects_a_file_manifest_that_is_not_ordinal_utf8_sorted() {
        let bytes = mutate_manifest(|value| {
            value["files"] = json!([
                {
                    "path": "z-last.dll",
                    "size": 1,
                    "sha256": sha256_hex(b"z")
                },
                {
                    "path": "a-first.dll",
                    "size": 1,
                    "sha256": sha256_hex(b"a")
                }
            ]);
            refresh_file_manifest_digest(value);
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("unsorted file manifests must be rejected");

        assert_eq!(error, super::UpdateManifestError::InvalidFileOrder);
    }

    #[test]
    fn rejects_case_colliding_windows_file_paths() {
        let bytes = mutate_manifest(|value| {
            value["files"] = json!([
                {
                    "path": "Fluxora.exe",
                    "size": 1,
                    "sha256": sha256_hex(b"a")
                },
                {
                    "path": "fluxora.exe",
                    "size": 1,
                    "sha256": sha256_hex(b"b")
                }
            ]);
            refresh_file_manifest_digest(value);
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("Windows case collisions must be rejected");

        assert_eq!(error, super::UpdateManifestError::DuplicateFilePath);
    }

    #[test]
    fn rejects_a_full_asset_with_a_base_version() {
        let bytes = mutate_manifest(|value| {
            value["assets"][0]["fromVersion"] = json!("1.1.0");
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("full assets cannot declare a base version");

        assert_eq!(error, super::UpdateManifestError::InvalidAssetShape);
    }

    #[test]
    fn selects_only_the_delta_for_the_exact_installed_version() {
        let bytes = mutate_manifest(|value| {
            let target_digest = value["fileManifestSha256"].clone();
            value["assets"]
                .as_array_mut()
                .expect("fixture assets must be an array")
                .push(json!({
                    "kind": "delta",
                    "fromVersion": "1.1.0",
                    "url": "https://github.com/Moddingflow/Fluxora/releases/download/v1.2.0/Fluxora-1.1.0-to-1.2.0.delta",
                    "size": 2048,
                    "sha256": sha256_hex(b"delta package"),
                    "baseFileManifestSha256": sha256_hex(b"base manifest"),
                    "targetFileManifestSha256": target_digest
                }));
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");
        let manifest =
            super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
                .expect("signed manifest must verify");

        let selected = manifest
            .select_asset(&"1.1.0".parse().expect("fixture version must parse"))
            .expect("exact delta must be selected");

        assert_eq!(selected.kind, super::UpdateAssetKind::Delta);
        assert_eq!(
            selected.from_version.as_ref().map(ToString::to_string),
            Some("1.1.0".to_string())
        );
    }

    #[test]
    fn rejects_a_delta_without_a_complete_base_identity() {
        let bytes = mutate_manifest(|value| {
            value["assets"][0]["kind"] = json!("delta");
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("deltas need both fromVersion and base digest");

        assert_eq!(error, super::UpdateManifestError::InvalidAssetShape);
    }

    #[test]
    fn requires_exactly_one_full_fallback_asset() {
        let bytes = mutate_manifest(|value| {
            value["assets"][0]["kind"] = json!("delta");
            value["assets"][0]["fromVersion"] = json!("1.1.0");
            value["assets"][0]["baseFileManifestSha256"] = json!(sha256_hex(b"base"));
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("manifest must contain a full fallback");

        assert_eq!(error, super::UpdateManifestError::InvalidAssetSet);
    }

    #[test]
    fn embeds_the_reviewed_stable_channel_public_key() {
        assert_eq!(
            sha256_hex(super::STABLE_UPDATE_PUBLIC_KEY_DER),
            "f2d6f63919c925d8ccad42a178fba83a5cd49f72e3e49ba94e1c0ba45d348b64"
        );
    }

    #[test]
    fn rejects_any_tampering_after_the_manifest_is_signed() {
        let bytes = valid_manifest_bytes();
        let signature = sign(&bytes);
        let mut tampered = bytes;
        let index = tampered
            .iter()
            .position(|byte| *byte == b'2')
            .expect("fixture contains a version digit");
        tampered[index] = b'3';
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&tampered, signature.as_bytes(), &public_key)
            .expect_err("tampering must invalidate the detached signature");

        assert_eq!(error, super::UpdateManifestError::InvalidSignature);
    }

    #[test]
    fn rejects_unknown_signed_manifest_fields() {
        let bytes =
            mutate_manifest(|value| value["releaseNotesUrl"] = json!("https://example.com"));
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("unknown fields must fail the strict schema");

        assert_eq!(error, super::UpdateManifestError::InvalidJson);
    }

    #[test]
    fn requires_canonical_lowercase_sha256_digests() {
        let bytes = mutate_manifest(|value| {
            value["files"][0]["sha256"] = json!("A".repeat(64));
            refresh_file_manifest_digest(value);
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("noncanonical hashes must be rejected");

        assert_eq!(error, super::UpdateManifestError::InvalidDigest);
    }

    #[test]
    fn requires_the_application_executable_in_the_signed_file_inventory() {
        let bytes = mutate_manifest(|value| {
            value["applicationExecutable"] = json!("Missing.exe");
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");

        let error = super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
            .expect_err("the launch executable must be installed by the signed manifest");

        assert_eq!(error, super::UpdateManifestError::InvalidExecutable);
    }

    #[test]
    fn falls_back_to_full_when_no_delta_matches_the_installed_version() {
        let bytes = mutate_manifest(|value| {
            let target_digest = value["fileManifestSha256"].clone();
            value["assets"]
                .as_array_mut()
                .expect("fixture assets must be an array")
                .push(json!({
                    "kind": "delta",
                    "fromVersion": "1.1.0",
                    "url": "https://github.com/Moddingflow/Fluxora/releases/download/v1.2.0/Fluxora.delta",
                    "size": 2048,
                    "sha256": sha256_hex(b"delta package"),
                    "baseFileManifestSha256": sha256_hex(b"base manifest"),
                    "targetFileManifestSha256": target_digest
                }));
        });
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");
        let manifest =
            super::verify_and_parse_manifest(&bytes, sign(&bytes).as_bytes(), &public_key)
                .expect("signed manifest must verify");

        assert_eq!(
            manifest
                .select_asset(&Version::new(1, 0, 0))
                .expect("full fallback must be present")
                .kind,
            super::UpdateAssetKind::Full
        );
    }

    #[test]
    fn enforces_manifest_and_signature_size_limits_before_parsing() {
        let public_key = fixture_key()
            .verifying_key()
            .to_public_key_pem(LineEnding::LF)
            .expect("fixture public key must encode");
        assert_eq!(
            super::verify_and_parse_manifest(
                &vec![b' '; super::MAX_MANIFEST_BYTES + 1],
                b"",
                &public_key
            )
            .unwrap_err(),
            super::UpdateManifestError::ManifestTooLarge
        );
        assert_eq!(
            super::verify_and_parse_manifest(
                b"{}",
                &vec![b'A'; super::MAX_SIGNATURE_TEXT_BYTES + 1],
                &public_key
            )
            .unwrap_err(),
            super::UpdateManifestError::SignatureTooLarge
        );
    }
}
