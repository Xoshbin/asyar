use asyar_lib::browser::paths;
use asyar_lib::browser::service::{BrowserService, ListBookmarksFilter, SearchHistoryOptions};

fn write(path: &std::path::Path, contents: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
}

const CHROME_BOOKMARKS: &str = r#"{
    "roots": {
        "bookmark_bar": {
            "children": [
                {"date_added":"13350000000000000","id":"1","name":"Hello","type":"url","url":"https://example.com"}
            ],
            "date_added":"0","id":"0","name":"Bookmarks Bar","type":"folder"
        },
        "other":{"children":[],"date_added":"0","id":"2","name":"Other","type":"folder"}
    },
    "version":1
}"#;

#[test]
fn end_to_end_chromium_bookmarks_round_trip() {
    let home = tempfile::tempdir().unwrap();
    let bookmarks_path = paths::chromium_user_data_root(home.path(), "chrome")
        .join("Default")
        .join("Bookmarks");
    write(&bookmarks_path, CHROME_BOOKMARKS);

    let svc = BrowserService::with_home(home.path().to_path_buf());
    let browsers = svc.list_available_browsers();
    assert!(browsers.iter().any(|b| b.variant == "chrome"));

    let bookmarks = svc
        .list_bookmarks(ListBookmarksFilter {
            browser: None,
            query: None,
        })
        .unwrap();
    assert_eq!(bookmarks.len(), 1);
    assert_eq!(bookmarks[0].title, "Hello");
    assert_eq!(bookmarks[0].url, "https://example.com");

    let filtered = svc
        .list_bookmarks(ListBookmarksFilter {
            browser: None,
            query: Some("hello".to_string()),
        })
        .unwrap();
    assert_eq!(filtered.len(), 1);
}

#[test]
fn end_to_end_empty_home_returns_empty() {
    let home = tempfile::tempdir().unwrap();
    let svc = BrowserService::with_home(home.path().to_path_buf());
    assert!(svc.list_available_browsers().is_empty());
    assert!(svc
        .list_bookmarks(ListBookmarksFilter {
            browser: None,
            query: None
        })
        .unwrap()
        .is_empty());
    assert!(svc
        .search_history(
            "anything",
            SearchHistoryOptions {
                limit: None,
                since_ms: None
            }
        )
        .unwrap()
        .is_empty());
}
