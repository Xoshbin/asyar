import type { AppResult } from "../../types";
import ApplicationsService from "../../services/applicationsService";
import { log } from "./log";

export const applications = {
  async search(query: string): Promise<AppResult[]> {
    log.info(`[Apps API] Searching for: ${query}`);
    return await ApplicationsService.search(query);
  },

  async open(app: AppResult): Promise<void> {
    log.info(`[Apps API] Opening application: ${app.path}`);
    return await ApplicationsService.open(app);
  },

  async getInstalledApps(): Promise<string[]> {
    log.info("[Apps API] Getting installed applications");
    const results = await ApplicationsService.search("");
    return results.map((app) => app.path);
  },
} as const;
