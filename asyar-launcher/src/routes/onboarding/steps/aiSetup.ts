import { agentService } from '../../../built-in-features/agents/agentService.svelte';
import type { CliStatus } from '../../../bindings';
import { settingsService } from '../../../services/settings/settingsService.svelte';

interface CliProviderSelection {
  id: string;
  defaultModel: string;
}

export async function connectCliProvider(
  spec: CliProviderSelection,
  status: Pick<CliStatus, 'path'>,
): Promise<void> {
  const modelId = spec.defaultModel;

  const providers = settingsService.currentSettings.ai.providers;
  const existing = providers[spec.id];
  const cliBinaryPath = status.path ?? existing?.cliBinaryPath;

  // Merge so base URL, reasoning effort and any other field survive. The model is
  // replaced on purpose: API-mode model ids are not valid for the CLI. A saved key
  // lives in the encrypted credential store and is not touched here.
  await settingsService.updateSettings('ai', {
    providers: {
      ...providers,
      [spec.id]: {
        ...existing,
        enabled: true,
        connectionMode: 'cli',
        ...(cliBinaryPath ? { cliBinaryPath } : {}),
        lastModelId: modelId,
      },
    },
  });

  await agentService.upsertDefaultAgent(spec.id, modelId);
}
