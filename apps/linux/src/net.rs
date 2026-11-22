// The network of the Linux app, as the Mac app's Server.swift: HTTP and the sockets to a sync server (a church's
// desktop host on the LAN), the device's sign-in kept between starts, and a host's own certificate trusted once, as a
// browser's warning is accepted once. Blocking, on threads of their own: the window hears back through `post`.
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The signed-in user, as the server answers it (`Me` in packages/core/src/accounts.ts).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Me { pub user_id: String, pub name: String, pub role: String, pub org_id: String, pub org_name: String }

/// A device's sign-in at a server: the session's bearer token, the paired device's token, and who.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Session { pub server: String, pub token: String, pub device: Option<String>, pub me: Me }

/// A host's certificate this device does not trust yet: its SHA-256, for the person to compare and accept.
#[derive(Clone, Debug)]
pub struct Untrusted { pub host: String, pub fingerprint: String }

pub enum Failure { Untrusted(Untrusted), Unreachable(String) }

/// The app's own folders (XDG's): its settings and its databases.
fn folder(var: &str, fallback: &str) -> PathBuf {
    let base = std::env::var(var).map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(fallback));
    let dir = base.join("gospel-presenter");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
pub fn config_dir() -> PathBuf { folder("XDG_CONFIG_HOME", ".config") }
pub fn data_dir() -> PathBuf { folder("XDG_DATA_HOME", ".local/share") }

/// A file only this user reads: the session's tokens (the Mac keeps them in its Keychain).
fn write_private(path: &PathBuf, text: &str) {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path);
    if let Ok(mut f) = file { let _ = f.write_all(text.as_bytes()); }
}

/// The session kept, so a restarted app opens straight into its database (spec 01: signed in once).
pub fn saved_session() -> Option<Session> {
    serde_json::from_str(&std::fs::read_to_string(config_dir().join("session.json")).ok()?).ok()
}
pub fn save_session(s: Option<&Session>) {
    let path = config_dir().join("session.json");
    match s {
        Some(s) => write_private(&path, &serde_json::to_string(s).unwrap_or_default()),
        None => { let _ = std::fs::remove_file(path); }
    }
}

