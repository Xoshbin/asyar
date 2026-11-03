//! The one response builder every custom URI scheme goes through.
//!
//! Scheme handlers return a [`SchemeResponse`], never a raw
//! `http::Response`. Only [`super::register`] turns it into one, through
//! [`SchemeResponse::into_http`], so every response from every scheme (success
//! or error) carries the same cache policy and CORS header. A handler can't
//! forget them, because it never sets headers itself.

/// Cache policy for every custom-scheme response. The bytes come from local
/// disk, so a cache saves nothing. `asyar-extension://` once sent no header,
/// and WebKit's disk cache grew to 55 GB.
pub(crate) const CACHE_CONTROL: &str = "no-store";

/// A custom-scheme response before the shared headers are applied.
#[derive(Debug)]
pub struct SchemeResponse {
    status: u16,
    content_type: Option<&'static str>,
    csp: Option<&'static str>,
    body: Vec<u8>,
}

impl SchemeResponse {
    pub fn ok(content_type: &'static str, body: Vec<u8>) -> Self {
        Self {
            status: 200,
            content_type: Some(content_type),
            csp: None,
            body,
        }
    }

    pub fn not_found() -> Self {
        Self::error(404)
    }

    pub fn forbidden() -> Self {
        Self::error(403)
    }

    fn error(status: u16) -> Self {
        Self {
            status,
            content_type: None,
            csp: None,
            body: Vec::new(),
        }
    }

    /// Sends a `Content-Security-Policy` header, for documents that run code.
    pub fn with_csp(mut self, csp: &'static str) -> Self {
        self.csp = Some(csp);
        self
    }

    pub(super) fn into_http(self) -> tauri::http::Response<Vec<u8>> {
        let mut builder = tauri::http::Response::builder()
            .status(self.status)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", CACHE_CONTROL);
        if let Some(content_type) = self.content_type {
            builder = builder.header("Content-Type", content_type);
        }
        if let Some(csp) = self.csp {
            builder = builder.header("Content-Security-Policy", csp);
        }
        builder
            .body(self.body)
            .expect("static status and header values are always valid")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header<'a>(res: &'a tauri::http::Response<Vec<u8>>, name: &str) -> Option<&'a str> {
        res.headers().get(name).and_then(|v| v.to_str().ok())
    }

    #[test]
    fn ok_response_carries_content_type_cache_policy_and_cors() {
        let res = SchemeResponse::ok("image/png", b"png".to_vec()).into_http();
        assert_eq!(res.status().as_u16(), 200);
        assert_eq!(res.body(), b"png");
        assert_eq!(header(&res, "Content-Type"), Some("image/png"));
        assert_eq!(header(&res, "Cache-Control"), Some(CACHE_CONTROL));
        assert_eq!(header(&res, "Access-Control-Allow-Origin"), Some("*"));
    }

    #[test]
    fn error_responses_carry_cache_policy_and_cors_without_content_type() {
        for (res, status) in [
            (SchemeResponse::not_found(), 404),
            (SchemeResponse::forbidden(), 403),
        ] {
            let res = res.into_http();
            assert_eq!(res.status().as_u16(), status);
            assert!(res.body().is_empty());
            assert_eq!(header(&res, "Content-Type"), None);
            assert_eq!(header(&res, "Cache-Control"), Some(CACHE_CONTROL));
            assert_eq!(header(&res, "Access-Control-Allow-Origin"), Some("*"));
        }
    }

    #[test]
    fn csp_is_only_sent_when_a_handler_asks_for_it() {
        let plain = SchemeResponse::ok("text/html", Vec::new()).into_http();
        assert_eq!(header(&plain, "Content-Security-Policy"), None);

        let with_csp = SchemeResponse::ok("text/html", Vec::new())
            .with_csp("default-src 'self'")
            .into_http();
        assert_eq!(
            header(&with_csp, "Content-Security-Policy"),
            Some("default-src 'self'")
        );
        assert_eq!(header(&with_csp, "Cache-Control"), Some(CACHE_CONTROL));
    }

    #[test]
    fn cache_policy_never_lets_webkit_write_to_disk() {
        assert!(CACHE_CONTROL.contains("no-store"));
    }
}
