import re

with open('src/services/extension/extensionManager.ts', 'r') as f:
    content = f.read()

# Update loadExtensions to scan the appDataDir extensions folder instead of using Vite's glob loader.
load_logic_old = """  public async loadExtensions() {
    logService.info("Starting extension loading process...");

    // First, clear existing modules mapping so we start fresh
    this.extensionModulesById.clear();
    this.manifestsById.clear();
    this.allLoadedCommands = [];

    // Only fetch manifests using the new indexExtensions function
    const extensionIndexes = await indexExtensions();

    let loadedCount = 0;

    for (const entry of extensionIndexes) {
      const extensionId = entry.id;
      const manifest = entry.manifest;
      // ...

      // We will NO LONGER load the full module code here,
      // EXCEPT for built-in extensions if they are crucial to startup,
      // but ideally we don't load ANY code until the view is activated.

      // Store the manifest for reference
      this.manifestsById.set(extensionId, manifest as ExtensionManifest);"""

load_logic_new = """  public async loadExtensions() {
    logService.info("Starting extension loading process...");

    this.extensionModulesById.clear();
    this.manifestsById.clear();
    this.allLoadedCommands = [];

    // Scan Tauri appDataDir for extensions instead of Vite Glob
    try {
      const baseDir = await invoke<string>("get_extensions_dir");
      const entries = await readDir(baseDir);

      for (const entry of entries) {
        if (entry.isDirectory) {
          try {
            const manifestPath = await join(baseDir, entry.name, "manifest.json");
            const manifestStr = await invoke<string>("read_text_file", { path: manifestPath });
            const manifest = JSON.parse(manifestStr) as ExtensionManifest;
            this.manifestsById.set(entry.name, manifest);

            // If it has headless commands, spawn them
            if (manifest.commands) {
                // Future expansion: we can spawn headless processes here.
                for (const cmd of manifest.commands) {
                    if (cmd.headless) {
                        const entryPath = await join(baseDir, entry.name, manifest.main);
                        await invoke("spawn_headless_extension", { id: `${entry.name}_${cmd.id}`, path: entryPath });
                    }
                }
            }
          } catch (e) {
            logService.warn(`Skipping invalid extension dir ${entry.name}: ${e}`);
          }
        }
      }
    } catch (e) {
      logService.error(`Failed to load extensions from disk: ${e}`);
    }"""

content = content.replace(load_logic_old, load_logic_new)

with open('src/services/extension/extensionManager.ts', 'w') as f:
    f.write(content)
