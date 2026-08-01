use reqwest::Url;
use std::future::{pending, poll_fn, Future};
use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr};
use std::task::Poll;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::{sleep, timeout, Duration};

pub(crate) const OAUTH_CALLBACK_PATH: &str = "/oauth/fluxora/callback";
pub(crate) const OAUTH_ISSUER: &str = "https://moddingflow.com";
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_REJECTED_REQUESTS: usize = 16;
const MAX_AUTHORIZATION_CODE_BYTES: usize = 2048;
const MAX_ERROR_BYTES: usize = 256;
const MAX_ERROR_DESCRIPTION_BYTES: usize = 2048;
const OAUTH_STATE_BYTES: usize = 43;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) enum OAuthLoopbackCallback {
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

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum OAuthLoopbackError {
    BindFailed(ErrorKind),
    UnexpectedBindAddress,
    AcceptFailed(ErrorKind),
    Cancelled,
    TimedOut,
    TooManyRejectedRequests,
}

pub(crate) struct OAuthLoopbackCancelHandle {
    sender: Option<oneshot::Sender<()>>,
}

impl OAuthLoopbackCancelHandle {
    pub(crate) fn cancel(mut self) -> bool {
        self.sender
            .take()
            .is_some_and(|sender| sender.send(()).is_ok())
    }
}

pub(crate) struct BoundOAuthLoopback {
    listener: TcpListener,
    local_addr: SocketAddr,
    expected_host: String,
    redirect_uri: String,
    cancel_receiver: oneshot::Receiver<()>,
}

impl BoundOAuthLoopback {
    pub(crate) async fn bind() -> Result<(Self, OAuthLoopbackCancelHandle), OAuthLoopbackError> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|error| OAuthLoopbackError::BindFailed(error.kind()))?;
        let local_addr = listener
            .local_addr()
            .map_err(|error| OAuthLoopbackError::BindFailed(error.kind()))?;
        if local_addr.ip() != Ipv4Addr::LOCALHOST {
            return Err(OAuthLoopbackError::UnexpectedBindAddress);
        }

        let expected_host = format!("127.0.0.1:{}", local_addr.port());
        let redirect_uri = format!("http://{expected_host}{OAUTH_CALLBACK_PATH}");
        let (sender, cancel_receiver) = oneshot::channel();
        Ok((
            Self {
                listener,
                local_addr,
                expected_host,
                redirect_uri,
                cancel_receiver,
            },
            OAuthLoopbackCancelHandle {
                sender: Some(sender),
            },
        ))
    }

    pub(crate) fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub(crate) fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    pub(crate) async fn wait_for_callback(
        self,
        maximum_wait: Duration,
    ) -> Result<OAuthLoopbackCallback, OAuthLoopbackError> {
        let Self {
            listener,
            expected_host,
            cancel_receiver,
            ..
        } = self;
        let mut callback = Box::pin(accept_until_valid_callback(listener, expected_host));
        let mut cancellation = Box::pin(cancellation_requested(cancel_receiver));
        let mut deadline = Box::pin(sleep(maximum_wait));

        poll_fn(|context| {
            if let Poll::Ready(result) = callback.as_mut().poll(context) {
                return Poll::Ready(result);
            }
            if let Poll::Ready(()) = cancellation.as_mut().poll(context) {
                return Poll::Ready(Err(OAuthLoopbackError::Cancelled));
            }
            if let Poll::Ready(()) = deadline.as_mut().poll(context) {
                return Poll::Ready(Err(OAuthLoopbackError::TimedOut));
            }
            Poll::Pending
        })
        .await
    }
}

async fn cancellation_requested(receiver: oneshot::Receiver<()>) {
    if receiver.await.is_err() {
        pending::<()>().await;
    }
}

async fn accept_until_valid_callback(
    listener: TcpListener,
    expected_host: String,
) -> Result<OAuthLoopbackCallback, OAuthLoopbackError> {
    let mut rejected = 0usize;
    loop {
        let (mut stream, peer) = listener
            .accept()
            .await
            .map_err(|error| OAuthLoopbackError::AcceptFailed(error.kind()))?;
        if peer.ip() != Ipv4Addr::LOCALHOST {
            rejected += 1;
            respond(&mut stream, ResponseKind::BadRequest).await;
        } else {
            let request = timeout(REQUEST_READ_TIMEOUT, read_request(&mut stream)).await;
            match request {
                Err(_) => {
                    rejected += 1;
                    respond(&mut stream, ResponseKind::RequestTimeout).await;
                }
                Ok(Err(RequestReadError::TooLarge)) => {
                    rejected += 1;
                    respond(&mut stream, ResponseKind::PayloadTooLarge).await;
                }
                Ok(Err(RequestReadError::Invalid)) => {
                    rejected += 1;
                    respond(&mut stream, ResponseKind::BadRequest).await;
                }
                Ok(Ok(request)) => match parse_callback_request(&request, &expected_host) {
                    Ok(callback) => {
                        respond(&mut stream, ResponseKind::Accepted).await;
                        return Ok(callback);
                    }
                    Err(kind) => {
                        rejected += 1;
                        respond(&mut stream, kind).await;
                    }
                },
            }
        }

        if rejected >= MAX_REJECTED_REQUESTS {
            return Err(OAuthLoopbackError::TooManyRejectedRequests);
        }
    }
}

