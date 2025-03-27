import type { AppResult } from "../../types";

/**
 * Interface for managing and interacting with system applications
 */
export interface IApplicationsService {
  /**
   * Initialize the applications service
   */
  init(): Promise<void>;

  /**
   * Open an application
   */
  open(app: AppResult): Promise<void>;

  /**
   * Gets all applications without filtering
   */
  getAllApplications(): Promise<AppResult[]>;
}