/// The certificates a person accepted, one per host (host → SHA-256 of the leaf certificate).
fn pins() -> HashMap<String, String> {
    std::fs::read_to_string(config_dir().join("certificates.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}
pub fn trust(c: &Untrusted) {
    let mut all = pins();
    all.insert(c.host.clone(), c.fingerprint.clone());
    write_private(&config_dir().join("certificates.json"), &serde_json::to_string(&all).unwrap_or_default());
}

/// A certificate's SHA-256 as the Mac app and the host show it: upper-case hex pairs with colons.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// The system's trust (the Mozilla roots), else exactly the certificate the person accepted for that host; the one
/// refused is kept, to show.
#[derive(Debug)]
struct Pinned { inner: Arc<WebPkiServerVerifier>, refused: Arc<Mutex<Option<Untrusted>>> }

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(&self, end: &CertificateDer<'_>, others: &[CertificateDer<'_>], name: &ServerName<'_>, ocsp: &[u8], now: UnixTime)
        -> Result<ServerCertVerified, rustls::Error> {
        let Err(e) = self.inner.verify_server_cert(end, others, name, ocsp, now) else { return Ok(ServerCertVerified::assertion()) };
        let host = name.to_str().to_string();
        let fingerprint = fingerprint(end);
        if pins().get(&host) == Some(&fingerprint) { return Ok(ServerCertVerified::assertion()) }
        if let Ok(mut r) = self.refused.lock() { *r = Some(Untrusted { host, fingerprint }) }
        Err(e)
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(m, c, d)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(m, c, d)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> { self.inner.supported_verify_schemes() }
}

/// HTTP to one server. A network failure is a `Failure`; any HTTP answer is an answer.
#[derive(Clone)]
pub struct Server { pub base: String, agent: ureq::Agent, tls: Arc<ClientConfig>, refused: Arc<Mutex<Option<Untrusted>>> }

impl Server {
    /// The address as typed: https unless it says otherwise, no slash at the end.
    pub fn new(address: &str) -> Result<Server, String> {
        let mut base = address.trim().to_string();
        if !base.contains("://") { base = format!("https://{base}") }
        while base.ends_with('/') { base.pop(); }
        if base.split("://").nth(1).is_none_or(str::is_empty) { return Err("bad-address".into()) }
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let roots = Arc::new(RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() });
        let inner = WebPkiServerVerifier::builder_with_provider(roots, provider.clone()).build().map_err(|e| e.to_string())?;
        let refused = Arc::new(Mutex::new(None));
        let tls = Arc::new(ClientConfig::builder_with_provider(provider).with_safe_default_protocol_versions().map_err(|e| e.to_string())?
            .dangerous().with_custom_certificate_verifier(Arc::new(Pinned { inner, refused: refused.clone() })).with_no_client_auth());
        let agent = ureq::AgentBuilder::new().tls_config(tls.clone()).timeout(Duration::from_secs(20)).build();
        Ok(Server { base, agent, tls, refused })
    }

    fn failed(&self, e: impl std::fmt::Display) -> Failure {
        match self.refused.lock().ok().and_then(|mut r| r.take()) {
            Some(u) => Failure::Untrusted(u),
            None => Failure::Unreachable(e.to_string()),
        }
    }

    /// A request, as `session` when given (the session's bearer token, and on a desktop host the device's): the status
    /// and the body's text.
    pub fn request(&self, method: &str, path: &str, json: Option<&str>, session: Option<&Session>) -> Result<(u16, String), Failure> {
        let mut req = self.agent.request(method, &format!("{}{path}", self.base));
        if let Some(s) = session {
            req = req.set("authorization", &format!("Bearer {}", s.token));
            if let Some(d) = &s.device { req = req.set("x-gp-device", d) }
        }
        let answer = match json {
            Some(body) => req.set("content-type", "application/json").send_string(body),
            None => req.call(),
        };
        match answer {
            Ok(r) | Err(ureq::Error::Status(_, r)) => {
                let status = r.status();
                Ok((status, r.into_string().unwrap_or_default()))
            }
            Err(e) => Err(self.failed(e)),
        }
    }

    /// A socket (`/api/sync/poke`, `/api/live/socket`): the credentials as subprotocols, so they stay out of the address
    /// and logs, as the web's `socketProtocols` sends them. Reads wait at most 150 ms, so its thread can be stopped and can send between them.
    pub fn socket(&self, path: &str, client_id: &str, s: &Session) -> Result<Socket, Failure> {
        use tungstenite::client::IntoClientRequest;
        let url = format!("{}{path}?clientId={client_id}", self.base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1));
        let mut request = url.as_str().into_client_request().map_err(|e| Failure::Unreachable(e.to_string()))?;
        let mut protocols = vec!["gp.v1".to_string(), format!("gp.auth.{}", s.token)];
        if let Some(d) = &s.device { protocols.push(format!("gp.device.{d}")) }
        request.headers_mut().insert("sec-websocket-protocol", protocols.join(", ").parse().map_err(|_| Failure::Unreachable("token".into()))?);
        let uri = request.uri().clone();
        let host = uri.host().unwrap_or_default().trim_start_matches('[').trim_end_matches(']');
        let port = uri.port_u16().unwrap_or(if uri.scheme_str() == Some("wss") { 443 } else { 80 });
        let stream = TcpStream::connect((host, port)).map_err(|e| self.failed(e))?;
        stream.set_read_timeout(Some(Duration::from_secs(20))).map_err(|e| self.failed(e))?;
        let connector = tungstenite::Connector::Rustls(self.tls.clone());
        let (socket, _) = tungstenite::client_tls_with_config(request, stream.try_clone().map_err(|e| self.failed(e))?, None, Some(connector))
            .map_err(|e| self.failed(e))?;
        // Short, so a thread both reads and sends what waits (the live socket's reports) without holding them long.
        let _ = stream.set_read_timeout(Some(Duration::from_millis(150)));
        Ok(socket)
    }
}

pub type Socket = tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>;

/// A read that only waited its second out: the socket is still open.
pub fn timed_out(e: &tungstenite::Error) -> bool {
    matches!(e, tungstenite::Error::Io(io) if matches!(io.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut))
}

/// Pairing with a desktop host (docs/sign-in-and-pairing.md): `/api/pair/status` says whether it takes a code, or lets
/// any device in (development, `GP_DEV_PAIR=1`).
pub enum Pairing { Dev, Code, NotAHost }

pub fn pairing(server: &Server) -> Result<Pairing, Failure> {
    let (status, body) = server.request("GET", "/api/pair/status", None, None)?;
    let b: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    Ok(match (status, b["required"].as_bool(), b["dev"].as_bool()) {
        (200, Some(true), Some(true)) => Pairing::Dev,
        (200, Some(true), _) => Pairing::Code,
        _ => Pairing::NotAHost,
    })
}

/// The device's token and a session, as the member the host chose; `code` None asks the development route. Refused:
/// the server's code.
pub fn claim(server: &Server, code: Option<&str>, name: &str) -> Result<Result<Session, String>, Failure> {
    let body = match code { Some(c) => serde_json::json!({ "code": c, "name": name }), None => serde_json::json!({ "name": name }) };
    let (status, text) = server.request("POST", if code.is_some() { "/api/pair/claim" } else { "/api/pair/dev" }, Some(&body.to_string()), None)?;
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let me = serde_json::from_value::<Me>(v["session"]["me"].clone());
    Ok(match (status, v["device"].as_str(), v["session"]["token"].as_str(), me) {
        (200, Some(device), Some(token), Ok(me)) => Ok(Session { server: server.base.clone(), token: token.into(), device: Some(device.into()), me }),
        _ => Err(v["error"].as_str().map(String::from).unwrap_or_else(|| format!("status-{status}"))),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fingerprint_is_upper_case_hex_pairs_with_colons() {
        let out = fingerprint(b"abc");

        assert!(out.starts_with("BA:78:16:BF:"), "{out}");
        assert_eq!(out.len(), 32 * 3 - 1);
    }

    #[test]
    fn an_address_without_a_scheme_is_https() {
        let server = Server::new("192.168.1.59:47843/").ok().unwrap();

        assert_eq!(server.base, "https://192.168.1.59:47843");
    }

    #[test]
    fn an_address_with_http_keeps_it() {
        let server = Server::new("http://localhost:47800").ok().unwrap();

        assert_eq!(server.base, "http://localhost:47800");
    }
}
