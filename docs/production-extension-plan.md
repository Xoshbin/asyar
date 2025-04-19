# Production Extension Management Plan for Asyar

**Date:** 2025-04-18

**Goal:** Adapt the Tauri 2.0 + Svelte 5 application's extension management system for production deployment. This involves using platform-specific installation paths, ensuring reliable loading of both built-in and user-installed extensions, adhering to the Separation of Concerns (SoC) principle, and keeping code modules concise (ideally under 500 lines).

## Analysis of Current State

Based on review of `src/services/extension/extensionManager.ts` and `src/services/extensionLoaderService.ts`:

1.  **`extensionManager.ts`:**
    *   Handles multiple responsibilities beyond installation: initialization, loading coordination, uninstallation, command synchronization, view management delegation.
    *   Existing installation logic (`installExtensionFromUrl`) needs adaptation for production paths and robust download/unzip mechanisms.
    *   Delegates loading to `extensionLoaderService`.

2.  **`extensionLoaderService.ts`:**
    *   Correctly separates loading logic.
    *   Distinguishes between development and production modes.
    *   **Built-in Loading (Production):** Relies on potentially brittle relative paths and hardcoded details. Needs to use reliable paths provided by the backend.
    *   **Installed Loading:** Uses `invoke("get_extensions_dir")` which likely points to the development source directory, not the user-specific production directory. The actual dynamic loading logic from the filesystem is missing and presents security challenges if implemented purely in the frontend.

## Proposed Plan

### Phase 1: Backend Path Provisioning (Rust)

*   **Goal:** Create Tauri commands to provide reliable, platform-specific paths for extensions in production.
*   **File:** `src-tauri/src/command.rs` (or dedicated `src-tauri/src/paths.rs`)
*   **Actions:**
    *   Define `#[tauri::command]` function `get_production_extensions_path()`:
        *   Uses `app.path().app_data_dir()` + `asyar/extensions`.
        *   Handles path resolution errors.
    *   Define `#[tauri::command]` function `get_builtin_extensions_path()`:
        *   Uses `app.path().resource_dir()` + relative path to packaged built-ins (e.g., `_up_/_app/built-in-extensions/` - *Note: Verify exact path in build output*).
        *   Handles path resolution errors.
    *   Register commands in `lib.rs` or `main.rs`.
    *   Add necessary capabilities (e.g., `core:path:default`) to `capabilities/default.json`.
    *   Ensure `tauri`, `serde` crates are present in `Cargo.toml`.

### Phase 2: Frontend Installation Logic (`extensionManager.ts`)

*   **Goal:** Refocus `extensionManager.ts` solely on installation, using the production path and robust download/unzip logic.
*   **File:** `src/services/extension/extensionManager.ts`
*   **Actions:**
    *   **(Recommended):** Refactor non-installation logic (command sync, view delegation) into separate services for better SoC and maintainability.
    *   **Modify/Create `installExtension(url: string)`:**
        *   Invoke `get_production_extensions_path` via Tauri to get the target base directory.
        *   **Download:** Use `@tauri-apps/plugin-http`'s `fetch` (recommended) or `axios` to download the extension zip as binary data.
        *   **Unzip:** Use `jszip` library to process the downloaded zip data.
        *   **Save:**
            *   Determine extension ID (from manifest in zip, URL, etc.).
            *   Create target directory: `await createDir(join(basePath, extensionId), { recursive: true });` using `@tauri-apps/plugin-fs`.
            *   Iterate zip files, save using `writeBinaryFile` from `@tauri-apps/plugin-fs` into the target directory.
        *   **Error Handling:** Implement `try...catch` for download, unzip, and file operations. Log errors (`logService`) and notify user (`NotificationService`).
    *   **Dependencies:** Add `jszip`, `@tauri-apps/plugin-http`.
    *   **Capabilities:** Add `http:default`, `fs:default`, and permissions for the new Rust commands.

### Phase 3: Frontend Loading Logic (`extensionLoaderService.ts`)

