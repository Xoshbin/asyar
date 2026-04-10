import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { InteropService, LaunchCommandError, type InteropDeps } from './interopService.svelte'
import { logService } from '../log/logService'

describe('InteropService', () => {
  let service: InteropService
  let deps: InteropDeps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = {
      hasCommand: vi.fn().mockReturnValue(false),
      getManifestById: vi.fn().mockReturnValue(undefined),
      handleCommandAction: vi.fn().mockResolvedValue(undefined),
    }
    service = new InteropService(deps)
  })

  it('calls handleCommandAction with correct objectId and args', async () => {
    vi.mocked(deps.hasCommand).mockReturnValue(true)
    const args = { query: '5+3' }

    await service.launchCommand('com.caller', 'com.example.calc', 'run', args)

    expect(deps.handleCommandAction).toHaveBeenCalledWith('cmd_com.example.calc_run', args)
  })

  it('logs callerExtensionId on every invocation', async () => {
    vi.mocked(deps.hasCommand).mockReturnValue(true)

    await service.launchCommand('com.caller', 'com.target', 'cmd')

    expect(logService.debug).toHaveBeenCalledWith('[InteropService] com.caller → com.target/cmd')
  })

  it('throws LaunchCommandError with EXTENSION_NOT_FOUND if extension is not installed', async () => {
    vi.mocked(deps.getManifestById).mockReturnValue(undefined)

    const error = await service.launchCommand('caller', 'unknown', 'run').catch((e) => e)

    expect(error).toBeInstanceOf(LaunchCommandError)
    expect(error.code).toBe('EXTENSION_NOT_FOUND')
  })

  it('throws LaunchCommandError with COMMAND_NOT_FOUND if command does not exist', async () => {
    vi.mocked(deps.getManifestById).mockReturnValue({ id: 'com.example.calc' })

    const error = await service.launchCommand('caller', 'com.example.calc', 'nonexistent').catch((e) => e)

    expect(error).toBeInstanceOf(LaunchCommandError)
    expect(error.code).toBe('COMMAND_NOT_FOUND')
  })

  it('passes undefined args through without error', async () => {
    vi.mocked(deps.hasCommand).mockReturnValue(true)

    await service.launchCommand('caller', 'com.target', 'cmd')

    expect(deps.handleCommandAction).toHaveBeenCalledWith('cmd_com.target_cmd', undefined)
  })
})
