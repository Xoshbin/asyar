import storeExtension from '../../../built-in-features/store/index.svelte';
import { listInstalledExtensions } from '../../../lib/ipc/commands';
import { agentService } from '../../../built-in-features/agents/agentService.svelte';

const EMOJI_ID = 'org.asyar.emoji';

export async function installEmoji(): Promise<boolean> {
  const installed = (await listInstalledExtensions()) ?? [];
  if (installed.includes(EMOJI_ID)) return true;
  await storeExtension.installExtension('emoji', EMOJI_ID, 'Emoji');

  const def = agentService.getDefaultAgent();
  if (def) {
    try {
      await agentService.seedEmojiFallbackAgent(def.providerId, def.modelId);
    } catch (e) {
      console.warn('Failed to seed emoji fallback agent during onboarding installation:', e);
    }
  }
  return true;
}
