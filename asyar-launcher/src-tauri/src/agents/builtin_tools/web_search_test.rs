use super::web_search::{
    clean_html, clean_url, parse_search_response, parse_web_search_args, WebSearchTool,
};
use crate::agents::tools::BuiltinTool;
use crate::error::AppError;
use serde_json::json;

#[test]
fn test_descriptor_schema() {
    let tool = WebSearchTool::new();
    let desc = tool.descriptor();
    assert_eq!(desc.id, "web-search");
    assert_eq!(desc.fully_qualified_id, "builtin:web-search");
    assert_eq!(desc.name, "Web Search");
    assert!(desc.description.contains("Search the live internet"));
    assert_eq!(desc.parameters["type"], "object");
    assert_eq!(desc.parameters["required"][0], "query");
}

#[test]
fn test_parse_web_search_args() {
    // Valid with limit
    let (q, l, cfg) = parse_web_search_args(json!({ "query": "rust lang", "limit": 10 })).unwrap();
    assert_eq!(q, "rust lang");
    assert_eq!(l, 10);
    assert!(cfg.is_none());

    // Valid with default limit
    let (q2, l2, cfg2) = parse_web_search_args(json!({ "query": "  tauri v2  " })).unwrap();
    assert_eq!(q2, "tauri v2");
    assert_eq!(l2, 5);
    assert!(cfg2.is_none());

    // Valid with __config
    let (q3, l3, cfg3) = parse_web_search_args(json!({
        "query": "spacex",
        "limit": 3,
        "__config": {
            "engine": "brave",
            "apiKey": "test-key-123"
        }
    }))
    .unwrap();
    assert_eq!(q3, "spacex");
    assert_eq!(l3, 3);
    let config = cfg3.unwrap();
    assert_eq!(config.engine.as_deref(), Some("brave"));
    assert_eq!(config.api_key.as_deref(), Some("test-key-123"));

    // Missing query
    assert!(matches!(
        parse_web_search_args(json!({})),
        Err(AppError::Validation(_))
    ));

    // Empty query
    assert!(matches!(
        parse_web_search_args(json!({ "query": "   " })),
        Err(AppError::Validation(_))
    ));

    // Invalid limit type
    assert!(matches!(
        parse_web_search_args(json!({ "query": "valid", "limit": "five" })),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn test_clean_url() {
    // Normal URL
    assert_eq!(
        clean_url("https://www.rust-lang.org/"),
        Some("https://www.rust-lang.org/".to_string())
    );

    // Protocol-relative URL
    assert_eq!(
        clean_url("//example.com/docs"),
        Some("https://example.com/docs".to_string())
    );

    // DuckDuckGo redirect unwrapping
    let ddg_redirect = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fcrates.io%2Fcrates%2Fserde&rut=123";
    assert_eq!(
        clean_url(ddg_redirect),
        Some("https://crates.io/crates/serde".to_string())
    );

    // Invalid / unsafe URLs
    assert_eq!(clean_url("javascript:alert(1)"), None);
    assert_eq!(clean_url(""), None);
    assert_eq!(clean_url("not a url"), None);
}

#[test]
fn test_clean_html() {
    let raw = "<b>Rust</b> is &quot;safe&quot; &amp; fast &#39;language&#39; &lt;v1.80&gt;&nbsp;released!";
    assert_eq!(
        clean_html(raw),
        "Rust is \"safe\" & fast 'language' <v1.80> released!"
    );
}

#[test]
fn test_parse_search_response_ddg_html() {
    let html = r#"
    <div class="results">
        <div class="result results_links">
            <h2 class="result__title">
                <a class="result__a result__title" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2F&rut=abc"><b>Rust</b> Programming Language</a>
            </h2>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2F">A language empowering everyone to build reliable and efficient software.</a>
        </div>
        <div class="result results_links">
            <h2 class="result__title">
                <a class="result__a result__title" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcrates.io%2F&rut=def">Crates.io: Rust Package Registry</a>
            </h2>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcrates.io%2F">The Rust community&#39;s crate registry.</a>
        </div>
    </div>
    "#;

    let (sources, results) = parse_search_response(html, 5);
    assert_eq!(sources.len(), 2);
    assert_eq!(results.len(), 2);

    assert_eq!(sources[0].title, "Rust Programming Language");
    assert_eq!(sources[0].url, "https://www.rust-lang.org/");
    assert_eq!(
        results[0].snippet,
        "A language empowering everyone to build reliable and efficient software."
    );

    assert_eq!(sources[1].title, "Crates.io: Rust Package Registry");
    assert_eq!(sources[1].url, "https://crates.io/");
    assert_eq!(results[1].snippet, "The Rust community's crate registry.");
}

#[test]
fn test_parse_search_response_ddg_lite() {
    let html = r#"
    <table border="0">
        <tr>
            <td>1.&nbsp;</td>
            <td>
                <a rel="nofollow" class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdoc.rust-lang.org%2Fbook%2F">The Rust Book</a>
            </td>
        </tr>
        <tr>
            <td>&nbsp;</td>
            <td class="result-snippet">The official book on Rust programming.</td>
        </tr>
    </table>
    "#;

    let (sources, results) = parse_search_response(html, 5);
    assert_eq!(sources.len(), 1);
    assert_eq!(results.len(), 1);
    assert_eq!(sources[0].title, "The Rust Book");
    assert_eq!(sources[0].url, "https://doc.rust-lang.org/book/");
    assert_eq!(results[0].snippet, "The official book on Rust programming.");
}

#[test]
fn test_parse_search_response_json_searxng_or_tavily() {
    let json_body = json!({
        "results": [
            {
                "title": "Tauri v2 Documentation",
                "url": "https://v2.tauri.app",
                "content": "Build fast, lightweight apps for desktop and mobile."
            }
        ]
    })
    .to_string();

    let (sources, results) = parse_search_response(&json_body, 5);
    assert_eq!(sources.len(), 1);
    assert_eq!(results.len(), 1);
    assert_eq!(sources[0].title, "Tauri v2 Documentation");
    assert_eq!(sources[0].url, "https://v2.tauri.app/");
    assert_eq!(
        results[0].snippet,
        "Build fast, lightweight apps for desktop and mobile."
    );
}

#[test]
fn test_parse_search_response_json_brave() {
    let json_body = json!({
        "web": {
            "results": [
                {
                    "title": "Anthropic Claude",
                    "url": "https://www.anthropic.com",
                    "description": "AI research and products that put safety first."
                }
            ]
        }
    })
    .to_string();

    let (sources, results) = parse_search_response(&json_body, 5);
    assert_eq!(sources.len(), 1);
    assert_eq!(results.len(), 1);
    assert_eq!(sources[0].title, "Anthropic Claude");
    assert_eq!(sources[0].url, "https://www.anthropic.com/");
    assert_eq!(
        results[0].snippet,
        "AI research and products that put safety first."
    );
}

#[tokio::test]
async fn test_web_search_tool_invoke_with_mock_server() {
    let mut server = mockito::Server::new_async().await;
    let mock_html = r#"
    <div class="result">
        <a class="result__title" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.ycombinator.com%2F">Hacker News</a>
        <a class="result__snippet">Social news website focusing on computer science.</a>
    </div>
    "#;

    let _m = server
        .mock("POST", "/")
        .match_body(mockito::Matcher::UrlEncoded(
            "q".to_string(),
            "hacker news".to_string(),
        ))
        .with_status(200)
        .with_body(mock_html)
        .create_async()
        .await;

    let tool = WebSearchTool::with_base_url(server.url());
    let output = tool
        .invoke(json!({ "query": "hacker news", "limit": 3 }))
        .await
        .unwrap();

    let sources = output["sources"].as_array().unwrap();
    let results = output["results"].as_array().unwrap();

    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0]["title"], "Hacker News");
    assert_eq!(sources[0]["url"], "https://news.ycombinator.com/");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["title"], "Hacker News");
    assert_eq!(
        results[0]["snippet"],
        "Social news website focusing on computer science."
    );
}

