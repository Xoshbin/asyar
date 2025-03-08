import { applicationService } from "../services/applicationsService";
import type { AppResult } from "../types";
import type { IApplicationApi } from "./interfaces/IApplicationApi";

/**
 * API for application management
 */
export class ApplicationApi implements IApplicationApi {
  /**
   * List all applications
   */
  async list(): Promise<AppResult[]> {
    return await applicationService.getAllApplications();
  }

  /**
   * Open an application by path
   */
  async open(path: string): Promise<void> {
    await applicationService.open({
      name: path.split("/").pop()?.replace(".app", "") || "",
      path: path,
      score: 0,
    });
  }

  /**
   * Search for applications
   */
  async search(query: string): Promise<AppResult[]> {
    return await applicationService.search(query);
  }
}
