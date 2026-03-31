import { describe, it, expect, vi } from 'vitest'
import { Command } from 'commander'
import { registerAttach } from './attach'

describe('attach command', () => {
  it('registers the attach command correctly', () => {
    const program = new Command()
    registerAttach(program)
    const command = (program as any)._commands.find((c: any) => c._name === 'attach')
    expect(command).toBeDefined()
    expect(command._description).toBe('Register an extension directory for dev loading in the launcher')
  })
})
