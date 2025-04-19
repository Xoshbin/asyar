4. **Extensibility**:
   - Ensure the application can support multiple types of extensions, each with unique views and commands.
   - Provide clear guidelines for extension developers on how to register their commands and actions within "MyAppLauncher".

### Deliverables:

- Source code of the Rust backend with Tauri commands for indexing, fetching, and recommendations.
- Source code of the Svelte frontend for the user interface and action bar integration.
- Documentation for developers outlining how to create and integrate extensions into "MyAppLauncher".
- Testing and validation of the search functionality, extension API, and user actions.

### Additional Notes:

- ensure to add error handling
- Conside using modular softwrate design and Separation of Concerns (SoC).
- Consider performance optimizations for search indexing and querying, especially with a large number of indexed items.
- Ensure the UI is user-friendly and responsive, taking full advantage of rust tauri 2 and Svelte's capabilities.
- Add comments to describe the code's part of the lifecycle and it's job
  **End of Prompt**

Tauri 2.0: Key Changes for LLM Awareness

Tauri 2.0 represents a fundamental shift from version 1.0, primarily driven by increased modularity and a revamped security model. Understanding these core changes is crucial for generating accurate code or guidance related to Tauri 2.0.

Plugin-Based Architecture:

The monolithic tauri::api module (Rust) and most modules within the @tauri-apps/api package (JavaScript) have been removed.  
Functionality (like dialogs, filesystem access, HTTP requests, shell operations, notifications, etc.) is now provided through discrete plugins (e.g., tauri-plugin-dialog, @tauri-apps/plugin-dialog).  
These plugins must be explicitly added as dependencies (Cargo.toml, package.json) and often initialized in the Rust application builder.  
The core @tauri-apps/api JS package now only exports essential modules: core, path, event, and webviewWindow.  
Capability-Based Permissions:

The allowlist system defined in tauri.conf.json is completely removed.  
It is replaced by a granular capability system. Permissions are defined in separate JSON files (typically in src-tauri/capabilities/).  
Capabilities grant specific permissions, often tied to plugins (e.g., permission to use a specific dialog function).  
Permissions for built-in core functionalities require a core: prefix (e.g., "core:path:default") or can be covered by the shorthand "core:default".  
Key API Changes:

Rust:
tauri::api is gone; use plugins or relocated core functions (e.g., path resolution via Manager::path).  
The main window type tauri::Window is renamed to tauri::WebviewWindow to accommodate multiwebview support.  
Menu and System Tray APIs are completely refactored under tauri::menu and tauri::tray using the muda crate.  
JavaScript:
@tauri-apps/api/tauri is renamed to @tauri-apps/api/core.  
@tauri-apps/api/window is renamed to @tauri-apps/api/webviewWindow.  
Imports for non-core functionalities must point to their respective @tauri-apps/plugin-\* packages.  
Configuration (tauri.conf.json) Restructuring:

The tauri key is renamed to app.  
The bundle configuration object is moved to the top level.  
The allowlist key is removed.  
Configurations for features now implemented as plugins (e.g., CLI, Updater) are moved under a top-level plugins object.  
A new top-level mainBinaryName field is required.  
New Core Feature:

Multiwebview Support: Tauri 2.0 introduces experimental support (behind an unstable flag) for managing multiple webview windows.  
Migration Tooling:

The tauri migrate CLI command assists in upgrading projects from v1 or v2 Beta, including generating initial capability files from v1 allowlists and applying necessary beta-to-final adjustments.  
Beta-to-Final Release Changes:

Introduction of the core: prefix requirement for built-in capability identifiers.  
Use of the TAURI_DEV_HOST environment variable for configuring the development server host, replacing previous methods.
