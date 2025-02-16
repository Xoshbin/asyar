import { Extension, ExtensionManifest } from "../types/Extension";
import { info, error } from "@tauri-apps/plugin-log";

export async function loadExtension(
  extensionId: string
): Promise<Extension | null> {
  try {
    info(`[EXTESIONN LOADER] Starting to load extension: ${extensionId}`);

    // First load the manifest
    info(
      `[EXTESIONN LOADER] Attempting to load manifest from: ../extensions/${extensionId}/manifest.json`
    );
    let manifest: ExtensionManifest;
    try {
      const manifestModule = await import(
        `../extensions/${extensionId}/manifest.json`
      );
      manifest = manifestModule.default || manifestModule;
    } catch (manifestErr) {
      error(`[EXTESIONN LOADER] Failed to load manifest: ${manifestErr}`);
      throw manifestErr;
    }

    // Then load the extension module
    info(
      `[EXTESIONN LOADER] Attempting to load extension module from: ../extensions/${extensionId}/main`
    );
    try {
      const extensionModule = await import(
        /* @vite-ignore */
        `../extensions/${extensionId}/main`
      );

      if (!extensionModule.default) {
        throw new Error("Extension module must have a default export");
      }

      const extension: Extension = extensionModule.default;
      extension.manifest = manifest;

      // Verify view handler exists if views are declared
      if (manifest.views && manifest.views.length > 0 && !extension.getView) {
        throw new Error(
          `Extension ${extensionId} declares views but has no getView handler`
        );
      }

      // Initialize the extension
      if (extension.initialize) {
        info(`[EXTESIONN LOADER] Initializing extension ${manifest.name}`);
        await extension.initialize();
        info(
          `[EXTESIONN LOADER] Extension ${manifest.name} initialized successfully`
        );
      }

      return extension;
    } catch (moduleErr) {
      error(`[EXTESIONN LOADER] Failed to load extension module: ${moduleErr}`);
      throw moduleErr;
    }
  } catch (err) {
    error(
      `[EXTESIONN LOADER] Critical error loading extension ${extensionId}:`
    );
    return null;
  }
}
