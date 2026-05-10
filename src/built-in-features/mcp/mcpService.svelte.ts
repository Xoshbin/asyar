import type {
  McpServerSummary,
  McpServerInstallInput,
  McpTestResult,
  DetectedConfig,
  McpAuditRow,
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
} from '../../lib/ipc/mcpCommands';

export class McpService {
  servers = $state<McpServerSummary[]>([]);
  audit = $state<McpAuditRow[]>([]);
  detectedConfigs = $state<DetectedConfig[]>([]);
  loading = $state<boolean>(false);
  permissionPrompt = $state<{
    serverId: string;
    toolId: string;
    agentId: string;
    resolve: (d: 'allow_once' | 'allow_always' | 'never' | 'cancel') => void;
  } | null>(null);

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
