import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import type { AppResult } from "../../types";

export const applications = {
  async search(query: string): Promise<AppResult[]> {
    info(`[Apps API] Searching for: ${query}`);
    return await invoke("search_applications", { query });
  },

  async open(appPath: string): Promise<void> {
    info(`[Apps API] Opening application: ${appPath}`);
    await openPath(appPath);
  },

  async getInstalledApps(): Promise<string[]> {
    info("[Apps API] Getting installed applications");
    return await invoke("list_applications");
  },
} as const;
