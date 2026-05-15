/// Tests: Item 7 — manifest-level `tools` field parsing.
///
/// These tests drive the addition of `tools: Option<Vec<ManifestTool>>` to
/// `ExtensionManifest`. They fail RED until the field is added and wired into
/// `discovery::read_manifest`.
#[cfg(test)]
mod manifest_tools_tests {
    use crate::agents::tools::ManifestTool;
    use crate::extensions::ExtensionManifest;

    /// Parse a manifest JSON string through serde directly (no validate_manifest
    /// cross-field rules, only struct deserialization). We bypass
    /// read_manifest so we can control the full JSON without writing a file.
    fn parse_manifest(json: &str) -> Result<ExtensionManifest, serde_json::Error> {
        serde_json::from_str(json)
    }

    // ── 1. manifest_with_tools_array_is_parsed ───────────────────────────────

    #[test]
    fn manifest_with_tools_array_is_parsed() {
        let json = r#"{
            "id": "org.test.tools-ext",
            "name": "Tools Ext",
            "version": "1.0.0",
            "commands": [],
            "tools": [
                {
                    "id": "echo",
                    "name": "Echo",
                    "description": "Echoes args",
                    "parameters": { "type": "object", "properties": {} }
                }
            ]
        }"#;

        let m = parse_manifest(json)
            .expect("manifest with tools array must parse");

        let tools = m.tools.as_ref().expect("tools field must be Some");
        assert_eq!(tools.len(), 1, "expected exactly 1 tool, got {}", tools.len());
        assert_eq!(tools[0].id, "echo", "tool id must be 'echo'");
        assert_eq!(tools[0].name, "Echo", "tool name must be 'Echo'");
    }

    // ── 2. manifest_without_tools_field_is_none ─────────────────────────────

    #[test]
    fn manifest_without_tools_field_is_none() {
        let json = r#"{
            "id": "org.test.no-tools",
            "name": "No Tools",
            "version": "1.0.0",
            "commands": []
        }"#;

        let m = parse_manifest(json)
            .expect("manifest without tools field must still parse");

        assert!(m.tools.is_none(), "tools field must be None when absent from manifest");
    }

    // ── 3. manifest_tools_multiple_entries_parsed ────────────────────────────

    #[test]
    fn manifest_tools_multiple_entries_parsed() {
        let json = r#"{
            "id": "org.test.multi-tools",
            "name": "Multi Tools",
            "version": "1.0.0",
            "commands": [],
            "tools": [
                {
                    "id": "search",
                    "name": "Search",
                    "description": "Performs a search",
                    "parameters": { "type": "object", "properties": { "query": { "type": "string" } } }
                },
                {
                    "id": "fetch",
                    "name": "Fetch",
                    "description": "Fetches a URL",
                    "parameters": { "type": "object", "properties": { "url": { "type": "string" } } }
                }
            ]
        }"#;

        let m = parse_manifest(json)
            .expect("manifest with multiple tools must parse");

        let tools = m.tools.as_ref().expect("tools field must be Some");
        assert_eq!(tools.len(), 2);

        let ids: Vec<&str> = tools.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"search"), "missing 'search' tool");
        assert!(ids.contains(&"fetch"), "missing 'fetch' tool");
    }

    // ── 4. manifest_tool_roundtrip_via_serde ────────────────────────────────
    // Confirms ManifestTool deserializes identically whether parsed from a
    // standalone JSON object or from the manifest's tools array. Pins the
    // camelCase wire format matches `serde(rename_all = "camelCase")`.

    #[test]
    fn manifest_tool_roundtrip_via_serde() {
        let json = r#"{
            "id": "my-tool",
            "name": "My Tool",
            "description": "Does things",
            "parameters": { "type": "object", "properties": { "count": { "type": "integer" } } }
        }"#;

        let tool: ManifestTool = serde_json::from_str(json)
            .expect("ManifestTool must deserialize from JSON");

        assert_eq!(tool.id, "my-tool");
        assert_eq!(tool.name, "My Tool");
        assert_eq!(tool.description, "Does things");
        assert!(tool.parameters.get("properties").is_some());
    }
}
