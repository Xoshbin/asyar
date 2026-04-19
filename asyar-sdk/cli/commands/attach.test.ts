import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { registerAttach } from './attach'

describe('attach command', () => {
  it('registers the attach command correctly', () => {
    const program = new Command()
    registerAttach(program)
    const command = program.commands.find((c) => c.name() === 'attach')
    expect(command).toBeDefined()
    expect(command!.description()).toBe(
      'Register an extension directory for dev loading in the launcher'
    )
  })
})
