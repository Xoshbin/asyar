import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { registerDetach } from './detach'

describe('detach command', () => {
  it('registers the detach command correctly', () => {
    const program = new Command()
    registerDetach(program)
    const command = program.commands.find((c) => c.name() === 'detach')
    expect(command).toBeDefined()
    expect(command!.description()).toBe('Unregister a dev extension from the launcher')
  })
})
