import applicationsService from "../services/applicationsService";
import type { AppResult } from "../types";

export class ApplicationApi {
  /**
   * List all applications
   */
  static async list(): Promise<AppResult[]> {
    return await applicationsService.getAllApplications();
  }

  /**
   * Open an application by path
   */
  static async open(path: string): Promise<void> {
    await applicationsService.open({
      name: path.split("/").pop()?.replace(".app", "") || "",
      path: path,
      score: 0,
    });
  }

  /**
   * Search for applications
   */
  static async search(query: string): Promise<AppResult[]> {
    return await applicationsService.search(query);
  }
}
