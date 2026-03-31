import { describe, it, expect, vi } from 'vitest'
import { Command } from 'commander'
import { registerDetach } from './detach'

describe('detach command', () => {
  it('registers the detach command correctly', () => {
    const program = new Command()
    registerDetach(program)
    const command = (program as any)._commands.find((c: any) => c._name === 'detach')
    expect(command).toBeDefined()
    expect(command._description).toBe('Unregister a dev extension from the launcher')
  })
})
