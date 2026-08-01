pub const SETUP_PAYLOAD_RESOURCE_ID: u16 = 31_001;
pub const WEBVIEW2_BOOTSTRAPPER_RESOURCE_ID: u16 = 31_002;
pub const WINDOWS_RCDATA_RESOURCE_TYPE: u16 = 10;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_resource_ids_are_stable_nonzero_and_distinct() {
        assert_ne!(SETUP_PAYLOAD_RESOURCE_ID, 0);
        assert_ne!(WEBVIEW2_BOOTSTRAPPER_RESOURCE_ID, 0);
        assert_ne!(SETUP_PAYLOAD_RESOURCE_ID, WEBVIEW2_BOOTSTRAPPER_RESOURCE_ID);
        assert_eq!(WINDOWS_RCDATA_RESOURCE_TYPE, 10);
    }
}