*   **Goal:** Adapt loading to use Rust-provided paths and handle dynamic loading from the filesystem for installed extensions.
*   **File:** `src/services/extensionLoaderService.ts`
*   **Actions:**
    *   **Modify `loadBuiltInExtensions`:**
        *   Invoke `get_builtin_extensions_path` for the base path.
        *   Use `@tauri-apps/plugin-fs` (`readDir`, `readTextFile`) to find and read `manifest.json` files.
        *   Load JS using dynamic `import()` with paths relative to the application root (matching production bundle structure).
    *   **Modify `loadInstalledExtensions`:**
        *   Invoke `get_production_extensions_path` for the user extensions directory.
        *   Use `@tauri-apps/plugin-fs` (`readDir`) to list extension subdirectories.
        *   For each extension directory:
            *   Read `manifest.json` (`readTextFile`, `JSON.parse`). Handle errors.
            *   **Load JS (Option with Security Warning):**
                *   Read the main JS file (`manifest.main`) using `readTextFile`.
                *   Create Blob and Object URL: `const blob = new Blob([jsContent], { type: 'application/javascript' }); const objectURL = URL.createObjectURL(blob);`
                *   Dynamic import: `const module = await import(/* @vite-ignore */ objectURL);`
                *   **Revoke URL:** `URL.revokeObjectURL(objectURL);`
                *   **Add explicit warnings (comments/logs) about security risks.**
            *   Store manifest and loaded module in the `extensionsMap`.
            *   Wrap individual extension loading in `try...catch`.
    *   Update `loadSingleExtension` similarly.

### Phase 4: Integration and UI

*   **Goal:** Ensure the application uses the updated services correctly and renders extensions dynamically.
*   **Files:** Relevant Svelte components (e.g., settings page, main layout, `ExtensionRenderer.svelte`).
*   **Actions:**
    *   Ensure installation UI calls `extensionManager.installExtension(url)`.
    *   Ensure `extensionLoaderService.loadAllExtensions()` is called during app initialization.
    *   **`ExtensionRenderer.svelte` Guidance:**
        *   Accept loaded extension module and manifest as props.
        *   Dynamically import the view component specified in `manifest.viewComponent`.
        *   Use `<svelte:component this={viewComponentInstance} {...props} />` for rendering.
        *   Include error boundaries (`{#if}...{:else}...{/if}`).

## Visual Plan (Mermaid)

```mermaid
graph TD
    subgraph Rust Backend
        Cmd1[fa:fa-cogs get_production_extensions_path()]
        Cmd2[fa:fa-cogs get_builtin_extensions_path()]
    end

    subgraph Frontend Installation
        InstallUI(Settings Page) -- install request --> ExtMgr(extensionManager.ts)
        ExtMgr -- invoke --> Cmd1
        Cmd1 -- path --> ExtMgr
        ExtMgr -- download --> HTTP(HTTP Plugin/axios)
        HTTP -- zip data --> ExtMgr
        ExtMgr -- unzip --> JSZip(jszip)
        JSZip -- files --> ExtMgr
        ExtMgr -- write files --> FS(FS Plugin)
    end

    subgraph Frontend Loading
        AppInit(App Startup) -- load request --> ExtLoader(extensionLoaderService.ts)
        ExtLoader -- invoke --> Cmd2
        Cmd2 -- builtInPath --> ExtLoader
        ExtLoader -- read built-in manifests/js --> FS
        ExtLoader -- dynamic import() --> BuiltInExts(Loaded Built-ins)

        ExtLoader -- invoke --> Cmd1
        Cmd1 -- userPath --> ExtLoader
        ExtLoader -- read user manifests/js --> FS
        ExtLoader -- createObjectURL + dynamic import() --> UserExts(Loaded User Exts) -- SECURITY WARNING --> Dev(Developer)

        ExtLoader --> AppState(Extension Map)
    end

    subgraph Frontend Rendering
        Renderer(ExtensionRenderer.svelte) -- uses --> AppState
        Renderer -- dynamic import(manifest.viewComponent) --> ViewComp(Extension View)
        Renderer -- renders --> ViewComp
    end

    style Dev fill:#f9f,stroke:#333,stroke-width:2px
```

## Summary & Considerations

*   **Rust:** Add two commands for path retrieval.
*   **`extensionManager.ts`:** Focus on installation, use production path, implement download/unzip.
*   **`extensionLoaderService.ts`:** Use Rust paths, implement loading (with security warnings for installed extensions).
*   **Dependencies:** `jszip`, `@tauri-apps/plugin-http`.
*   **Capabilities:** `core:path:default`, `fs:default`, `http:default`, custom command permissions.
*   **Security:** Loading user-installed JS via Blob/ObjectURL in the frontend carries inherent risks. Consider safer alternatives (sandboxing, Rust-side loading) long-term.
*   **SoC:** Plan improves Separation of Concerns.