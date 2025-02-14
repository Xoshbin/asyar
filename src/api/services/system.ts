import { invoke } from "@tauri-apps/api/core";
import type { AppResult } from "../../types";

export const system = {
  async openApp(appPath: string): Promise<void> {
    await invoke("open_application", { path: appPath });
  },

  async searchApps(query: string): Promise<AppResult[]> {
    return await invoke("search_applications", { query });
  },

  async getAppIcon(appName: string): Promise<string> {
    // Implementation for getting app icon
    return "default-icon";
  },
} as const;
