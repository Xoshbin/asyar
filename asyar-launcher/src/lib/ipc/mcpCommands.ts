import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type {
  McpServerInstallInput,
  McpServerSummary,
  McpTestResult,
  DetectedConfig,
  McpAuditRow,
  McpToolDescriptor,
  McpPermissionRow,
} from '../../built-in-features/mcp/types';

export async function mcpListServers(): Promise<McpServerSummary[] | null> {
  return invokeSafe<McpServerSummary[]>('mcp_list_servers');
}

export async function mcpInstallServer(
  input: McpServerInstallInput,
): Promise<McpServerSummary | null> {
  return invokeSafe<McpServerSummary>('mcp_install_server', { input });
}

export async function mcpTestServer(
  input: McpServerInstallInput,
): Promise<McpTestResult | null> {
  return invokeSafe<McpTestResult>('mcp_test_server', { input });
}

export async function mcpSetServerEnabled(
  serverId: string,
  enabled: boolean,
): Promise<boolean> {
  return invokeSafeVoid('mcp_set_server_enabled', { serverId, enabled });
}

export async function mcpUninstallServer(serverId: string): Promise<boolean> {
  return invokeSafeVoid('mcp_uninstall_server', { serverId });
}

export async function mcpListAudit(
  serverId: string | null = null,
  limit = 50,
): Promise<McpAuditRow[] | null> {
  return invokeSafe<McpAuditRow[]>('mcp_list_audit', { serverId, limit });
}

export async function mcpDetectExistingConfigs(): Promise<DetectedConfig[] | null> {
  return invokeSafe<DetectedConfig[]>('mcp_detect_existing_configs');
}

export async function mcpParseConfigJson(
  json: string,
): Promise<McpServerInstallInput[] | null> {
  return invokeSafe<McpServerInstallInput[]>('mcp_parse_config_json', { json });
}

export async function mcpInvokeTool(
  serverId: string,
  toolId: string,
  args: Record<string, unknown>,
  agentId?: string,
): Promise<unknown> {
  return invokeSafe<unknown>('mcp_invoke_tool', { serverId, toolId, agentId, args });
}

export async function mcpSetPermission(
  serverId: string,
  toolId: string,
  agentId: string,
  decision: 'allow_once' | 'allow_always' | 'never',
): Promise<boolean> {
  return invokeSafeVoid('mcp_set_permission', { serverId, toolId, agentId, decision });
}

export async function mcpGetPermission(
  serverId: string,
  toolId: string,
  agentId: string,
): Promise<'allow_once' | 'allow_always' | 'never' | null> {
  return invokeSafe<'allow_once' | 'allow_always' | 'never' | null>(
    'mcp_get_permission',
    { serverId, toolId, agentId },
  );
}

export async function mcpListServerTools(
  serverId: string,
): Promise<McpToolDescriptor[] | null> {
  return invokeSafe<McpToolDescriptor[]>('mcp_list_server_tools', { serverId });
}

export async function mcpListPermissions(
  serverId: string | null = null,
): Promise<McpPermissionRow[] | null> {
  return invokeSafe<McpPermissionRow[]>('mcp_list_permissions', { serverId });
}

export async function mcpDeletePermission(
  serverId: string,
  toolId: string,
  agentId: string,
): Promise<boolean> {
  return invokeSafeVoid('mcp_delete_permission', { serverId, toolId, agentId });
}

export async function mcpGetStrictMode(): Promise<boolean> {
  return (await invokeSafe<boolean>('mcp_get_strict_mode')) ?? false;
}

export async function mcpSetStrictMode(enabled: boolean): Promise<boolean> {
  return invokeSafeVoid('mcp_set_strict_mode', { enabled });
}
