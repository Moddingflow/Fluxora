use crate::oauth_loopback::{
    BoundOAuthLoopback, OAuthLoopbackCallback, OAuthLoopbackCancelHandle, OAuthLoopbackError,
};
use reqwest::Url;
use std::future::Future;
use std::pin::Pin;
use tokio::time::Duration;

const AUTHORIZATION_ENDPOINT: &str = "https://moddingflow.com/oauth/authorize";
const AUTHORIZATION_PREFIX: &str = "https://moddingflow.com/oauth/authorize?";
const PUBLIC_CLIENT_ID: &str = "desktop_mod_manager";
const REQUIRED_SCOPES: &str = "openid profile:read mods:read files:download install_plans:resolve";
const DEFAULT_INTERACTIVE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_AUTHORIZATION_URL_BYTES: usize = 16 * 1024;
const MAX_OPAQUE_PARAMETER_BYTES: usize = 512;
const MAX_OPERATION_ID_BYTES: usize = 256;
const TRANSACTION_ID_BYTES: usize = 22;
const OAUTH_STATE_BYTES: usize = 43;

pub(crate) type CoreCallFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, TrustedModdingFlowOAuthCallError>> + Send + 'a>>;

pub(crate) struct TrustedModdingFlowOAuthBegin {
    pub(crate) transaction_id: String,
    pub(crate) authorization_url: String,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum TrustedModdingFlowOAuthCompletion {
    AuthorizationCode {
        code: String,
        state: String,
        issuer: String,
    },
    AuthorizationError {
        error: String,
        error_description: Option<String>,
        state: String,
        issuer: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct TrustedModdingFlowOAuthCallError;

pub(crate) trait TrustedModdingFlowOAuthCore: Send + Sync {
    fn begin<'a>(
        &'a self,
        redirect_uri: &'a str,
        operation_id: &'a str,
    ) -> CoreCallFuture<'a, TrustedModdingFlowOAuthBegin>;

    fn complete<'a>(
        &'a self,
        transaction_id: &'a str,
        completion: TrustedModdingFlowOAuthCompletion,
        operation_id: &'a str,
    ) -> CoreCallFuture<'a, ()>;

    fn cancel<'a>(
        &'a self,
        transaction_id: &'a str,
        operation_id: &'a str,
    ) -> CoreCallFuture<'a, ()>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AuthorizationBrowserOpenError;

pub(crate) trait ModdingFlowAuthorizationBrowser: Send + Sync {
    fn open_authorization_url(
        &self,
        authorization_url: &str,
    ) -> Result<(), AuthorizationBrowserOpenError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorizationUrlValidationError {
    TooLarge,
    InvalidEndpoint,
    CredentialsForbidden,
    FragmentForbidden,
    InvalidQuery,
    UnknownParameter,
    DuplicateParameter,
    MissingParameter,
    InvalidClient,
    InvalidRedirect,
    InvalidResponseType,
    InvalidScopes,
    InvalidPkceMethod,
    InvalidState,
    InvalidNonce,
    InvalidChallenge,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CoreCancelOutcome {
    Succeeded,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModdingFlowOAuthError {
    OperationIdRequired,
    InvalidOperationId,
    LoopbackBindFailed,
    CoreBeginFailed,
    InvalidCoreTransactionId,
    InvalidAuthorizationUrl {
        reason: AuthorizationUrlValidationError,
        cancellation: CoreCancelOutcome,
    },
    BrowserOpenFailed {
        cancellation: CoreCancelOutcome,
    },
    TimedOut {
        cancellation: CoreCancelOutcome,
    },
    Cancelled {
        cancellation: CoreCancelOutcome,
    },
    AuthorizationRejected,
    LoopbackFailed {
        cancellation: CoreCancelOutcome,
    },
    CoreCompleteFailed {
        cancellation: CoreCancelOutcome,
    },
}

pub(crate) struct PreparedModdingFlowOAuth {
    loopback: BoundOAuthLoopback,
    operation_id: String,
    maximum_wait: Duration,
}

impl PreparedModdingFlowOAuth {
    pub(crate) async fn bind(
        operation_id: &str,
    ) -> Result<(Self, OAuthLoopbackCancelHandle), ModdingFlowOAuthError> {
        Self::bind_with_timeout(operation_id, DEFAULT_INTERACTIVE_TIMEOUT).await
    }

    async fn bind_with_timeout(
        operation_id: &str,
        maximum_wait: Duration,
    ) -> Result<(Self, OAuthLoopbackCancelHandle), ModdingFlowOAuthError> {
        validate_operation_id(operation_id)?;
        let (loopback, cancel_handle) = BoundOAuthLoopback::bind()
            .await
            .map_err(|_| ModdingFlowOAuthError::LoopbackBindFailed)?;
        Ok((
            Self {
                loopback,
                operation_id: operation_id.to_string(),
                maximum_wait,
            },
            cancel_handle,
        ))
    }

    pub(crate) async fn run<C, B>(self, core: &C, browser: &B) -> Result<(), ModdingFlowOAuthError>
    where
        C: TrustedModdingFlowOAuthCore,
        B: ModdingFlowAuthorizationBrowser,
    {
        let redirect_uri = self.loopback.redirect_uri().to_string();
        let begin = core
            .begin(&redirect_uri, &self.operation_id)
            .await
            .map_err(|_| ModdingFlowOAuthError::CoreBeginFailed)?;
        if !is_valid_transaction_id(&begin.transaction_id) {
            return Err(ModdingFlowOAuthError::InvalidCoreTransactionId);
        }
        let mut transaction_active = true;

        if let Err(reason) = validate_authorization_url(&begin.authorization_url, &redirect_uri) {
            let cancellation = cancel_core_once(
                core,
                &begin.transaction_id,
                &self.operation_id,
                &mut transaction_active,
            )
            .await;
            return Err(ModdingFlowOAuthError::InvalidAuthorizationUrl {
                reason,
                cancellation,
            });
        }

        if browser
            .open_authorization_url(&begin.authorization_url)
            .is_err()
        {
            let cancellation = cancel_core_once(
                core,
                &begin.transaction_id,
                &self.operation_id,
                &mut transaction_active,
            )
            .await;
            return Err(ModdingFlowOAuthError::BrowserOpenFailed { cancellation });
        }

        match self.loopback.wait_for_callback(self.maximum_wait).await {
            Ok(callback) => {
                let (completion, authorization_rejected) = match callback {
                    OAuthLoopbackCallback::AuthorizationCode {
                        code,
                        state,
                        issuer,
                    } => (
                        TrustedModdingFlowOAuthCompletion::AuthorizationCode {
                            code,
                            state,
                            issuer,
                        },
                        false,
                    ),
                    OAuthLoopbackCallback::AuthorizationError {
                        error,
                        error_description,
                        state,
                        issuer,
                    } => (
                        TrustedModdingFlowOAuthCompletion::AuthorizationError {
                            error,
                            error_description,
                            state,
                            issuer,
                        },
                        true,
                    ),
                };
                if core
                    .complete(&begin.transaction_id, completion, &self.operation_id)
                    .await
                    .is_err()
                {
                    let cancellation = cancel_core_once(
                        core,
                        &begin.transaction_id,
                        &self.operation_id,
                        &mut transaction_active,
                    )
                    .await;
                    return Err(ModdingFlowOAuthError::CoreCompleteFailed { cancellation });
                }
                if authorization_rejected {
                    Err(ModdingFlowOAuthError::AuthorizationRejected)
                } else {
                    Ok(())
                }
            }
            Err(error) => {
                let cancellation = cancel_core_once(
                    core,
                    &begin.transaction_id,
                    &self.operation_id,
                    &mut transaction_active,
                )
                .await;
                match error {
                    OAuthLoopbackError::TimedOut => {
                        Err(ModdingFlowOAuthError::TimedOut { cancellation })
                    }
                    OAuthLoopbackError::Cancelled => {
                        Err(ModdingFlowOAuthError::Cancelled { cancellation })
                    }
                    _ => Err(ModdingFlowOAuthError::LoopbackFailed { cancellation }),
                }
            }
        }
    }
}

async fn cancel_core_once<C: TrustedModdingFlowOAuthCore>(
    core: &C,
    transaction_id: &str,
    operation_id: &str,
    transaction_active: &mut bool,
) -> CoreCancelOutcome {
    if !std::mem::replace(transaction_active, false) {
        return CoreCancelOutcome::Succeeded;
    }
    match core.cancel(transaction_id, operation_id).await {
        Ok(()) => CoreCancelOutcome::Succeeded,
        Err(_) => CoreCancelOutcome::Failed,
    }
}

fn validate_operation_id(value: &str) -> Result<(), ModdingFlowOAuthError> {
    if value.trim().is_empty() {
        return Err(ModdingFlowOAuthError::OperationIdRequired);
    }
    if value.len() > MAX_OPERATION_ID_BYTES
        || value.trim() != value
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(ModdingFlowOAuthError::InvalidOperationId);
    }
    Ok(())
}

fn is_valid_transaction_id(value: &str) -> bool {
    value.len() == TRANSACTION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

pub(crate) fn validate_authorization_url(
    value: &str,
    expected_redirect_uri: &str,
) -> Result<(), AuthorizationUrlValidationError> {
    if value.len() > MAX_AUTHORIZATION_URL_BYTES {
        return Err(AuthorizationUrlValidationError::TooLarge);
    }
    if value.is_empty() || value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(AuthorizationUrlValidationError::InvalidEndpoint);
    }
    let raw_query = value
        .strip_prefix(AUTHORIZATION_PREFIX)
        .ok_or(AuthorizationUrlValidationError::InvalidEndpoint)?;

    let url = Url::parse(value).map_err(|_| AuthorizationUrlValidationError::InvalidEndpoint)?;
    if url.scheme() != "https"
        || url.host_str() != Some("moddingflow.com")
        || url.port().is_some()
        || url.path() != "/oauth/authorize"
        || url.query().is_none()
    {
        return Err(AuthorizationUrlValidationError::InvalidEndpoint);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AuthorizationUrlValidationError::CredentialsForbidden);
    }
    if url.fragment().is_some() {
        return Err(AuthorizationUrlValidationError::FragmentForbidden);
    }
    validate_raw_parameter_names(raw_query)?;

    let mut client_id = None;
    let mut redirect_uri = None;
    let mut response_type = None;
    let mut scope = None;
    let mut code_challenge = None;
    let mut code_challenge_method = None;
    let mut state = None;
    let mut nonce = None;
    for (name, value) in url.query_pairs() {
        if value.is_empty() {
            return Err(AuthorizationUrlValidationError::InvalidQuery);
        }
        match name.as_ref() {
            "client_id" => set_parameter(&mut client_id, value.into_owned())?,
            "redirect_uri" => set_parameter(&mut redirect_uri, value.into_owned())?,
            "response_type" => set_parameter(&mut response_type, value.into_owned())?,
            "scope" => set_parameter(&mut scope, value.into_owned())?,
            "code_challenge" => set_parameter(&mut code_challenge, value.into_owned())?,
            "code_challenge_method" => {
                set_parameter(&mut code_challenge_method, value.into_owned())?
            }
            "state" => set_parameter(&mut state, value.into_owned())?,
            "nonce" => set_parameter(&mut nonce, value.into_owned())?,
            _ => return Err(AuthorizationUrlValidationError::UnknownParameter),
        }
    }

    let client_id = required(client_id)?;
    let redirect_uri = required(redirect_uri)?;
    let response_type = required(response_type)?;
    let scope = required(scope)?;
    let code_challenge = required(code_challenge)?;
    let code_challenge_method = required(code_challenge_method)?;
    let state = required(state)?;
    let nonce = required(nonce)?;

    if client_id != PUBLIC_CLIENT_ID {
        return Err(AuthorizationUrlValidationError::InvalidClient);
    }
    if redirect_uri != expected_redirect_uri {
        return Err(AuthorizationUrlValidationError::InvalidRedirect);
    }
    if response_type != "code" {
        return Err(AuthorizationUrlValidationError::InvalidResponseType);
    }
    if scope != REQUIRED_SCOPES {
        return Err(AuthorizationUrlValidationError::InvalidScopes);
    }
    if code_challenge_method != "S256" {
        return Err(AuthorizationUrlValidationError::InvalidPkceMethod);
    }
    if !is_oauth_state(&state) {
        return Err(AuthorizationUrlValidationError::InvalidState);
    }
    if !is_bounded_opaque_parameter(&nonce) {
        return Err(AuthorizationUrlValidationError::InvalidNonce);
    }
    if !is_s256_challenge(&code_challenge) {
        return Err(AuthorizationUrlValidationError::InvalidChallenge);
    }
    Ok(())
}

fn validate_raw_parameter_names(query: &str) -> Result<(), AuthorizationUrlValidationError> {
    if query.is_empty() {
        return Err(AuthorizationUrlValidationError::InvalidQuery);
    }
    let mut seen = Vec::with_capacity(8);
    for parameter in query.split('&') {
        let (name, value) = parameter
            .split_once('=')
            .ok_or(AuthorizationUrlValidationError::InvalidQuery)?;
        if name.is_empty() || value.is_empty() || name.contains(['%', '+']) {
            return Err(AuthorizationUrlValidationError::InvalidQuery);
        }
        if !matches!(
            name,
            "client_id"
                | "redirect_uri"
                | "response_type"
                | "scope"
                | "code_challenge"
                | "code_challenge_method"
                | "state"
                | "nonce"
        ) {
            return Err(AuthorizationUrlValidationError::UnknownParameter);
        }
        if seen.contains(&name) {
            return Err(AuthorizationUrlValidationError::DuplicateParameter);
        }
        seen.push(name);
    }
    Ok(())
}

fn set_parameter(
    slot: &mut Option<String>,
    value: String,
) -> Result<(), AuthorizationUrlValidationError> {
    if slot.is_some() {
        return Err(AuthorizationUrlValidationError::DuplicateParameter);
    }
    *slot = Some(value);
    Ok(())
}

fn required(value: Option<String>) -> Result<String, AuthorizationUrlValidationError> {
    value.ok_or(AuthorizationUrlValidationError::MissingParameter)
}

fn is_bounded_opaque_parameter(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_OPAQUE_PARAMETER_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
}

fn is_oauth_state(value: &str) -> bool {
    value.len() == OAUTH_STATE_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn is_s256_challenge(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::{TcpListener as StdTcpListener, TcpStream as StdTcpStream};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::time::timeout;

    const STATE: &str = "0123456789abcdef0123456789abcdef0123456789A";
    const NONCE: &str = "nonce-0123456789abcdef";
    const CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const CODE: &str = "authorization-code-secret";
    const TRANSACTION_ID: &str = "abcdefghijklmnopqrstuv";
    const OPERATION_ID: &str = "operation-moddingflow-connect-1";

    fn run_async<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn authorization_url_from_pairs(redirect_uri: &str, pairs: &[(&str, &str)]) -> String {
        let mut url = Url::parse(AUTHORIZATION_ENDPOINT).expect("authorization endpoint");
        {
            let mut query = url.query_pairs_mut();
            for (name, value) in pairs {
                query.append_pair(name, value);
            }
        }
        let value = url.to_string();
        assert!(value.contains(redirect_uri) || value.contains("redirect_uri="));
        value
    }

    fn valid_authorization_url(redirect_uri: &str) -> String {
        authorization_url_from_pairs(
            redirect_uri,
            &[
                ("client_id", PUBLIC_CLIENT_ID),
                ("redirect_uri", redirect_uri),
                ("response_type", "code"),
                ("scope", REQUIRED_SCOPES),
                ("code_challenge", CHALLENGE),
                ("code_challenge_method", "S256"),
                ("state", STATE),
                ("nonce", NONCE),
            ],
        )
    }

    #[derive(Clone, Copy)]
    enum BeginMode {
        Valid,
        InvalidAuthorizationUrl,
        InvalidTransactionId,
        Fail,
    }

    struct MockCore {
        begin_mode: BeginMode,
        complete_fails: bool,
        cancel_fails: bool,
        calls: Arc<Mutex<Vec<&'static str>>>,
        begin_calls: AtomicUsize,
        complete_calls: AtomicUsize,
        cancel_calls: AtomicUsize,
        bound_before_begin: AtomicBool,
        completed_callback: Mutex<Vec<TrustedModdingFlowOAuthCompletion>>,
        operation_ids: Mutex<Vec<(&'static str, String)>>,
    }

    impl MockCore {
        fn new(calls: Arc<Mutex<Vec<&'static str>>>) -> Self {
            Self {
                begin_mode: BeginMode::Valid,
                complete_fails: false,
                cancel_fails: false,
                calls,
                begin_calls: AtomicUsize::new(0),
                complete_calls: AtomicUsize::new(0),
                cancel_calls: AtomicUsize::new(0),
                bound_before_begin: AtomicBool::new(false),
                completed_callback: Mutex::new(Vec::new()),
                operation_ids: Mutex::new(Vec::new()),
            }
        }

        fn with_begin_mode(mut self, mode: BeginMode) -> Self {
            self.begin_mode = mode;
            self
        }

        fn with_complete_failure(mut self) -> Self {
            self.complete_fails = true;
            self
        }

        fn with_cancel_failure(mut self) -> Self {
            self.cancel_fails = true;
            self
        }
    }

    impl TrustedModdingFlowOAuthCore for MockCore {
        fn begin<'a>(
            &'a self,
            redirect_uri: &'a str,
            operation_id: &'a str,
        ) -> CoreCallFuture<'a, TrustedModdingFlowOAuthBegin> {
            Box::pin(async move {
                self.calls.lock().expect("call order").push("begin");
                self.begin_calls.fetch_add(1, Ordering::Relaxed);
                self.operation_ids
                    .lock()
                    .expect("operation ids")
                    .push(("begin", operation_id.to_string()));

                let redirect = Url::parse(redirect_uri).expect("loopback redirect");
                let address = format!(
                    "{}:{}",
                    redirect.host_str().expect("redirect host"),
                    redirect.port().expect("redirect port")
                );
                self.bound_before_begin
                    .store(StdTcpListener::bind(address).is_err(), Ordering::Relaxed);

                match self.begin_mode {
                    BeginMode::Fail => Err(TrustedModdingFlowOAuthCallError),
                    BeginMode::Valid => Ok(TrustedModdingFlowOAuthBegin {
                        transaction_id: TRANSACTION_ID.to_string(),
                        authorization_url: valid_authorization_url(redirect_uri),
                    }),
                    BeginMode::InvalidAuthorizationUrl => {
                        let mut authorization_url = valid_authorization_url(redirect_uri);
                        authorization_url.push_str("&unexpected=1");
                        Ok(TrustedModdingFlowOAuthBegin {
                            transaction_id: TRANSACTION_ID.to_string(),
                            authorization_url,
                        })
                    }
                    BeginMode::InvalidTransactionId => Ok(TrustedModdingFlowOAuthBegin {
                        transaction_id: "../hostile\r\ntransaction".to_string(),
                        authorization_url: valid_authorization_url(redirect_uri),
                    }),
                }
            })
        }

        fn complete<'a>(
            &'a self,
            _transaction_id: &'a str,
            completion: TrustedModdingFlowOAuthCompletion,
            operation_id: &'a str,
        ) -> CoreCallFuture<'a, ()> {
            Box::pin(async move {
                self.calls.lock().expect("call order").push("complete");
                self.complete_calls.fetch_add(1, Ordering::Relaxed);
                self.completed_callback
                    .lock()
                    .expect("completed callback")
                    .push(completion);
                self.operation_ids
                    .lock()
                    .expect("operation ids")
                    .push(("complete", operation_id.to_string()));
                if self.complete_fails {
                    Err(TrustedModdingFlowOAuthCallError)
                } else {
                    Ok(())
                }
            })
        }

