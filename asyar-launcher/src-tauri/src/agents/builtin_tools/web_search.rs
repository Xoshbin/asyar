use crate::agents::runner::WebSearchConfig;
use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use crate::storage::DataStore;
use percent_encoding::percent_decode_str;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;
use url::Url;

const DEFAULT_LIMIT: usize = 5;
const MAX_LIMIT: usize = 20;
const REQUEST_TIMEOUT_SECS: u64 = 10;
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SERPLY_SEARCH_URL: &str = "https://api.serply.io/v1/search";
// Serply returns a single results page of at most 10 rows per request.
const SERPLY_MAX_NUM: usize = 10;
// Sent on authenticated API provider requests so providers can identify the client application.
pub const ASYAR_API_USER_AGENT: &str = concat!(
    "asyar/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/Xoshbin/asyar)"
);

static HTML_TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static DDG_HTML_RESULT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<a[^>]*class="[^"]*result__title[^"]*"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>.*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(?P<snippet>.*?)</a>"#).unwrap()
});
static DDG_LITE_RESULT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)<a[^>]*class="result-link"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>.*?<td[^>]*class="result-snippet"[^>]*>(?P<snippet>.*?)</td>"#).unwrap()
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroundingSource {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchResultEntry {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Clone)]
pub enum WebSearchCredentialSource {
    Store {
        data_store: DataStore,
        master_key: [u8; 32],
    },
    None,
}

#[derive(Clone)]
pub struct WebSearchTool {
    client: reqwest::Client,
    base_url: Option<String>,
    credentials: WebSearchCredentialSource,
}

