import { ExtensionBridge } from '../ExtensionBridge';

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
  listApplications(extraPaths?: string[]): Promise<any[]>;
}

export class ApplicationServiceProxy implements IApplicationService {
  constructor(private bridge: ExtensionBridge) {}

  async getFrontmostApplication(): Promise<FrontmostApplication> {
    return await this.bridge.invoke('asyar:service:ApplicationService:getFrontmostApplication');
  }

  async syncApplicationIndex(extraPaths?: string[]): Promise<{ added: number; removed: number; total: number }> {
    return await this.bridge.invoke('asyar:service:ApplicationService:syncApplicationIndex', { extraPaths });
  }

  async listApplications(extraPaths?: string[]): Promise<any[]> {
    return await this.bridge.invoke('asyar:service:ApplicationService:listApplications', { extraPaths });
  }
}
