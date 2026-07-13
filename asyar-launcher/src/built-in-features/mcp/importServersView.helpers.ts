import type { McpServerInstallInput, McpServerSummary } from './types';

export interface ImportOutcome {
  id: string;
  displayName: string;
  ok: boolean;
  error?: string;
}

/** Installs each server one at a time (not `Promise.all` — a shared,
 * once-per-app-session runtime download should never race two consent
 * flows), capturing a per-server error via `getLastError` immediately after
 * a failed `install` call, before the next iteration's `install()` clears
 * it. `getLastError` should read the install service's own error state
 * (e.g. `mcpService.installError`) right after each call. */
export async function importServers(
  servers: McpServerInstallInput[],
  install: (input: McpServerInstallInput) => Promise<McpServerSummary | null>,
  getLastError: () => string | null,
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  for (const input of servers) {
    const result = await install(input);
    if (result !== null) {
      outcomes.push({ id: input.id, displayName: input.displayName, ok: true });
    } else {
      outcomes.push({
        id: input.id,
        displayName: input.displayName,
        ok: false,
        error: getLastError() ?? 'Import failed.',
      });
    }
  }
  return outcomes;
}