impl WebSearchTool {
    pub fn with_store(data_store: DataStore, master_key: [u8; 32]) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            base_url: None,
            credentials: WebSearchCredentialSource::Store {
                data_store,
                master_key,
            },
        }
    }

    pub fn with_store_and_base_url(
        data_store: DataStore,
        master_key: [u8; 32],
        base_url: String,
    ) -> Self {
        let mut tool = Self::with_store(data_store, master_key);
        tool.base_url = Some(base_url);
        tool
    }

    pub fn without_credentials() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            base_url: None,
            credentials: WebSearchCredentialSource::None,
        }
    }

    pub fn without_credentials_and_base_url(base_url: String) -> Self {
        let mut tool = Self::without_credentials();
        tool.base_url = Some(base_url);
        tool
    }

    fn resolve_key(
        &self,
        engine: &str,
        env_var: &str,
    ) -> Result<zeroize::Zeroizing<String>, AppError> {
        match &self.credentials {
            WebSearchCredentialSource::Store {
                data_store,
                master_key,
            } => {
                let conn = data_store.conn()?;
                let stored_key = match crate::storage::ai_credentials::get(
                    &conn,
                    &crate::storage::ai_credentials::web_search_credential_id(engine),
                    master_key,
                ) {
                    Ok(Some(k)) => Some(k),
                    Ok(None) => None,
                    Err(asyar_storage::StorageError::Encryption(_)) => {
                        return Err(AppError::Validation(
                            "Web search API key cannot be decrypted (keychain master key changed). Please re-enter your key in Settings → AI.".into(),
                        ));
                    }
                    Err(e) => return Err(e.into()),
                };
                if let Some(k) = stored_key {
                    return Ok(k);
                }
                if let Ok(env_val) = std::env::var(env_var) {
                    let trimmed = env_val.trim();
                    if !trimmed.is_empty() {
                        return Ok(zeroize::Zeroizing::new(trimmed.to_string()));
                    }
                }
                let display_name = match engine {
                    "brave" => "Brave Search",
                    "tavily" => "Tavily Search",
                    "serply" => "Serply",
                    other => other,
                };
                Err(AppError::Validation(format!(
                    "{display_name} API key is required. Add it in Settings > AI or set {env_var}."
                )))
            }
            WebSearchCredentialSource::None => {
                if let Ok(env_val) = std::env::var(env_var) {
                    let trimmed = env_val.trim();
                    if !trimmed.is_empty() {
                        return Ok(zeroize::Zeroizing::new(trimmed.to_string()));
                    }
                }
                Err(AppError::Validation(
                    "This search engine's API key is only available to Asyar's built-in AI chat, not to CLI providers".into(),
                ))
            }
        }
    }

    #[allow(dead_code)]
    pub(crate) async fn execute_search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Value, AppError> {
        self.execute_search_with_config(query, limit, None).await
    }

    pub(crate) async fn execute_search_with_config(
        &self,
        query: &str,
        limit: usize,
        config: Option<&WebSearchConfig>,
    ) -> Result<Value, AppError> {
        let limit = limit.clamp(1, MAX_LIMIT);

        let engine = config
            .and_then(|c| c.engine.as_deref())
            .unwrap_or("duckduckgo");

        let base_url = config
            .and_then(|c| c.base_url.as_deref())
            .filter(|u| !u.trim().is_empty())
            .map(|s| s.to_string())
            .or_else(|| self.base_url.clone());

        match engine {
            "brave" => {
                let key = self.resolve_key("brave", "BRAVE_API_KEY")?;
                self.search_brave(query, limit, &key).await
            }
            "tavily" => {
                let key = self.resolve_key("tavily", "TAVILY_API_KEY")?;
                self.search_tavily(query, limit, &key).await
            }
            "serply" => {
                let key = self.resolve_key("serply", "SERPLY_API_KEY")?;
                self.search_serply(query, limit, &key).await
            }
            "searxng" => {
                let endpoint = base_url.ok_or_else(|| {
                    AppError::Validation(
                        "SearXNG base URL is required. Add it in Settings > AI.".into(),
                    )
                })?;
                self.search_searxng(query, limit, &endpoint).await
            }
            _ => {
                // duckduckgo (default zero-config)
                if config.is_none() {
                    if let Ok(brave_key) = std::env::var("BRAVE_API_KEY") {
                        if !brave_key.trim().is_empty() && self.base_url.is_none() {
                            return self.search_brave(query, limit, &brave_key).await;
                        }
                    }
                    if let Ok(tavily_key) = std::env::var("TAVILY_API_KEY") {
                        if !tavily_key.trim().is_empty() && self.base_url.is_none() {
                            return self.search_tavily(query, limit, &tavily_key).await;
                        }
                    }
                    if let Ok(serply_key) = std::env::var("SERPLY_API_KEY") {
                        if !serply_key.trim().is_empty() && self.base_url.is_none() {
                            return self.search_serply(query, limit, &serply_key).await;
                        }
                    }
                }
                self.search_duckduckgo_resilient(query, limit, base_url.as_deref())
                    .await
            }
        }
    }

    async fn search_duckduckgo_resilient(
        &self,
        query: &str,
        limit: usize,
        base_url: Option<&str>,
    ) -> Result<Value, AppError> {
        let is_custom_endpoint = base_url.is_some();
        let endpoint = base_url
            .map(|s| s.to_string())
            .unwrap_or_else(|| "https://html.duckduckgo.com/html/".to_string());

        let mut sources = Vec::new();
        let mut results = Vec::new();

        // 1. Try DuckDuckGo HTML scraper first
        let response = self
            .client
            .post(&endpoint)
            .form(&[("q", query)])
            .send()
            .await;
        match response {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.text().await {
                    if !body.contains("anomaly-modal") && !body.contains("anomalyDetectionBlock") {
                        let (s, r) = parse_search_response(&body, limit);
                        sources = s;
                        results = r;
                    }
                }
            }
            Ok(resp) if is_custom_endpoint => {
                return Err(AppError::Other(format!(
                    "web search provider returned HTTP {}",
                    resp.status()
                )));
            }
            Err(e) if is_custom_endpoint => {
                return Err(AppError::Network(e));
            }
            _ => {}
        }

        if !sources.is_empty() {
            return Ok(json!({
                "sources": sources,
                "results": results,
            }));
        }

        // 2. Zero-config Fallback A: DuckDuckGo Instant Answer API
        if let Ok(resp) = self
            .client
            .get("https://api.duckduckgo.com/")
            .query(&[("q", query), ("format", "json"), ("no_html", "1")])
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(body) = resp.text().await {
                    let (ddg_s, ddg_r) = parse_search_response(&body, limit);
                    sources.extend(ddg_s);
                    results.extend(ddg_r);
                }
            }
        }

        // 3. Zero-config Fallback B: Wikipedia Search API
        if sources.len() < limit {
            let needed = limit.saturating_sub(sources.len());
            if let Ok(resp) = self
                .client
                .get("https://en.wikipedia.org/w/api.php")
                .query(&[
                    ("action", "query"),
                    ("list", "search"),
                    ("srsearch", query),
                    ("utf8", "1"),
                    ("format", "json"),
                    ("srlimit", &needed.to_string()),
                ])
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(body) = resp.text().await {
                        let (wiki_s, wiki_r) = parse_search_response(&body, needed);
                        for s in wiki_s {
                            if !sources
                                .iter()
                                .any(|existing: &GroundingSource| existing.url == s.url)
                            {
                                sources.push(s);
                            }
                        }
                        for r in wiki_r {
                            if !results
                                .iter()
                                .any(|existing: &SearchResultEntry| existing.url == r.url)
                            {
                                results.push(r);
                            }
                        }
                    }
                }
            }
        }

        sources.truncate(limit);
        results.truncate(limit);

        Ok(json!({
            "sources": sources,
            "results": results,
        }))
    }

    async fn search_searxng(
        &self,
        query: &str,
        limit: usize,
        base_url: &str,
    ) -> Result<Value, AppError> {
        let url = format!("{}/search", base_url.trim_end_matches('/'));
        let response = self
            .client
            .get(&url)
            .query(&[("q", query), ("format", "json")])
            .send()
            .await
            .map_err(AppError::Network)?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "SearXNG search returned HTTP {}",
                response.status()
            )));
        }

        let body = response.text().await.map_err(AppError::Network)?;
        let (sources, results) = parse_search_response(&body, limit);
        Ok(json!({
            "sources": sources,
            "results": results,
        }))
    }

    async fn search_brave(
        &self,
        query: &str,
        limit: usize,
        api_key: &str,
    ) -> Result<Value, AppError> {
        let url = self
            .base_url
            .as_deref()
            .unwrap_or("https://api.search.brave.com/res/v1/web/search");
        let response = self
            .client
            .get(url)
            .query(&[("q", query), ("count", &limit.to_string())])
            .header("X-Subscription-Token", api_key)
            .header(reqwest::header::USER_AGENT, ASYAR_API_USER_AGENT)
            .send()
            .await
            .map_err(AppError::Network)?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "Brave search returned HTTP {}",
                response.status()
            )));
        }

        let body = response.text().await.map_err(AppError::Network)?;
        let (sources, results) = parse_search_response(&body, limit);
        Ok(json!({
            "sources": sources,
            "results": results,
        }))
    }

    async fn search_tavily(
        &self,
        query: &str,
        limit: usize,
        api_key: &str,
    ) -> Result<Value, AppError> {
        let payload = json!({
            "api_key": api_key,
            "query": query,
            "max_results": limit,
        });

        let response = self
            .client
            .post("https://api.tavily.com/search")
            .header(reqwest::header::USER_AGENT, ASYAR_API_USER_AGENT)
            .json(&payload)
            .send()
            .await
            .map_err(AppError::Network)?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "Tavily search returned HTTP {}",
                response.status()
            )));
        }

        let body = response.text().await.map_err(AppError::Network)?;
        let (sources, results) = parse_search_response(&body, limit);
        Ok(json!({
            "sources": sources,
            "results": results,
        }))
    }

    pub(crate) fn serply_request(
        &self,
        query: &str,
        limit: usize,
        api_key: &str,
    ) -> reqwest::RequestBuilder {
        let num = limit.min(SERPLY_MAX_NUM).to_string();
        self.client
            .get(SERPLY_SEARCH_URL)
            .query(&[("q", query), ("num", num.as_str())])
            .header("X-Api-Key", api_key)
            .header(reqwest::header::USER_AGENT, ASYAR_API_USER_AGENT)
    }

    async fn search_serply(
        &self,
        query: &str,
        limit: usize,
        api_key: &str,
    ) -> Result<Value, AppError> {
        let response = self
            .serply_request(query, limit, api_key)
            .send()
            .await
            .map_err(AppError::Network)?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "Serply search returned HTTP {}",
                response.status()
            )));
        }

        let body = response.text().await.map_err(AppError::Network)?;
        let (sources, results) = parse_search_response(&body, limit);
        Ok(json!({
            "sources": sources,
            "results": results,
        }))
    }
}

