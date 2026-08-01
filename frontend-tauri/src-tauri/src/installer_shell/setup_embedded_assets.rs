#[path = "setup_resource_ids.rs"]
mod setup_resource_ids;

#[derive(Clone, Copy)]
pub struct EmbeddedSetupAssets {
    pub payload: &'static [u8],
    pub webview2_bootstrapper: &'static [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmbeddedAssetError {
    #[cfg(all(not(windows), feature = "setup-production-assets"))]
    UnsupportedPlatform,
    MissingPayload,
    MissingWebView2Bootstrapper,
}

#[cfg(all(windows, feature = "setup-production-assets"))]
fn make_int_resource(value: u16) -> windows::core::PCWSTR {
    windows::core::PCWSTR(value as usize as *const u16)
}

#[cfg(all(windows, feature = "setup-production-assets"))]
fn load_resource(resource_id: u16) -> Option<&'static [u8]> {
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{
        FindResourceW, GetModuleHandleW, LoadResource, LockResource, SizeofResource,
    };

    // SAFETY: The module handle and RCDATA storage remain valid for the process lifetime.
    // The resource compiler rejects inputs larger than the u32 size returned by SizeofResource.
    unsafe {
        let module = GetModuleHandleW(PCWSTR::null()).ok()?;
        let resource = FindResourceW(
            Some(module),
            make_int_resource(resource_id),
            make_int_resource(setup_resource_ids::WINDOWS_RCDATA_RESOURCE_TYPE),
        );
        if resource.is_invalid() {
            return None;
        }
        let size = SizeofResource(Some(module), resource);
        if size == 0 {
            return None;
        }
        let loaded = LoadResource(Some(module), resource).ok()?;
        let bytes = LockResource(loaded).cast::<u8>();
        if bytes.is_null() {
            return None;
        }
        Some(std::slice::from_raw_parts(bytes, size as usize))
    }
}

#[cfg(all(windows, feature = "setup-production-assets"))]
pub fn load() -> Result<EmbeddedSetupAssets, EmbeddedAssetError> {
    let payload = load_resource(setup_resource_ids::SETUP_PAYLOAD_RESOURCE_ID)
        .ok_or(EmbeddedAssetError::MissingPayload)?;
    let webview2_bootstrapper =
        load_resource(setup_resource_ids::WEBVIEW2_BOOTSTRAPPER_RESOURCE_ID)
            .ok_or(EmbeddedAssetError::MissingWebView2Bootstrapper)?;
    Ok(EmbeddedSetupAssets {
        payload,
        webview2_bootstrapper,
    })
}

#[cfg(all(not(windows), feature = "setup-production-assets"))]
pub fn load() -> Result<EmbeddedSetupAssets, EmbeddedAssetError> {
    Err(EmbeddedAssetError::UnsupportedPlatform)
}

#[cfg(not(feature = "setup-production-assets"))]
pub fn load() -> Result<EmbeddedSetupAssets, EmbeddedAssetError> {
    Ok(EmbeddedSetupAssets {
        payload: &[],
        webview2_bootstrapper: &[],
    })
}

#[cfg(all(test, not(feature = "setup-production-assets")))]
mod tests {
    use super::*;

    #[test]
    fn development_build_has_no_implicit_external_asset_fallback() {
        let assets = load().unwrap();
        assert!(assets.payload.is_empty());
        assert!(assets.webview2_bootstrapper.is_empty());
    }
}
