import { describe, it, expect, vi, beforeEach } from 'vitest'

const seedGrammarFixAgent = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'agent1', name: 'Grammar Fix' }))
const getDefaultAgent = vi.hoisted(() => vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4o' }))
const register = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }))

vi.mock('../../../built-in-features/agents/agentService.svelte', () => ({
  agentService: { seedGrammarFixAgent, getDefaultAgent },
}))
vi.mock('../../../built-in-features/shortcuts/shortcutService', () => ({
  shortcutService: { register },
}))

import { setUpHiddenCommand } from './hiddenCommandsSetup'

describe('setUpHiddenCommand', () => {
  beforeEach(() => vi.clearAllMocks())
  it('seeds Grammar Fix and binds the hotkey to its command id', async () => {
    const res = await setUpHiddenCommand('Super+Shift', 'L')
    expect(seedGrammarFixAgent).toHaveBeenCalledWith('openai', 'gpt-4o')
    expect(register).toHaveBeenCalledWith(
      'cmd_agents_dyn_agent1', 'Grammar Fix', 'command', 'Super+Shift+L', undefined, 'icon:sparkles',
    )
    expect(res.ok).toBe(true)
  })
  it('returns error when no provider is configured', async () => {
    getDefaultAgent.mockReturnValueOnce(null)
    const res = await setUpHiddenCommand('Super+Shift', 'L')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(seedGrammarFixAgent).not.toHaveBeenCalled()
  })
})
