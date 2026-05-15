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
    use tauri::Manager;

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

    // ── 7. set_enabled_calls_tool_registry_sync_via_managed_state ────────────
    //
    // The production `set_enabled` looks up the ToolRegistry through Tauri
    // managed state. Mirrors the pattern other lifecycle cleanups use
    // (`run_notification_cleanup`, etc.) — extract the work into a helper
    // tested with `mock_app + manage(Arc<ToolRegistry>)`, and call it from
    // production via `app_handle.try_state`.

    #[test]
    fn run_tool_registry_sync_registers_tools_on_enable() {
        let extension_id = "ext.via-managed-state-enable";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("run")]);
        let ext_registry = registry_with_extension(extension_id, manifest, true);

        let app = tauri::test::mock_app();
        let tool_registry: Arc<ToolRegistry> = Arc::new(ToolRegistry::new());
        app.manage(Arc::clone(&tool_registry));

        // Helper that production set_enabled calls. This is the unit under
        // test — it must look up ToolRegistry from managed state and sync.
        crate::extensions::lifecycle::run_tool_registry_sync_on_enable_change(
            app.handle(),
            &ext_registry,
            extension_id,
            true,
        );

        let fqids: Vec<String> = tool_registry
            .list_all()
            .iter()
            .map(|d| d.fully_qualified_id.clone())
            .collect();
        assert!(
            fqids.iter().any(|s| s == "ext.via-managed-state-enable:run"),
            "tool must be registered via managed-state path; got {:?}",
            fqids,
        );
    }

    #[test]
    fn run_tool_registry_sync_unregisters_tools_on_disable() {
        let extension_id = "ext.via-managed-state-disable";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("run")]);
        let ext_registry = registry_with_extension(extension_id, manifest, false);

        let app = tauri::test::mock_app();
        let tool_registry: Arc<ToolRegistry> = Arc::new(ToolRegistry::new());
        tool_registry
            .register_tier2(extension_id, vec![manifest_tool("run")])
            .unwrap();
        app.manage(Arc::clone(&tool_registry));

        crate::extensions::lifecycle::run_tool_registry_sync_on_enable_change(
            app.handle(),
            &ext_registry,
            extension_id,
            false,
        );

        assert!(
            tool_registry.list_all().is_empty(),
            "tools must be gone after disable via managed-state path",
        );
    }

    #[test]
    fn run_tool_registry_sync_is_noop_without_managed_registry() {
        // Mirrors the no-tool-registry-managed test for notifications. Must
        // not panic on harnesses or fresh profiles that skip the agents
        // module.
        let extension_id = "ext.no-tool-registry";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("run")]);
        let ext_registry = registry_with_extension(extension_id, manifest, true);

        let app = tauri::test::mock_app();
        // Intentionally not managing ToolRegistry.

        crate::extensions::lifecycle::run_tool_registry_sync_on_enable_change(
            app.handle(),
            &ext_registry,
            extension_id,
            true,
        );
        // No assert — just must not panic.
    }

    #[test]
    fn run_tool_registry_cleanup_on_uninstall_drops_extensions_tools() {
        let extension_id = "ext.uninstall-via-state";

        let app = tauri::test::mock_app();
        let tool_registry: Arc<ToolRegistry> = Arc::new(ToolRegistry::new());
        tool_registry
            .register_tier2(extension_id, vec![manifest_tool("run")])
            .unwrap();
        app.manage(Arc::clone(&tool_registry));

        crate::extensions::lifecycle::run_tool_registry_cleanup_on_uninstall(
            app.handle(),
            extension_id,
        );

        assert!(
            tool_registry.list_all().is_empty(),
            "tools must be gone after uninstall via managed-state path",
        );
    }

    // ── 8. Startup seeding for already-enabled extensions ────────────────────
    //
    // On launcher restart, set_enabled is NOT called for extensions that were
    // already enabled in a prior session — they're reloaded from settings.dat
    // and their workers auto-mounted, but the agent ToolRegistry starts
    // empty (only Tier 1 builtins are seeded). Without an explicit seed
    // pass at startup, manifest-declared Tier 2 tools are absent until the
    // user toggles enable/disable to retrigger set_enabled.

    #[test]
    fn run_tool_registry_seed_registers_tools_from_already_enabled_extensions() {
        let extension_id = "ext.seeded-on-startup";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("seed-tool")]);
        let ext_registry = registry_with_extension(extension_id, manifest, true);

        let app = tauri::test::mock_app();
        let tool_registry: Arc<ToolRegistry> = Arc::new(ToolRegistry::new());
        app.manage(Arc::clone(&tool_registry));

        crate::extensions::lifecycle::run_tool_registry_seed_for_enabled_extensions(
            app.handle(),
            &ext_registry,
        );

        let fqids: Vec<String> = tool_registry
            .list_all()
            .iter()
            .map(|d| d.fully_qualified_id.clone())
            .collect();
        assert!(
            fqids.iter().any(|s| s == "ext.seeded-on-startup:seed-tool"),
            "tool must be seeded for already-enabled extension; got {:?}",
            fqids,
        );
    }

    #[test]
    fn run_tool_registry_seed_skips_disabled_extensions() {
        let extension_id = "ext.disabled-skip";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("nope")]);
        let ext_registry = registry_with_extension(extension_id, manifest, false);

        let app = tauri::test::mock_app();
        let tool_registry: Arc<ToolRegistry> = Arc::new(ToolRegistry::new());
        app.manage(Arc::clone(&tool_registry));

        crate::extensions::lifecycle::run_tool_registry_seed_for_enabled_extensions(
            app.handle(),
            &ext_registry,
        );

        assert!(
            tool_registry.list_all().is_empty(),
            "disabled extensions must not have their tools seeded at startup",
        );
    }

    #[test]
    fn run_tool_registry_seed_is_noop_without_managed_registry() {
        let extension_id = "ext.no-tool-mgr-seed";
        let manifest = make_manifest_with_tools(extension_id, vec![manifest_tool("seed-tool")]);
        let ext_registry = registry_with_extension(extension_id, manifest, true);

        let app = tauri::test::mock_app();
        // Intentionally not managing ToolRegistry — must be a no-op (fresh
        // profiles or test harnesses that skip the agents module).

        crate::extensions::lifecycle::run_tool_registry_seed_for_enabled_extensions(
            app.handle(),
            &ext_registry,
        );
        // No assert — must not panic.
    }
}
