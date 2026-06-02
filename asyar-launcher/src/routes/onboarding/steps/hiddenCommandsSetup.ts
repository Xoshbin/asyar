import { agentService } from '../../../built-in-features/agents/agentService.svelte'
import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService'

export async function setUpHiddenCommand(
  modifier: string,
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  const def = agentService.getDefaultAgent()
  if (!def) return { ok: false, error: 'No AI provider is connected yet — go back and connect one.' }
  try {
    const agent = await agentService.seedGrammarFixAgent(def.providerId, def.modelId)
    const res = await shortcutService.register(
      `cmd_agents_dyn_${agent.id}`, agent.name, 'command', `${modifier}+${key}`, undefined, 'icon:sparkles',
    )
    if (!res.ok) {
      const who = res.conflict ? ` It's already used by "${res.conflict.itemName}".` : ''
      return { ok: false, error: `Couldn't bind ${modifier}+${key}.${who} Try a different hotkey.` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
