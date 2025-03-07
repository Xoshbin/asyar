import type { AppResult } from "../../types";

/**
 * Interface for managing and interacting with system applications
 */
export interface IApplicationsService {
  /**
   * Refresh the application cache from the system
   */
  refreshCache(): Promise<void>;

  /**
   * Search for applications matching the query
   */
  search(query: string): Promise<AppResult[]>;

  /**
   * Open an application
   */
  open(app: AppResult): Promise<void>;

  /**
   * Gets all applications without filtering
   */
  getAllApplications(): Promise<AppResult[]>;
}
