export type McpTransportSpec =
  | { kind: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string | null }
  | { kind: 'http'; url: string; headers: Record<string, string> };

export interface McpServerInstallInput {
  id: string;
  displayName: string;
  description: string | null;
  transport: McpTransportSpec;
}

export interface McpServerSummary {
  id: string;
  displayName: string;
  description: string | null;
  transportKind: string;
  enabled: boolean;
  status: 'starting' | 'connected' | 'failed' | 'disabled';
  toolsCount: number;
}

export interface McpTestResult { toolsCount: number; error: string | null; }

export interface DetectedConfig {
  source: string;
  path: string;
  servers: McpServerInstallInput[];
}

export interface McpAuditRow {
  id: number;
  serverId: string;
  toolId: string;
  agentId: string | null;
  calledAt: number;
  success: boolean;
  errorSummary: string | null;
  argsSummary: string;
}
