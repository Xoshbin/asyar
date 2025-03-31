import { writable } from "svelte/store";
import type {
  ExtensionContext,
  ILogService,
  INotificationService,
  IExtensionManager,
} from "asyar-api";
import { invoke } from "@tauri-apps/api/core";

interface ExtensionInstallerState {
  url: string;
  isLoading: boolean;
  error: string | null;
  success: string | null;
  installingExtensionName: string | null;
  recentInstalls: {
    name: string;
    url: string;
    timestamp: number;
    success: boolean;
  }[];
}

function createExtensionInstallerState() {
  const { subscribe, set, update } = writable<ExtensionInstallerState>({
    url: "",
    isLoading: false,
    error: null,
    success: null,
    installingExtensionName: null,
    recentInstalls: [],
  });

  let logService: ILogService;
  let notificationService: INotificationService;
  let extensionManager: IExtensionManager;

  function initializeServices(context: ExtensionContext) {
    logService = context.getService<ILogService>("LogService");
    notificationService = context.getService<INotificationService>(
      "NotificationService"
    );
    extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");

    // Load recent installs from localStorage
    try {
      const savedInstalls = localStorage.getItem("asyar-extension-installs");
      if (savedInstalls) {
        const parsed = JSON.parse(savedInstalls);
        update((state) => ({
          ...state,
          recentInstalls: parsed,
        }));
      }
    } catch (error) {
      console.error("Failed to load recent installs", error);
    }
  }

  function setUrl(url: string) {
    update((state) => ({
      ...state,
      url,
      error: null,
      success: null,
    }));
  }

  function saveRecentInstall(install: {
    name: string;
    url: string;
    success: boolean;
  }) {
    update((state) => {
      const newInstalls = [
        {
          ...install,
          timestamp: Date.now(),
        },
        ...state.recentInstalls.slice(0, 9), // Keep only 10 most recent
      ];

      // Save to localStorage
      try {
        localStorage.setItem(
          "asyar-extension-installs",
          JSON.stringify(newInstalls)
        );
      } catch (error) {
        console.error("Failed to save recent installs", error);
      }

      return {
        ...state,
        recentInstalls: newInstalls,
      };
    });
  }

  async function installExtension(
    url: string
  ): Promise<{ success: boolean; message: string }> {
    if (!url) {
      return { success: false, message: "No URL provided" };
    }

    update((state) => ({
      ...state,
      isLoading: true,
      error: null,
      success: null,
      installingExtensionName: extractNameFromUrl(url),
    }));

    try {
      // Create installed-extensions directory if it doesn't exist
      const appDirPath = await appDir();
      const extensionsDir = `${appDirPath}installed-extensions`;

      if (!(await exists(extensionsDir))) {
        await createDir(extensionsDir, { recursive: true });
      }

      // Clone repository or download zip based on URL
      if (url.includes("github.com")) {
        const result = await installFromGitHub(url, extensionsDir);

        if (result.success) {
          update((state) => ({
            ...state,
            isLoading: false,
            success: `Successfully installed extension from ${url}`,
            error: null,
          }));

          saveRecentInstall({
            name: result.name || extractNameFromUrl(url),
            url,
            success: true,
          });

          notificationService.notify({
            title: "Extension Installed",
            body: `Successfully installed ${result.name || "extension"}`,
          });

          // Refresh extensions to load the new one
          await extensionManager.refreshExtensions();

          return {
            success: true,
            message: `Successfully installed extension from ${url}`,
          };
        } else {
          update((state) => ({
            ...state,
            isLoading: false,
            error: result.error,
            success: null,
          }));

          saveRecentInstall({
            name: extractNameFromUrl(url),
            url,
            success: false,
          });

          return { success: false, message: result.error };
        }
      } else if (url.includes("asyar.org")) {
        // Handle asyar.org specific downloads
        // For this implementation, we'll just assume a GitHub link for simplicity
        return {
          success: false,
          message: "Direct asyar.org downloads not yet implemented",
        };
      } else {
        update((state) => ({
          ...state,
          isLoading: false,
          error: "Unsupported URL format. Please use GitHub repository URLs.",
          success: null,
        }));
        return { success: false, message: "Unsupported URL format" };
      }
    } catch (error) {
      const errorMsg = `Failed to install extension: ${error}`;
      logService?.error(errorMsg);

      update((state) => ({
        ...state,
        isLoading: false,
        error: errorMsg,
        success: null,
      }));

      return { success: false, message: errorMsg };
    }
  }

  async function installFromGitHub(
    url: string,
    extensionsDir: string
  ): Promise<{ success: boolean; error?: string; name?: string }> {
    try {
      // Extract the repo owner and name from the URL
      const repoMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!repoMatch) {
        return { success: false, error: "Invalid GitHub URL format" };
      }

      const [_, owner, repo] = repoMatch;
      let repoName = repo;

      // Handle URLs with .git extension or additional paths
      if (repoName.endsWith(".git")) {
        repoName = repoName.slice(0, -4);
      }

      // Check if destination directory already exists
      const extensionPath = `${extensionsDir}/${repoName}`;
      const exists = await invoke("check_path_exists", { path: extensionPath });

      if (exists) {
        return {
          success: false,
          error: `Extension '${repoName}' already exists`,
        };
      }

      // Clone the repository using git command
      const output = await new Command("git", [
        "clone",
        url,
        extensionPath,
      ]).execute();

      if (output.code !== 0) {
        logService?.error(`Git clone failed: ${output.stderr}`);
        return { success: false, error: `Git clone failed: ${output.stderr}` };
      }

      // Install npm dependencies
      const npmOutput = await new Command("npm", ["install"], {
        cwd: extensionPath,
      }).execute();

      if (npmOutput.code !== 0) {
        logService?.error(`npm install failed: ${npmOutput.stderr}`);
        return {
          success: true,
          name: repoName,
          error: `Extension cloned but dependencies installation failed: ${npmOutput.stderr}`,
        };
      }

      return { success: true, name: repoName };
    } catch (error) {
      logService?.error(`GitHub install error: ${error}`);
      return {
        success: false,
        error: `Failed to install from GitHub: ${error}`,
      };
    }
  }

  function extractNameFromUrl(url: string): string {
    try {
      // For GitHub URLs, extract the repo name
      if (url.includes("github.com")) {
        const parts = url.split("/");
        let repoName =
          parts[parts.length - 1] || parts[parts.length - 2] || "unknown";

        // Remove .git extension if present
        if (repoName.endsWith(".git")) {
          repoName = repoName.slice(0, -4);
        }

        return repoName;
      }

      // For other URLs, just return the domain
      const domain = new URL(url).hostname;
      return domain || "extension";
    } catch (error) {
      return "extension";
    }
  }

  function reset() {
    update((state) => ({
      ...state,
      url: "",
      error: null,
      success: null,
      installingExtensionName: null,
    }));
  }

  return {
    subscribe,
    setUrl,
    installExtension,
    reset,
    initializeServices,
  };
}

export const extensionInstallerState = createExtensionInstallerState();
function appDir() {
  throw new Error("Function not implemented.");
}

function exists(extensionsDir: string) {
  throw new Error("Function not implemented.");
}

function createDir(extensionsDir: string, arg1: { recursive: boolean }) {
  throw new Error("Function not implemented.");
}