#[tokio::test]
async fn test_web_search_tool_invoke_server_error() {
    let mut server = mockito::Server::new_async().await;
    let _m = server
        .mock("POST", "/")
        .with_status(500)
        .create_async()
        .await;

    let tool = WebSearchTool::with_base_url(server.url());
    let result = tool.invoke(json!({ "query": "fail query" })).await;
    assert!(result.is_err());
}

#[test]
fn test_parse_wikipedia_json() {
    let mock_json = r#"{
        "query": {
            "search": [
                {
                    "title": "SpaceX Starship",
                    "snippet": "Starship is a <span class=\"searchmatch\">reusable</span> launch vehicle."
                },
                {
                    "title": "Rust (programming language)",
                    "snippet": "Rust is a <span class=\"searchmatch\">multi-paradigm</span> language."
                }
            ]
        }
    }"#;

    let (sources, results) = parse_search_response(mock_json, 2);
    assert_eq!(sources.len(), 2);
    assert_eq!(sources[0].title, "SpaceX Starship");
    assert_eq!(
        sources[0].url,
        "https://en.wikipedia.org/wiki/SpaceX_Starship"
    );
    assert_eq!(results[0].snippet, "Starship is a reusable launch vehicle.");

    assert_eq!(sources[1].title, "Rust (programming language)");
    assert_eq!(
        sources[1].url,
        "https://en.wikipedia.org/wiki/Rust_(programming_language)"
    );
}

#[test]
fn test_parse_ddg_abstract_json() {
    let mock_json = r#"{
        "Heading": "SpaceX",
        "AbstractText": "SpaceX is an American spacecraft manufacturer.",
        "AbstractURL": "https://en.wikipedia.org/wiki/SpaceX"
    }"#;

    let (sources, results) = parse_search_response(mock_json, 5);
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].title, "SpaceX");
    assert_eq!(sources[0].url, "https://en.wikipedia.org/wiki/SpaceX");
    assert_eq!(
        results[0].snippet,
        "SpaceX is an American spacecraft manufacturer."
    );
}

#[tokio::test]
async fn test_web_search_with_searxng_config() {
    let mut server = mockito::Server::new_async().await;
    let mock_json = r#"{
        "results": [
            {
                "title": "SearXNG Result",
                "url": "https://example.com/searxng",
                "content": "Privacy metasearch content."
            }
        ]
    }"#;

    let _m = server
        .mock("GET", "/search?q=test+query&format=json")
        .with_status(200)
        .with_body(mock_json)
        .create_async()
        .await;

    let tool = WebSearchTool::new();
    let output = tool
        .invoke(json!({
            "query": "test query",
            "limit": 5,
            "__config": {
                "engine": "searxng",
                "baseUrl": server.url()
            }
        }))
        .await
        .unwrap();

    let sources = output["sources"].as_array().unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0]["title"], "SearXNG Result");
    assert_eq!(sources[0]["url"], "https://example.com/searxng");
}
