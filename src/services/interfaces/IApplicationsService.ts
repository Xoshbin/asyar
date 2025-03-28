import type { SearchResult } from "../search/interfaces/SearchResult";

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
  open(app: SearchResult): Promise<void>;
}