#[derive(Clone, Copy)]
enum RequestReadError {
    Invalid,
    TooLarge,
}

async fn read_request(stream: &mut TcpStream) -> Result<Vec<u8>, RequestReadError> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let remaining = MAX_REQUEST_BYTES
            .saturating_add(1)
            .saturating_sub(request.len());
        if remaining == 0 {
            return Err(RequestReadError::TooLarge);
        }
        let read_limit = remaining.min(chunk.len());
        let read = stream
            .read(&mut chunk[..read_limit])
            .await
            .map_err(|_| RequestReadError::Invalid)?;
        if read == 0 {
            return Err(RequestReadError::Invalid);
        }
        request.extend_from_slice(&chunk[..read]);
        if request.len() > MAX_REQUEST_BYTES {
            return Err(RequestReadError::TooLarge);
        }
        if let Some(header_end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            if request.len() != header_end + 4 {
                return Err(RequestReadError::Invalid);
            }
            return Ok(request);
        }
    }
}

fn parse_callback_request(
    request: &[u8],
    expected_host: &str,
) -> Result<OAuthLoopbackCallback, ResponseKind> {
    let request = std::str::from_utf8(request).map_err(|_| ResponseKind::BadRequest)?;
    let mut lines = request.split("\r\n");
    let request_line = lines.next().ok_or(ResponseKind::BadRequest)?;
    let mut request_parts = request_line.split(' ');
    let method = request_parts.next().ok_or(ResponseKind::BadRequest)?;
    let target = request_parts.next().ok_or(ResponseKind::BadRequest)?;
    let version = request_parts.next().ok_or(ResponseKind::BadRequest)?;
    if request_parts.next().is_some() || version != "HTTP/1.1" {
        return Err(ResponseKind::BadRequest);
    }
    if method != "GET" {
        return Err(ResponseKind::MethodNotAllowed);
    }

    let mut host = None;
    let mut content_length = None;
    for line in lines {
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').ok_or(ResponseKind::BadRequest)?;
        if name.eq_ignore_ascii_case("host") {
            if host.replace(value.trim()).is_some() {
                return Err(ResponseKind::BadRequest);
            }
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(ResponseKind::BadRequest);
        } else if name.eq_ignore_ascii_case("content-length") {
            let value = value.trim();
            if content_length.is_some()
                || value.is_empty()
                || !value.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(ResponseKind::BadRequest);
            }
            let parsed = value.parse::<u64>().map_err(|_| ResponseKind::BadRequest)?;
            if parsed != 0 {
                return Err(ResponseKind::BadRequest);
            }
            content_length = Some(parsed);
        }
    }
    if host != Some(expected_host) {
        return Err(ResponseKind::BadRequest);
    }

    let (path, query) = target.split_once('?').ok_or(ResponseKind::BadRequest)?;
    if path != OAUTH_CALLBACK_PATH || query.is_empty() {
        return Err(ResponseKind::NotFound);
    }
    validate_raw_callback_query(query)?;
    let url = Url::parse(&format!("http://{expected_host}{target}"))
        .map_err(|_| ResponseKind::BadRequest)?;
    if url.path() != OAUTH_CALLBACK_PATH || url.fragment().is_some() {
        return Err(ResponseKind::NotFound);
    }

    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;
    let mut issuer = None;
    for (key, value) in url.query_pairs() {
        let value = value.into_owned();
        match key.as_ref() {
            "code" => set_opaque_once(&mut code, value, MAX_AUTHORIZATION_CODE_BYTES)?,
            "state" => set_state_once(&mut state, value)?,
            "error" => set_opaque_once(&mut error, value, MAX_ERROR_BYTES)?,
            "error_description" => {
                set_text_once(&mut error_description, value, MAX_ERROR_DESCRIPTION_BYTES)?
            }
            "iss" => set_text_once(&mut issuer, value, OAUTH_ISSUER.len())?,
            _ => return Err(ResponseKind::BadRequest),
        }
    }

    let state = state.ok_or(ResponseKind::BadRequest)?;
    let issuer = issuer.ok_or(ResponseKind::BadRequest)?;
    if issuer != OAUTH_ISSUER {
        return Err(ResponseKind::BadRequest);
    }
    match (code, error) {
        (Some(code), None) if error_description.is_none() => {
            Ok(OAuthLoopbackCallback::AuthorizationCode {
                code,
                state,
                issuer,
            })
        }
        (None, Some(error)) => Ok(OAuthLoopbackCallback::AuthorizationError {
            error,
            error_description,
            state,
            issuer,
        }),
        _ => Err(ResponseKind::BadRequest),
    }
}