        fn cancel<'a>(
            &'a self,
            _transaction_id: &'a str,
            operation_id: &'a str,
        ) -> CoreCallFuture<'a, ()> {
            Box::pin(async move {
                self.calls.lock().expect("call order").push("cancel");
                self.cancel_calls.fetch_add(1, Ordering::Relaxed);
                self.operation_ids
                    .lock()
                    .expect("operation ids")
                    .push(("cancel", operation_id.to_string()));
                if self.cancel_fails {
                    Err(TrustedModdingFlowOAuthCallError)
                } else {
                    Ok(())
                }
            })
        }
    }

    #[derive(Clone, Copy)]
    enum BrowserMode {
        AuthorizationCode,
        AuthorizationError,
        NoCallback,
        Fail,
    }

    struct MockBrowser {
        mode: BrowserMode,
        calls: Arc<Mutex<Vec<&'static str>>>,
        open_calls: AtomicUsize,
    }

    impl MockBrowser {
        fn new(mode: BrowserMode, calls: Arc<Mutex<Vec<&'static str>>>) -> Self {
            Self {
                mode,
                calls,
                open_calls: AtomicUsize::new(0),
            }
        }
    }

    impl ModdingFlowAuthorizationBrowser for MockBrowser {
        fn open_authorization_url(
            &self,
            authorization_url: &str,
        ) -> Result<(), AuthorizationBrowserOpenError> {
            self.calls.lock().expect("call order").push("open");
            self.open_calls.fetch_add(1, Ordering::Relaxed);
            match self.mode {
                BrowserMode::AuthorizationCode => {
                    send_callback(authorization_url, false)?;
                    Ok(())
                }
                BrowserMode::AuthorizationError => {
                    send_callback(authorization_url, true)?;
                    Ok(())
                }
                BrowserMode::NoCallback => Ok(()),
                BrowserMode::Fail => Err(AuthorizationBrowserOpenError),
            }
        }
    }

    fn send_callback(
        authorization_url: &str,
        oauth_error: bool,
    ) -> Result<(), AuthorizationBrowserOpenError> {
        let authorization =
            Url::parse(authorization_url).map_err(|_| AuthorizationBrowserOpenError)?;
        let redirect_uri = authorization
            .query_pairs()
            .find_map(|(name, value)| (name == "redirect_uri").then(|| value.into_owned()))
            .ok_or(AuthorizationBrowserOpenError)?;
        let state = authorization
            .query_pairs()
            .find_map(|(name, value)| (name == "state").then(|| value.into_owned()))
            .ok_or(AuthorizationBrowserOpenError)?;
        let redirect = Url::parse(&redirect_uri).map_err(|_| AuthorizationBrowserOpenError)?;
        let host = format!(
            "{}:{}",
            redirect.host_str().ok_or(AuthorizationBrowserOpenError)?,
            redirect.port().ok_or(AuthorizationBrowserOpenError)?
        );
        let target = if oauth_error {
            format!(
                "{}?error=access_denied&error_description=private+detail&state={state}&iss=https%3A%2F%2Fmoddingflow.com",
                redirect.path()
            )
        } else {
            format!(
                "{}?code={CODE}&state={state}&iss=https%3A%2F%2Fmoddingflow.com",
                redirect.path()
            )
        };
        let request = format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        let mut stream = StdTcpStream::connect(&host).map_err(|_| AuthorizationBrowserOpenError)?;
        stream
            .write_all(request.as_bytes())
            .map_err(|_| AuthorizationBrowserOpenError)
    }

    #[test]
    fn validates_only_the_exact_allowlisted_authorization_contract() {
        let redirect_uri = "http://127.0.0.1:49152/oauth/fluxora/callback";
        assert_eq!(
            validate_authorization_url(&valid_authorization_url(redirect_uri), redirect_uri),
            Ok(())
        );

        let mut duplicate = valid_authorization_url(redirect_uri);
        duplicate.push_str("&state=other-state");
        let mut unknown = valid_authorization_url(redirect_uri);
        unknown.push_str("&prompt=consent");
        let mut fragment = valid_authorization_url(redirect_uri);
        fragment.push_str("#private");
        let wrong_redirect =
            valid_authorization_url("http://127.0.0.1:49153/oauth/fluxora/callback");
        let oversized_state = "s".repeat(MAX_OPAQUE_PARAMETER_BYTES + 1);
        let oversized_nonce = "n".repeat(MAX_OPAQUE_PARAMETER_BYTES + 1);
        let oversized_state_url = authorization_url_from_pairs(
            redirect_uri,
            &[
                ("client_id", PUBLIC_CLIENT_ID),
                ("redirect_uri", redirect_uri),
                ("response_type", "code"),
                ("scope", REQUIRED_SCOPES),
                ("code_challenge", CHALLENGE),
                ("code_challenge_method", "S256"),
                ("state", &oversized_state),
                ("nonce", NONCE),
            ],
        );
        let oversized_nonce_url = authorization_url_from_pairs(
            redirect_uri,
            &[
                ("client_id", PUBLIC_CLIENT_ID),
                ("redirect_uri", redirect_uri),
                ("response_type", "code"),
                ("scope", REQUIRED_SCOPES),
                ("code_challenge", CHALLENGE),
                ("code_challenge_method", "S256"),
                ("state", STATE),
                ("nonce", &oversized_nonce),
            ],
        );
        let missing_nonce = authorization_url_from_pairs(
            redirect_uri,
            &[
                ("client_id", PUBLIC_CLIENT_ID),
                ("redirect_uri", redirect_uri),
                ("response_type", "code"),
                ("scope", REQUIRED_SCOPES),
                ("code_challenge", CHALLENGE),
                ("code_challenge_method", "S256"),
                ("state", STATE),
            ],
        );
        let invalid = [
            valid_authorization_url(redirect_uri).replacen("https://", "http://", 1),
            valid_authorization_url(redirect_uri).replacen("https://", "HTTPS://", 1),
            valid_authorization_url(redirect_uri).replacen("moddingflow.com", "MODDINGFLOW.com", 1),
            valid_authorization_url(redirect_uri).replacen(
                "/oauth/authorize",
                "/oauth/Authorize",
                1,
            ),
            valid_authorization_url(redirect_uri).replacen(
                "https://moddingflow.com",
                "https://user@moddingflow.com",
                1,
            ),
            valid_authorization_url(redirect_uri).replacen(
                "https://moddingflow.com",
                "https://moddingflow.com:443",
                1,
            ),
            fragment,
            valid_authorization_url(redirect_uri).replacen(PUBLIC_CLIENT_ID, "other-client", 1),
            wrong_redirect,
            valid_authorization_url(redirect_uri).replacen(
                "response_type=code",
                "response_type=token",
                1,
            ),
            valid_authorization_url(redirect_uri).replacen("openid+", "openid+account%3Aread+", 1),
            valid_authorization_url(redirect_uri).replacen("S256", "plain", 1),
            valid_authorization_url(redirect_uri).replacen(STATE, "", 1),
            valid_authorization_url(redirect_uri).replacen(NONCE, "", 1),
            valid_authorization_url(redirect_uri).replacen(CHALLENGE, "short", 1),
            valid_authorization_url(redirect_uri).replacen("client_id=", "%63lient_id=", 1),
            oversized_state_url,
            oversized_nonce_url,
            missing_nonce,
            duplicate,
            unknown,
        ];
        for value in invalid {
            assert!(
                validate_authorization_url(&value, redirect_uri).is_err(),
                "accepted invalid authorization URL"
            );
        }
    }

    #[test]
    fn bind_precedes_begin_and_success_passes_typed_callback_to_complete() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls));
            let browser = MockBrowser::new(BrowserMode::AuthorizationCode, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(2))
                    .await
                    .expect("bind flow");

            assert_eq!(session.run(&core, &browser).await, Ok(()));
            assert!(core.bound_before_begin.load(Ordering::Relaxed));
            assert_eq!(core.begin_calls.load(Ordering::Relaxed), 1);
            assert_eq!(core.complete_calls.load(Ordering::Relaxed), 1);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 0);
            assert_eq!(
                *core.completed_callback.lock().expect("completed callback"),
                vec![TrustedModdingFlowOAuthCompletion::AuthorizationCode {
                    code: CODE.to_string(),
                    state: STATE.to_string(),
                    issuer: crate::oauth_loopback::OAUTH_ISSUER.to_string(),
                }]
            );
            assert_eq!(
                *calls.lock().expect("call order"),
                vec!["begin", "open", "complete"]
            );
            assert_eq!(
                *core.operation_ids.lock().expect("operation ids"),
                vec![
                    ("begin", OPERATION_ID.to_string()),
                    ("complete", OPERATION_ID.to_string())
                ]
            );
        });
    }

    #[test]
    fn invalid_authorization_url_is_never_opened_and_cancels_core_once() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls))
                .with_begin_mode(BeginMode::InvalidAuthorizationUrl);
            let browser = MockBrowser::new(BrowserMode::NoCallback, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(1))
                    .await
                    .expect("bind flow");

            assert!(matches!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::InvalidAuthorizationUrl {
                    cancellation: CoreCancelOutcome::Succeeded,
                    ..
                })
            ));
            assert_eq!(browser.open_calls.load(Ordering::Relaxed), 0);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
            assert_eq!(*calls.lock().expect("call order"), vec!["begin", "cancel"]);
        });
    }

    #[test]
    fn malformed_core_transaction_id_is_never_opened_completed_or_cancelled() {
        run_async(async {
            for invalid in [
                "".to_string(),
                "contains space".to_string(),
                "../path".to_string(),
                "line\nbreak".to_string(),
                "x".repeat(TRANSACTION_ID_BYTES + 1),
                "x".repeat(TRANSACTION_ID_BYTES - 1),
                "abcdefghijklmnopqrstu.".to_string(),
            ] {
                assert!(!is_valid_transaction_id(&invalid));
            }
            assert!(is_valid_transaction_id(TRANSACTION_ID));

            let calls = Arc::new(Mutex::new(Vec::new()));
            let core =
                MockCore::new(Arc::clone(&calls)).with_begin_mode(BeginMode::InvalidTransactionId);
            let browser = MockBrowser::new(BrowserMode::NoCallback, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(1))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::InvalidCoreTransactionId)
            );
            assert_eq!(browser.open_calls.load(Ordering::Relaxed), 0);
            assert_eq!(core.complete_calls.load(Ordering::Relaxed), 0);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 0);
            assert_eq!(*calls.lock().expect("call order"), vec!["begin"]);
        });
    }

    #[test]
    fn browser_open_failure_cancels_core_once() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls));
            let browser = MockBrowser::new(BrowserMode::Fail, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(1))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::BrowserOpenFailed {
                    cancellation: CoreCancelOutcome::Succeeded
                })
            );
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
            assert_eq!(
                *calls.lock().expect("call order"),
                vec!["begin", "open", "cancel"]
            );
        });
    }

    #[test]
    fn timeout_cancels_core_once() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls));
            let browser = MockBrowser::new(BrowserMode::NoCallback, Arc::clone(&calls));
            let (session, _cancel) = PreparedModdingFlowOAuth::bind_with_timeout(
                OPERATION_ID,
                Duration::from_millis(20),
            )
            .await
            .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::TimedOut {
                    cancellation: CoreCancelOutcome::Succeeded
                })
            );
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
        });
    }

    #[test]
    fn oauth_error_is_completed_by_core_for_state_validation_without_cancel() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls));
            let browser = MockBrowser::new(BrowserMode::AuthorizationError, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(2))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::AuthorizationRejected)
            );
            assert_eq!(core.complete_calls.load(Ordering::Relaxed), 1);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 0);
            assert_eq!(
                *core.completed_callback.lock().expect("completed callback"),
                vec![TrustedModdingFlowOAuthCompletion::AuthorizationError {
                    error: "access_denied".to_string(),
                    error_description: Some("private detail".to_string()),
                    state: STATE.to_string(),
                    issuer: crate::oauth_loopback::OAUTH_ISSUER.to_string(),
                }]
            );
            assert_eq!(
                *calls.lock().expect("call order"),
                vec!["begin", "open", "complete"]
            );
        });
    }

    #[test]
    fn rejected_callback_cancels_only_when_typed_core_completion_fails() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls)).with_complete_failure();
            let browser = MockBrowser::new(BrowserMode::AuthorizationError, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(2))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::CoreCompleteFailed {
                    cancellation: CoreCancelOutcome::Succeeded
                })
            );
            assert_eq!(core.complete_calls.load(Ordering::Relaxed), 1);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
            assert_eq!(
                *calls.lock().expect("call order"),
                vec!["begin", "open", "complete", "cancel"]
            );
        });
    }

    #[test]
    fn explicit_cancellation_cancels_core_once() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = Arc::new(MockCore::new(Arc::clone(&calls)));
            let browser = Arc::new(MockBrowser::new(
                BrowserMode::NoCallback,
                Arc::clone(&calls),
            ));
            let (session, cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(2))
                    .await
                    .expect("bind flow");
            let run_core = Arc::clone(&core);
            let run_browser = Arc::clone(&browser);
            let task = tauri::async_runtime::spawn(async move {
                session.run(run_core.as_ref(), run_browser.as_ref()).await
            });

            timeout(Duration::from_secs(1), async {
                while browser.open_calls.load(Ordering::Relaxed) == 0 {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("browser open");
            assert!(cancel.cancel());

            assert_eq!(
                task.await.expect("flow task"),
                Err(ModdingFlowOAuthError::Cancelled {
                    cancellation: CoreCancelOutcome::Succeeded
                })
            );
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
        });
    }

    #[test]
    fn complete_failure_cancels_core_once_after_typed_callback() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls)).with_complete_failure();
            let browser = MockBrowser::new(BrowserMode::AuthorizationCode, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(2))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::CoreCompleteFailed {
                    cancellation: CoreCancelOutcome::Succeeded
                })
            );
            assert_eq!(core.complete_calls.load(Ordering::Relaxed), 1);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
            assert_eq!(
                *calls.lock().expect("call order"),
                vec!["begin", "open", "complete", "cancel"]
            );
        });
    }

    #[test]
    fn begin_failure_does_not_open_browser_or_issue_unaddressable_cancel() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls)).with_begin_mode(BeginMode::Fail);
            let browser = MockBrowser::new(BrowserMode::NoCallback, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(1))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::CoreBeginFailed)
            );
            assert_eq!(browser.open_calls.load(Ordering::Relaxed), 0);
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 0);
        });
    }

    #[test]
    fn failed_core_cancel_is_not_retried() {
        run_async(async {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let core = MockCore::new(Arc::clone(&calls)).with_cancel_failure();
            let browser = MockBrowser::new(BrowserMode::Fail, Arc::clone(&calls));
            let (session, _cancel) =
                PreparedModdingFlowOAuth::bind_with_timeout(OPERATION_ID, Duration::from_secs(1))
                    .await
                    .expect("bind flow");

            assert_eq!(
                session.run(&core, &browser).await,
                Err(ModdingFlowOAuthError::BrowserOpenFailed {
                    cancellation: CoreCancelOutcome::Failed
                })
            );
            assert_eq!(core.cancel_calls.load(Ordering::Relaxed), 1);
        });
    }
}
