export interface ExtensionSyncProvider {
  displayName: string;
  sensitiveFields?: string[];
  defaultEnabled?: boolean;
  export(): Promise<Record<string, unknown>>;
  import(data: Record<string, unknown>, strategy: 'replace' | 'merge' | 'skip'): Promise<void>;
  preview(data: Record<string, unknown>): Promise<{ localCount: number; incomingCount: number }>;
}
