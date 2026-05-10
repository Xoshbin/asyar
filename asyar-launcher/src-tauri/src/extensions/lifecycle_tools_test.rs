/// Tests: Item 7 — lifecycle integration for tool registry.
///
/// These tests drive the changes where `set_enabled` and `uninstall` accept
/// a `&ToolRegistry` argument and call `register_tier2` / `unregister_tier2`
/// based on the extension manifest's `tools` field.
///
/// RED: the lifecycle functions do not yet accept a `ToolRegistry` argument.
#[cfg(test)]
mod lifecycle_tools_tests {
    use std::sync::Arc;

    use crate::agents::tools::{ManifestTool, ToolRegistry, ToolSource};
    use crate::extensions::{
        BackgroundSpec, ExtensionManifest, ExtensionRecord, ExtensionRegistryState,
        CompatibilityStatus,
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn manifest_tool(id: &str) -> ManifestTool {
        ManifestTool {
            id: id.to_string(),
            name: format!("Tool {id}"),
            description: format!("Description for {id}"),
            parameters: serde_json::json!({}),
        }
    }

    fn make_manifest_with_tools(extension_id: &str, tools: Vec<ManifestTool>) -> ExtensionManifest {
        ExtensionManifest {
            id: extension_id.to_string(),
            name: "Test Ext".to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            author: None,
            extension_type: Some("extension".to_string()),
            background: Some(BackgroundSpec { main: "dist/worker.js".to_string() }),
            searchable: None,
            icon: None,
            commands: vec![],
            permissions: None,
            permission_args: None,
            min_app_version: None,
            asyar_sdk: None,
            platforms: None,
            preferences: None,
            actions: None,
            onboarding: None,
            tools: if tools.is_empty() { None } else { Some(tools) },
        }
    }

    fn registry_with_extension(
        extension_id: &str,
        manifest: ExtensionManifest,
        enabled: bool,
    ) -> ExtensionRegistryState {
        let state = ExtensionRegistryState::new();
        let record = ExtensionRecord {
            first_view_component: None,
            manifest,
            enabled,
            is_built_in: false,
            path: format!("/tmp/{}", extension_id),
            compatibility: CompatibilityStatus::Unknown,
        };
        state
            .extensions
            .lock()
            .unwrap()
            .insert(extension_id.to_string(), record);
        state
    }

    // ── 4. set_enabled_true_registers_extension_tools ────────────────────────

    #[test]
    fn set_enabled_true_registers_extension_tools() {
        let extension_id = "ext.tools-test";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("echo")]);
        let ext_registry = registry_with_extension(extension_id, manifest, false);
        let tool_registry = Arc::new(ToolRegistry::new());

        // Item 7 adds a ToolRegistry argument to set_enabled.
        // This call is RED until that argument is added.
        let app = tauri::test::mock_app();
        crate::extensions::lifecycle::set_enabled_with_tools(
            app.handle(),
            &ext_registry,
            extension_id,
            true,
            &tool_registry,
        )
        .expect("set_enabled must succeed");

        let list = tool_registry.list_all();
        let fqids: Vec<&str> = list.iter().map(|d| d.fully_qualified_id.as_str()).collect();

        assert!(
            fqids.contains(&"ext.tools-test:echo"),
            "tool must be registered after set_enabled(true); got {:?}",
            fqids
        );
        assert!(
            list.iter().any(|d| d.source == ToolSource::Tier2(extension_id.to_string())),
            "tool source must be Tier2(extension_id)"
        );
    }

    // ── 5. set_enabled_false_unregisters_extension_tools ─────────────────────

    #[test]
    fn set_enabled_false_unregisters_extension_tools() {
        let extension_id = "ext.disable-test";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("echo")]);
        let ext_registry = registry_with_extension(extension_id, manifest, true);
        let tool_registry = Arc::new(ToolRegistry::new());

        let app = tauri::test::mock_app();

        // Enable first to seed the registry.
        crate::extensions::lifecycle::set_enabled_with_tools(
            app.handle(),
            &ext_registry,
            extension_id,
            true,
            &tool_registry,
        )
        .expect("set_enabled(true) must succeed");

        assert!(
            !tool_registry.list_all().is_empty(),
            "tools must be registered after enable"
        );

        // Now disable.
        crate::extensions::lifecycle::set_enabled_with_tools(
            app.handle(),
            &ext_registry,
            extension_id,
            false,
            &tool_registry,
        )
        .expect("set_enabled(false) must succeed");

        assert!(
            tool_registry.list_all().is_empty(),
            "tools must be gone after set_enabled(false)"
        );
    }

    // ── 6. uninstall_unregisters_extension_tools ─────────────────────────────

    #[test]
    fn uninstall_unregisters_extension_tools() {
        let extension_id = "ext.uninstall-test";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("run")]);
        let ext_registry = registry_with_extension(extension_id, manifest, true);
        let tool_registry = Arc::new(ToolRegistry::new());

        // Seed the tool registry directly (simulating prior enable).
        tool_registry
            .register_tier2(extension_id, vec![manifest_tool("run")])
            .unwrap();

        assert_eq!(tool_registry.list_all().len(), 1, "tool must be present before uninstall");

        let app = tauri::test::mock_app();

        // Item 7 adds a ToolRegistry argument to uninstall.
        // This call is RED until that argument is added.
        crate::extensions::lifecycle::uninstall_with_tools(
            app.handle(),
            extension_id,
            &ext_registry,
            &tool_registry,
        )
        .expect("uninstall must succeed");

        assert!(
            tool_registry.list_all().is_empty(),
            "tools must be gone after uninstall"
        );
    }
}
