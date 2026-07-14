import type {
  McpServerSummary,
  McpServerInstallInput,
  McpTestResult,
  DetectedConfig,
  McpAuditRow,
  McpToolDescriptor,
  McpPermissionRow,
  McpRuntimeConsentNeeded,
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
  mcpGetStrictMode,
  mcpSetStrictMode,
} from '../../lib/ipc/mcpCommands';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../../services/log/logService';
import { runtimeService } from '../../services/runtime/runtimeService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

interface StatusChangedEvent {
  serverId: string;
  status: 'starting' | 'connected' | 'failed' | 'disabled';
  toolsCount: number;
}

function isRuntimeConsentNeeded(value: unknown): value is McpRuntimeConsentNeeded {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'needsRuntime'
  );
}

export class McpService {
  servers = $state<McpServerSummary[]>([]);
  audit = $state<McpAuditRow[]>([]);
  detectedConfigs = $state<DetectedConfig[]>([]);
  permissions = $state<McpPermissionRow[]>([]);
  loading = $state<boolean>(false);
  strictMode = $state<boolean>(false);
  permissionPrompt = $state<{
    serverId: string;
    toolId: string;
    agentId: string;
    resolve: (d: 'allow_once' | 'allow_always' | 'never' | 'cancel') => void;
  } | null>(null);
  /** Set while `install`/`setEnabled` is waiting on user consent to download a missing runtime. */
  runtimeConsentPrompt = $state<{
    name: string;
    sizeBytes: number;
    resolve: (approved: boolean) => void;
  } | null>(null);
  /** Human-readable reason the last `install()` call didn't produce a
   * server, set only for genuine failures (download failed, or the retry
   * after a successful download still failed — e.g. a bad command/args
   * that can't actually be reached). Left `null` when the user simply
   * declined the download, since that's an intentional choice, not an
   * error — a caller UI shouldn't show it as one. */
  installError = $state<string | null>(null);
  /** Same shape as `installError`, for `setEnabled()`. */
  enableError = $state<string | null>(null);

  private statusUnlisten: UnlistenFn | null = null;

  constructor() {
    void this.subscribeToStatusEvents();
  }

  private async subscribeToStatusEvents(): Promise<void> {
    try {
      this.statusUnlisten = await listen<StatusChangedEvent>('mcp:status_changed', (event) => {
        const { serverId, status, toolsCount } = event.payload;
        const idx = this.servers.findIndex((s) => s.id === serverId);
        if (idx >= 0) {
          this.servers[idx] = {
            ...this.servers[idx],
            status,
            toolsCount,
          };
        }
      });
    } catch (err) {
      void logService.warn(`[mcp] status listener setup failed: ${err}`);
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    try {
      await Promise.all([this.refreshServers(), this.refreshAudit(), this.refreshStrictMode()]);
      if (this.servers.length === 0) {
        await this.detectConfigs();
      }
    } finally {
      this.loading = false;
    }
  }

  async refreshStrictMode(): Promise<void> {
    this.strictMode = await mcpGetStrictMode();
  }

  /** Persist a new strict-mode value and update local state on success. */
  async setStrictMode(enabled: boolean): Promise<void> {
    const ok = await mcpSetStrictMode(enabled);
    if (ok) {
      this.strictMode = enabled;
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
    this.installError = null;
    let result = await mcpInstallServer(input);
    if (isRuntimeConsentNeeded(result)) {
      if (this.runtimeConsentPrompt) return null; // a consent prompt is already in progress
      const approved = await this.requestRuntimeConsent(result.name, result.sizeBytes);
      if (!approved) return null; // an intentional decline, not an error
      if (!(await this.downloadRuntimeOrReportFailure(result.name))) {
        this.installError = `Failed to download ${result.name}. Try again from the install form.`;
        return null;
      }
      result = await mcpInstallServer(input);
    }
    if (result === null || isRuntimeConsentNeeded(result)) {
      this.installError =
        'Could not install this MCP server — check its command/arguments and try again.';
      return null;
    }
    await this.refreshServers();
    return result;
  }

  async test(input: McpServerInstallInput): Promise<McpTestResult | null> {
    return mcpTestServer(input);
  }

  async setEnabled(serverId: string, enabled: boolean): Promise<void> {
    this.enableError = null;
    let result = await mcpSetServerEnabled(serverId, enabled);
    if (isRuntimeConsentNeeded(result)) {
      if (this.runtimeConsentPrompt) return; // a consent prompt is already in progress
      const approved = await this.requestRuntimeConsent(result.name, result.sizeBytes);
      if (!approved) return; // an intentional decline, not an error
      if (!(await this.downloadRuntimeOrReportFailure(result.name))) {
        this.enableError = `Failed to download ${result.name}. Try again from here.`;
        return;
      }
      result = await mcpSetServerEnabled(serverId, enabled);
    }
    if (result === true) {
      await this.refreshServers();
    } else {
      this.enableError =
        'Could not enable this MCP server — check its configuration and try again.';
    }
  }

  private requestRuntimeConsent(name: string, sizeBytes: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.runtimeConsentPrompt = { name, sizeBytes, resolve };
    });
  }

  /** Downloads `name`, reporting a distinct diagnostic on failure so a
   * failed download doesn't look identical to "still needs runtime" on the
   * next retry — the caller always sees a boolean it can act on cleanly. */
  private async downloadRuntimeOrReportFailure(name: string): Promise<boolean> {
    const ok = await runtimeService.download(name);
    if (!ok) {
      void feedbackService.report({
        source: 'frontend',
        kind: 'mcp_runtime_download_failed',
        severity: 'error',
        retryable: true,
        developerDetail: `Failed to download the "${name}" runtime needed by this MCP server.`,
        context: { runtime: name },
      });
    }
    return ok;
  }

  handleRuntimeConsentDecision(approved: boolean): void {
    const p = this.runtimeConsentPrompt;
    if (!p) return;
    p.resolve(approved);
    this.runtimeConsentPrompt = null;
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

  handlePermissionDecision(decision: 'allow_once' | 'allow_always' | 'never' | 'cancel'): void {
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
