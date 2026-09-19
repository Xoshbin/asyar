use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
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
pub struct WebSearchTool {
    client: reqwest::Client,
    base_url: Option<String>,
}

impl WebSearchTool {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            base_url: None,
        }
    }

    pub fn with_base_url(base_url: String) -> Self {
        let mut tool = Self::new();
        tool.base_url = Some(base_url);
        tool
    }

    pub(crate) async fn execute_search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Value, AppError> {
        let limit = limit.clamp(1, MAX_LIMIT);

        // 1. Check optional commercial search keys (Brave or Tavily) if configured.
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

        // 2. Default Zero-Config Public Search (DuckDuckGo / configured base_url).
        self.search_default(query, limit).await
    }

    async fn search_default(&self, query: &str, limit: usize) -> Result<Value, AppError> {
        let endpoint = self
            .base_url
            .clone()
            .unwrap_or_else(|| "https://html.duckduckgo.com/html/".to_string());

        let response = self
            .client
            .post(&endpoint)
            .form(&[("q", query)])
            .send()
            .await
            .map_err(AppError::Network)?;

        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "web search provider returned HTTP {}",
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
        let response = self
            .client
            .get("https://api.search.brave.com/res/v1/web/search")
            .query(&[("q", query), ("count", &limit.to_string())])
            .header("X-Subscription-Token", api_key)
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
}

impl Default for WebSearchTool {
    fn default() -> Self {
        Self::new()
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

    // Try parsing as JSON first (SearXNG, Brave, Tavily, DDG Instant Answer).
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
            // SearXNG / Tavily format
            for item in entries.iter().take(limit) {
                let title = clean_html(
                    item.get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                let url_raw = item.get("url").and_then(Value::as_str).unwrap_or_default();
                let snippet = clean_html(
                    item.get("content")
                        .or_else(|| item.get("snippet"))
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

        if let Some(topics) = val.get("RelatedTopics").and_then(Value::as_array) {
            // DDG Instant Answer format
            for topic in topics.iter().take(limit) {
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
        self.execute_search(&query, limit).await
    }
}
