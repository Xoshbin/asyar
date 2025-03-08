import type { AppResult } from "../../types";

/**
 * Interface for Application API
 */
export interface IApplicationApi {
  /**
   * List all applications
   */
  list(): Promise<AppResult[]>;

  /**
   * Open an application by path
   */
  open(path: string): Promise<void>;

  /**
   * Search for applications
   */
  search(query: string): Promise<AppResult[]>;
}