pub(crate) fn parse_web_search_args(args: Value) -> Result<(String, usize), AppError> {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation("missing or empty required 'query' string argument".into())
        })?
        .to_string();

    let limit = match args.get("limit") {
        None | Some(Value::Null) => DEFAULT_LIMIT,
        Some(Value::Number(n)) => n.as_u64().unwrap_or(DEFAULT_LIMIT as u64) as usize,
        _ => return Err(AppError::Validation("'limit' must be a number".into())),
    };

    Ok((query, limit))
}

pub(crate) fn clean_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Unwrap DuckDuckGo redirect URLs: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
    let candidate = if let Some(idx) = trimmed.find("uddg=") {
        let after = &trimmed[idx + 5..];
        let end = after.find('&').unwrap_or(after.len());
        let encoded = &after[..end];
        percent_decode_str(encoded).decode_utf8_lossy().to_string()
    } else if trimmed.starts_with("//") {
        format!("https:{}", trimmed)
    } else {
        trimmed.to_string()
    };

    let parsed = Url::parse(&candidate).ok()?;
    if matches!(parsed.scheme(), "http" | "https") && parsed.has_host() {
        Some(parsed.to_string())
    } else {
        None
    }
}

pub(crate) fn clean_html(raw: &str) -> String {
    let stripped = HTML_TAG_RE.replace_all(raw, "");
    stripped
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn parse_search_response(
    body: &str,
    limit: usize,
) -> (Vec<GroundingSource>, Vec<SearchResultEntry>) {
    let mut sources = Vec::new();
    let mut results = Vec::new();

    // Try parsing as JSON first (SearXNG, Brave, Tavily, DDG Instant Answer, Wikipedia).
    if let Ok(val) = serde_json::from_str::<Value>(body) {
        if let Some(entries) = val.pointer("/web/results").and_then(Value::as_array) {
            // Brave format
            for item in entries.iter().take(limit) {
                let title = clean_html(
                    item.get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                let url_raw = item.get("url").and_then(Value::as_str).unwrap_or_default();
                let snippet = clean_html(
                    item.get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                if let Some(valid_url) = clean_url(url_raw) {
                    if !title.is_empty() {
                        sources.push(GroundingSource {
                            title: title.clone(),
                            url: valid_url.clone(),
                        });
                        results.push(SearchResultEntry {
                            title,
                            url: valid_url,
                            snippet,
                        });
                    }
                }
            }
            if !results.is_empty() {
                return (sources, results);
            }
        }

        if let Some(entries) = val.get("results").and_then(Value::as_array) {
            // SearXNG / Tavily / Serply format (Serply uses `link` and `description`)
            for item in entries.iter().take(limit) {
                let title = clean_html(
                    item.get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                let url_raw = item
                    .get("url")
                    .or_else(|| item.get("link"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let snippet = clean_html(
                    item.get("content")
                        .or_else(|| item.get("snippet"))
                        .or_else(|| item.get("description"))
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                if let Some(valid_url) = clean_url(url_raw) {
                    if !title.is_empty() {
                        sources.push(GroundingSource {
                            title: title.clone(),
                            url: valid_url.clone(),
                        });
                        results.push(SearchResultEntry {
                            title,
                            url: valid_url,
                            snippet,
                        });
                    }
                }
            }
            if !results.is_empty() {
                return (sources, results);
            }
        }

        // DDG Instant Answer Abstract
        if let (Some(abstract_text), Some(abstract_url)) = (
            val.get("AbstractText").and_then(Value::as_str),
            val.get("AbstractURL").and_then(Value::as_str),
        ) {
            let clean_text = clean_html(abstract_text);
            if !clean_text.is_empty() {
                if let Some(valid_url) = clean_url(abstract_url) {
                    let heading = val
                        .get("Heading")
                        .and_then(Value::as_str)
                        .map(clean_html)
                        .unwrap_or_default();
                    let title = if heading.is_empty() {
                        valid_url.clone()
                    } else {
                        heading
                    };
                    sources.push(GroundingSource {
                        title: title.clone(),
                        url: valid_url.clone(),
                    });
                    results.push(SearchResultEntry {
                        title,
                        url: valid_url,
                        snippet: clean_text,
                    });
                }
            }
        }

        if let Some(topics) = val.get("RelatedTopics").and_then(Value::as_array) {
            // DDG Instant Answer related topics
            for topic in topics.iter().take(limit.saturating_sub(results.len())) {
                let text = clean_html(
                    topic
                        .get("Text")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                let url_raw = topic
                    .get("FirstURL")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if let Some(valid_url) = clean_url(url_raw) {
                    if !text.is_empty() {
                        let title = text.split(" - ").next().unwrap_or(&text).trim().to_string();
                        sources.push(GroundingSource {
                            title: title.clone(),
                            url: valid_url.clone(),
                        });
                        results.push(SearchResultEntry {
                            title,
                            url: valid_url,
                            snippet: text,
                        });
                    }
                }
            }
            if !results.is_empty() {
                return (sources, results);
            }
        }

        // Wikipedia query search
        if let Some(search_items) = val.pointer("/query/search").and_then(Value::as_array) {
            for item in search_items.iter().take(limit) {
                let title = clean_html(
                    item.get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                let snippet = clean_html(
                    item.get("snippet")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                if !title.is_empty() {
                    let encoded = title.replace(' ', "_");
                    let url = format!("https://en.wikipedia.org/wiki/{encoded}");
                    sources.push(GroundingSource {
                        title: title.clone(),
                        url: url.clone(),
                    });
                    results.push(SearchResultEntry {
                        title,
                        url,
                        snippet,
                    });
                }
            }
            if !results.is_empty() {
                return (sources, results);
            }
        }
    }

    // HTML parsing: DuckDuckGo HTML format
    for cap in DDG_HTML_RESULT_RE.captures_iter(body).take(limit) {
        let href = cap.name("href").map(|m| m.as_str()).unwrap_or_default();
        let title_raw = cap.name("title").map(|m| m.as_str()).unwrap_or_default();
        let snippet_raw = cap.name("snippet").map(|m| m.as_str()).unwrap_or_default();

        let title = clean_html(title_raw);
        let snippet = clean_html(snippet_raw);
        if let Some(valid_url) = clean_url(href) {
            if !title.is_empty() {
                sources.push(GroundingSource {
                    title: title.clone(),
                    url: valid_url.clone(),
                });
                results.push(SearchResultEntry {
                    title,
                    url: valid_url,
                    snippet,
                });
            }
        }
    }

    // HTML parsing: DuckDuckGo Lite format fallback
    if results.is_empty() {
        for cap in DDG_LITE_RESULT_RE.captures_iter(body).take(limit) {
            let href = cap.name("href").map(|m| m.as_str()).unwrap_or_default();
            let title_raw = cap.name("title").map(|m| m.as_str()).unwrap_or_default();
            let snippet_raw = cap.name("snippet").map(|m| m.as_str()).unwrap_or_default();

            let title = clean_html(title_raw);
            let snippet = clean_html(snippet_raw);
            if let Some(valid_url) = clean_url(href) {
                if !title.is_empty() {
                    sources.push(GroundingSource {
                        title: title.clone(),
                        url: valid_url.clone(),
                    });
                    results.push(SearchResultEntry {
                        title,
                        url: valid_url,
                        snippet,
                    });
                }
            }
        }
    }

    (sources, results)
}

#[async_trait::async_trait]
impl BuiltinTool for WebSearchTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "web-search".to_string(),
            name: "Web Search".to_string(),
            description: "Search the live internet for recent news, facts, and documentation."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query or keywords"
                    },
                    "limit": {
                        "type": "number",
                        "description": "Maximum number of results to return (default: 5)"
                    }
                },
                "required": ["query"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:web-search".to_string(),
        }
    }

    async fn invoke(&self, args: Value) -> Result<Value, AppError> {
        let (query, limit) = parse_web_search_args(args)?;
        self.execute_search_with_config(&query, limit, None).await
    }

    async fn invoke_with_context(
        &self,
        args: Value,
        context: &crate::agents::tools::ToolContext,
    ) -> Result<Value, AppError> {
        let (query, limit) = parse_web_search_args(args)?;
        self.execute_search_with_config(&query, limit, context.web_search.as_ref())
            .await
    }
}
