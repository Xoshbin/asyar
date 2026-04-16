import type { InstalledApplication } from '../types/ApplicationType';
import { BaseServiceProxy } from './BaseServiceProxy';

export interface FrontmostApplication {
  name: string;
  bundleId?: string;
  path?: string;
  windowTitle?: string;
}

export interface IApplicationService {
  /**
   * Retrieves metadata about the currently focused application.
   * Requires 'application:read' permission.
   */
  getFrontmostApplication(): Promise<FrontmostApplication>;

  /**
   * Scans for applications in default and extra paths.
   * Only useful for extensions that manage application indexing.
   * Requires 'application:read' permission.
   */
  syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }>;

  /**
   * Lists all installed applications.
   * Requires 'application:read' permission.
   */
  listApplications(extraPaths?: string[]): Promise<InstalledApplication[]>;
}

export class ApplicationServiceProxy extends BaseServiceProxy implements IApplicationService {
  async getFrontmostApplication(): Promise<FrontmostApplication> {
    return await this.broker.invoke('application:getFrontmostApplication');
  }

  async syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }> {
    return await this.broker.invoke('application:syncApplicationIndex', { extraPaths });
  }

  async listApplications(extraPaths?: string[]): Promise<InstalledApplication[]> {
    return await this.broker.invoke<InstalledApplication[]>('application:listApplications', { extraPaths });
  }
}
