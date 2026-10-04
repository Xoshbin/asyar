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

  await settingsService.updateSettings('ai', {
    providers: {
      ...settingsService.currentSettings.ai.providers,
      [spec.id]: {
        enabled: true,
        connectionMode: 'cli',
        cliBinaryPath: status.path ?? undefined,
        lastModelId: modelId,
      },
    },
  });

  await agentService.upsertDefaultAgent(spec.id, modelId);
}
