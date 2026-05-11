import type {
  McpServerSummary,
  McpServerInstallInput,
  McpTestResult,
  DetectedConfig,
  McpAuditRow,
  McpToolDescriptor,
  McpPermissionRow,
} from './types';
import {
  mcpListServers,
  mcpInstallServer,
  mcpTestServer,
  mcpSetServerEnabled,
  mcpUninstallServer,
  mcpListAudit,
  mcpDetectExistingConfigs,
  mcpParseConfigJson,
  mcpSetPermission,
  mcpListServerTools,
  mcpListPermissions,
  mcpDeletePermission,
} from '../../lib/ipc/mcpCommands';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../../services/log/logService';

interface StatusChangedEvent {
  serverId: string;
  status: 'starting' | 'connected' | 'failed' | 'disabled';
  toolsCount: number;
}

export class McpService {
  servers = $state<McpServerSummary[]>([]);
  audit = $state<McpAuditRow[]>([]);
  detectedConfigs = $state<DetectedConfig[]>([]);
  permissions = $state<McpPermissionRow[]>([]);
  loading = $state<boolean>(false);
  permissionPrompt = $state<{
    serverId: string;
    toolId: string;
    agentId: string;
    resolve: (d: 'allow_once' | 'allow_always' | 'never' | 'cancel') => void;
  } | null>(null);

  private statusUnlisten: UnlistenFn | null = null;

  constructor() {
    void this.subscribeToStatusEvents();
  }

  private async subscribeToStatusEvents(): Promise<void> {
    try {
      this.statusUnlisten = await listen<StatusChangedEvent>(
        'mcp:status_changed',
        (event) => {
          const { serverId, status, toolsCount } = event.payload;
          const idx = this.servers.findIndex((s) => s.id === serverId);
          if (idx >= 0) {
            this.servers[idx] = {
              ...this.servers[idx],
              status,
              toolsCount,
            };
          }
        },
      );
    } catch (err) {
      void logService.warn(`[mcp] status listener setup failed: ${err}`);
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      await Promise.all([this.refreshServers(), this.refreshAudit()]);
      if (this.servers.length === 0) {
        await this.detectConfigs();
      }
    } finally {
      this.loading = false;
    }
  }

  async refreshServers(): Promise<void> {
    const result = await mcpListServers();
    if (result !== null) {
      this.servers = result;
    }
  }

  async refreshAudit(serverId: string | null = null, limit = 50): Promise<void> {
    const result = await mcpListAudit(serverId, limit);
    if (result !== null) {
      this.audit = result;
    }
  }

  async install(input: McpServerInstallInput): Promise<McpServerSummary | null> {
    const result = await mcpInstallServer(input);
    if (result !== null) {
      await this.refreshServers();
    }
    return result;
  }

  async test(input: McpServerInstallInput): Promise<McpTestResult | null> {
    return mcpTestServer(input);
  }

  async setEnabled(serverId: string, enabled: boolean): Promise<void> {
    const ok = await mcpSetServerEnabled(serverId, enabled);
    if (ok) await this.refreshServers();
  }

  async uninstall(serverId: string): Promise<void> {
    const ok = await mcpUninstallServer(serverId);
    if (ok) await this.refreshServers();
  }

  async detectConfigs(): Promise<DetectedConfig[]> {
    const result = await mcpDetectExistingConfigs();
    if (result !== null) {
      this.detectedConfigs = result;
      return result;
    }
    return this.detectedConfigs;
  }

  async parseConfigJson(json: string): Promise<McpServerInstallInput[] | null> {
    return mcpParseConfigJson(json);
  }

  async listServerTools(serverId: string): Promise<McpToolDescriptor[] | null> {
    return mcpListServerTools(serverId);
  }

  async refreshPermissions(serverId: string | null = null): Promise<void> {
    const result = await mcpListPermissions(serverId);
    if (result !== null) {
      this.permissions = result;
    }
  }

  async deletePermission(serverId: string, toolId: string, agentId: string): Promise<void> {
    const ok = await mcpDeletePermission(serverId, toolId, agentId);
    if (ok) await this.refreshPermissions();
  }

  requestPermission(
    serverId: string,
    toolId: string,
    agentId: string,
  ): Promise<'allow_once' | 'allow_always' | 'never' | 'cancel'> {
    return new Promise((resolve) => {
      this.permissionPrompt = { serverId, toolId, agentId, resolve };
    });
  }

  handlePermissionDecision(
    decision: 'allow_once' | 'allow_always' | 'never' | 'cancel',
  ): void {
    const p = this.permissionPrompt;
    if (!p) return;
    if (decision !== 'cancel') {
      void mcpSetPermission(p.serverId, p.toolId, p.agentId, decision);
    }
    p.resolve(decision);
    this.permissionPrompt = null;
  }
}

export const mcpService = new McpService();