fn validate_raw_callback_query(query: &str) -> Result<(), ResponseKind> {
    for parameter in query.split('&') {
        let (name, value) = parameter.split_once('=').ok_or(ResponseKind::BadRequest)?;
        if name.is_empty() || value.is_empty() || name.contains(['%', '+']) {
            return Err(ResponseKind::BadRequest);
        }
        if name == "state"
            && (value.len() != OAUTH_STATE_BYTES
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
        {
            return Err(ResponseKind::BadRequest);
        }
    }
    Ok(())
}

fn set_text_once(
    slot: &mut Option<String>,
    value: String,
    maximum_bytes: usize,
) -> Result<(), ResponseKind> {
    if slot.is_some()
        || value.is_empty()
        || value.len() > maximum_bytes
        || value.chars().any(char::is_control)
    {
        return Err(ResponseKind::BadRequest);
    }
    *slot = Some(value);
    Ok(())
}

fn set_opaque_once(
    slot: &mut Option<String>,
    value: String,
    maximum_bytes: usize,
) -> Result<(), ResponseKind> {
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
    {
        return Err(ResponseKind::BadRequest);
    }
    set_text_once(slot, value, maximum_bytes)
}

fn set_state_once(slot: &mut Option<String>, value: String) -> Result<(), ResponseKind> {
    if value.len() != OAUTH_STATE_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ResponseKind::BadRequest);
    }
    set_text_once(slot, value, OAUTH_STATE_BYTES)
}

#[derive(Clone, Copy)]
enum ResponseKind {
    Accepted,
    BadRequest,
    MethodNotAllowed,
    NotFound,
    PayloadTooLarge,
    RequestTimeout,
}

impl ResponseKind {
    fn status(self) -> &'static str {
        match self {
            Self::Accepted => "200 OK",
            Self::BadRequest => "400 Bad Request",
            Self::MethodNotAllowed => "405 Method Not Allowed",
            Self::NotFound => "404 Not Found",
            Self::PayloadTooLarge => "413 Payload Too Large",
            Self::RequestTimeout => "408 Request Timeout",
        }
    }

    fn body(self) -> &'static str {
        match self {
            Self::Accepted => "Authorization received. You can return to Fluxora.",
            _ => "This authorization callback was not accepted.",
        }
    }
}

