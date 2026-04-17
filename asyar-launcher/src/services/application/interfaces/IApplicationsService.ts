import type { SearchResult } from "../../search/interfaces/SearchResult";

export interface ApplicationScanOverride {
  additionalScanPaths?: string[];
}

/**
 * Interface for managing and interacting with system applications
 */
export interface IApplicationsService {
  /**
   * Initialize the applications service
   */
  init(): Promise<void>;

  /**
   * Optional `override` lets callers receiving cross-window events pass the
   * authoritative payload directly, sidestepping a race with the
   * settings-store IPC bridge.
   */
  resync(override?: ApplicationScanOverride): Promise<void>;

  /**
   * Open an application
   */
  open(app: SearchResult): Promise<void>;
}
