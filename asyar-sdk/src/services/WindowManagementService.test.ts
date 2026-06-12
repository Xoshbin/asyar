import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(),
  },
}))

import { messageBroker } from '../ipc/MessageBroker'
import { WindowManagementServiceProxy } from './WindowManagementService'

describe('WindowManagementServiceProxy', () => {
  let mockBroker: { invoke: ReturnType<typeof vi.fn> }
  let proxy: WindowManagementServiceProxy

  beforeEach(() => {
    vi.clearAllMocks()
    mockBroker = messageBroker as any
    proxy = new WindowManagementServiceProxy()
  })

  it('getWindowBounds calls correct IPC key', async () => {
    const bounds = { x: 0, y: 0, width: 1280, height: 800 }
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(bounds)

    const result = await proxy.getWindowBounds()

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:getWindowBounds')
    expect(result).toEqual(bounds)
  })

  it('setWindowBounds calls correct IPC key with partial update', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.setWindowBounds({ width: 800, height: 600 })

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'window:setWindowBounds',
      { x: undefined, y: undefined, width: 800, height: 600 }
    )
  })

  it('setFullscreen calls correct IPC key with enable=true', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.setFullscreen(true)

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'window:setFullscreen',
      { enable: true }
    )
  })

  it('setFullscreen calls correct IPC key with enable=false', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.setFullscreen(false)

    expect(mockBroker.invoke).toHaveBeenCalledWith(
      'window:setFullscreen',
      { enable: false }
    )
  })

  it('getMonitors calls correct IPC key', async () => {
    const monitors = [{ x: 0, y: 0, width: 1920, height: 1080 }]
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(monitors)

    const result = await proxy.getMonitors()

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:getMonitors')
    expect(result).toEqual(monitors)
  })

  it('applyPreset calls correct IPC key', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(undefined)

    await proxy.applyPreset('left-half')

    expect(mockBroker.invoke).toHaveBeenCalledWith('window:applyPreset', { presetId: 'left-half' })
  })
})