async fn respond(stream: &mut TcpStream, kind: ResponseKind) {
    let body = kind.body();
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        kind.status(),
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "0123456789abcdef0123456789abcdef0123456789A";

    fn success_target(code: &str, state: &str) -> String {
        format!("{OAUTH_CALLBACK_PATH}?code={code}&state={state}&iss=https%3A%2F%2Fmoddingflow.com")
    }

    fn error_target(error: &str, state: &str) -> String {
        format!(
            "{OAUTH_CALLBACK_PATH}?error={error}&error_description=private+detail&state={state}&iss=https%3A%2F%2Fmoddingflow.com"
        )
    }

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn request(method: &str, target: &str, host: &str) -> String {
        format!("{method} {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")
    }

    async fn exchange(address: SocketAddr, request: &[u8]) -> String {
        let mut stream = TcpStream::connect(address).await.expect("connect loopback");
        stream.write_all(request).await.expect("write request");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("read response");
        String::from_utf8(response).expect("UTF-8 response")
    }

    #[test]
    fn binds_only_ipv4_loopback_with_a_dynamic_port() {
        run_async(async {
            let (loopback, _cancel) = BoundOAuthLoopback::bind().await.expect("bind loopback");
            assert_eq!(loopback.local_addr().ip(), Ipv4Addr::LOCALHOST);
            assert_ne!(loopback.local_addr().port(), 0);
            assert_eq!(
                loopback.redirect_uri(),
                format!(
                    "http://127.0.0.1:{}{OAUTH_CALLBACK_PATH}",
                    loopback.local_addr().port()
                )
            );
        });
    }

    #[test]
    fn accepts_one_exact_get_callback_without_echoing_secrets() {
        run_async(async {
            let (loopback, _cancel) = BoundOAuthLoopback::bind().await.expect("bind loopback");
            let address = loopback.local_addr();
            let host = format!("127.0.0.1:{}", address.port());
            let waiter =
                tauri::async_runtime::spawn(loopback.wait_for_callback(Duration::from_secs(2)));
            let response = exchange(
                address,
                request("GET", &success_target("secret-code", STATE), &host).as_bytes(),
            )
            .await;
            let callback = waiter.await.expect("wait task").expect("callback");
            match callback {
                OAuthLoopbackCallback::AuthorizationCode {
                    code,
                    state,
                    issuer,
                } => {
                    assert_eq!(code, "secret-code");
                    assert_eq!(state, STATE);
                    assert_eq!(issuer, OAUTH_ISSUER);
                }
                OAuthLoopbackCallback::AuthorizationError { .. } => {
                    panic!("unexpected OAuth error")
                }
            }
            assert!(response.starts_with("HTTP/1.1 200 OK"));
            assert!(!response.contains("secret-code"));
            assert!(!response.contains(STATE));
        });
    }

    #[test]
    fn rejects_wrong_method_path_host_and_oversized_requests_before_valid_callback() {
        run_async(async {
            let (loopback, _cancel) = BoundOAuthLoopback::bind().await.expect("bind loopback");
            let address = loopback.local_addr();
            let host = format!("127.0.0.1:{}", address.port());
            let waiter =
                tauri::async_runtime::spawn(loopback.wait_for_callback(Duration::from_secs(3)));

            let wrong_method = exchange(
                address,
                request("POST", &success_target("a", STATE), &host).as_bytes(),
            )
            .await;
            assert!(wrong_method.starts_with("HTTP/1.1 405"));

            let wrong_path = exchange(
                address,
                request(
                    "GET",
                    &success_target("a", STATE).replacen(OAUTH_CALLBACK_PATH, "/oauth/other", 1),
                    &host,
                )
                .as_bytes(),
            )
            .await;
            assert!(wrong_path.starts_with("HTTP/1.1 404"));

            let wrong_host = exchange(
                address,
                request("GET", &success_target("a", STATE), "localhost:1").as_bytes(),
            )
            .await;
            assert!(wrong_host.starts_with("HTTP/1.1 400"));

            let oversized = format!(
                "GET {OAUTH_CALLBACK_PATH}?code={}&state={STATE}&iss=https%3A%2F%2Fmoddingflow.com HTTP/1.1\r\nHost: {host}\r\n\r\n",
                "a".repeat(MAX_REQUEST_BYTES)
            );
            let oversized_response = exchange(address, oversized.as_bytes()).await;
            assert!(oversized_response.starts_with("HTTP/1.1 413"));

            let accepted = exchange(
                address,
                request("GET", &success_target("final-code", STATE), &host).as_bytes(),
            )
            .await;
            assert!(accepted.starts_with("HTTP/1.1 200"));
            let callback = waiter.await.expect("wait task").expect("callback");
            assert!(matches!(
                callback,
                OAuthLoopbackCallback::AuthorizationCode { code, state, issuer }
                    if code == "final-code" && state == STATE && issuer == OAUTH_ISSUER
            ));
        });
    }

    #[test]
    fn rejects_duplicate_unknown_and_mixed_result_parameters() {
        let host = "127.0.0.1:49152";
        for target in [
            format!("{}&code=b", success_target("a", STATE)),
            format!("{}&extra=c", success_target("a", STATE)),
            format!("{}&error=denied", success_target("a", STATE)),
            format!("{}&error_description=detail", success_target("a", STATE)),
        ] {
            let value = request("GET", &target, host);
            assert!(parse_callback_request(value.as_bytes(), host).is_err());
        }
    }

    #[test]
    fn returns_typed_oauth_error_without_reflecting_it_to_browser() {
        run_async(async {
            let (loopback, _cancel) = BoundOAuthLoopback::bind().await.expect("bind loopback");
            let address = loopback.local_addr();
            let host = format!("127.0.0.1:{}", address.port());
            let waiter =
                tauri::async_runtime::spawn(loopback.wait_for_callback(Duration::from_secs(2)));
            let response = exchange(
                address,
                request("GET", &error_target("access_denied", STATE), &host).as_bytes(),
            )
            .await;
            let callback = waiter.await.expect("wait task").expect("callback");
            match callback {
                OAuthLoopbackCallback::AuthorizationError {
                    error,
                    error_description,
                    state,
                    issuer,
                } => {
                    assert_eq!(error, "access_denied");
                    assert_eq!(error_description.as_deref(), Some("private detail"));
                    assert_eq!(state, STATE);
                    assert_eq!(issuer, OAUTH_ISSUER);
                }
                OAuthLoopbackCallback::AuthorizationCode { .. } => panic!("unexpected code"),
            }
            assert!(!response.contains("access_denied"));
            assert!(!response.contains("private detail"));
            assert!(!response.contains(STATE));
        });
    }

    #[test]
    fn rejects_transfer_encoding_nonzero_or_malformed_content_length_and_body_bytes() {
        let host = "127.0.0.1:49152";
        let target = success_target("code", STATE);
        for headers in [
            "Transfer-Encoding: chunked\r\n",
            "tRaNsFeR-EnCoDiNg: identity\r\n",
            "Content-Length: 1\r\n",
            "Content-Length: nope\r\n",
            "Content-Length: 0\r\nContent-Length: 0\r\n",
        ] {
            let value = format!(
                "GET {target} HTTP/1.1\r\nHost: {host}\r\n{headers}Connection: close\r\n\r\n"
            );
            assert!(parse_callback_request(value.as_bytes(), host).is_err());
        }

        let zero = format!(
            "GET {target} HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        assert!(parse_callback_request(zero.as_bytes(), host).is_ok());

        run_async(async {
            let (loopback, _cancel) = BoundOAuthLoopback::bind().await.expect("bind loopback");
            let address = loopback.local_addr();
            let host = format!("127.0.0.1:{}", address.port());
            let waiter =
                tauri::async_runtime::spawn(loopback.wait_for_callback(Duration::from_secs(2)));
            let with_body = format!(
                "GET {} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\nx",
                success_target("forged", STATE)
            );
            let rejected = exchange(address, with_body.as_bytes()).await;
            assert!(rejected.starts_with("HTTP/1.1 400"));
            let accepted = exchange(
                address,
                request("GET", &success_target("valid", STATE), &host).as_bytes(),
            )
            .await;
            assert!(accepted.starts_with("HTTP/1.1 200"));
            assert!(waiter.await.expect("wait task").is_ok());
        });
    }

    #[test]
    fn rejects_noncanonical_state_code_and_issuer_values() {
        let host = "127.0.0.1:49152";
        let oversized_code = "a".repeat(MAX_AUTHORIZATION_CODE_BYTES + 1);
        let invalid = [
            success_target("code", "short-state"),
            success_target("code", &format!("{}%2F", &STATE[..40])),
            success_target("code", &format!("%41{}", &STATE[1..])),
            success_target("code/with/slash", STATE),
            success_target(&oversized_code, STATE),
            format!("{OAUTH_CALLBACK_PATH}?code=code&state={STATE}"),
            format!("{OAUTH_CALLBACK_PATH}?error=access_denied&state={STATE}"),
            format!("{OAUTH_CALLBACK_PATH}?error=access_denied&state={STATE}&iss=https%3A%2F%2Fevil.example"),
            format!("{OAUTH_CALLBACK_PATH}?code=code&state={STATE}&i%73s=https%3A%2F%2Fmoddingflow.com"),
            format!("{}&iss=https%3A%2F%2Fmoddingflow.com", success_target("code", STATE)),
            format!("{OAUTH_CALLBACK_PATH}?code=code&state={STATE}&iss=https%3A%2F%2Fevil.example"),
            format!("{OAUTH_CALLBACK_PATH}?code=code&state={STATE}&iss=https%253A%252F%252Fmoddingflow.com"),
        ];
        for target in invalid {
            let value = request("GET", &target, host);
            assert!(
                parse_callback_request(value.as_bytes(), host).is_err(),
                "unexpectedly accepted {target}"
            );
        }
    }

    #[test]
    fn timeout_and_explicit_cancel_are_distinct() {
        run_async(async {
            let (timed, _timed_cancel) = BoundOAuthLoopback::bind().await.expect("bind timeout");
            assert!(matches!(
                timed.wait_for_callback(Duration::from_millis(20)).await,
                Err(OAuthLoopbackError::TimedOut)
            ));

            let (cancelled, cancel) = BoundOAuthLoopback::bind().await.expect("bind cancel");
            assert!(cancel.cancel());
            assert!(matches!(
                cancelled.wait_for_callback(Duration::from_secs(2)).await,
                Err(OAuthLoopbackError::Cancelled)
            ));
        });
    }
}
