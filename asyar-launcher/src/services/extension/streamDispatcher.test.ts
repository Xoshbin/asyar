import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the origin helper and logger before importing the dispatcher
vi.mock('$lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn((id: string) => `asyar-extension://${id}`),
}))
vi.mock('../log/logService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn(), custom: vi.fn() },
}))

// We'll try to import from the file that doesn't exist yet
// @ts-ignore - file won't exist initially
import { StreamDispatcher } from './streamDispatcher.svelte'
import { logService } from '../log/logService'

function makeIframe(extensionId: string) {
  const postMessage = vi.fn()
  const iframe = {
    contentWindow: { postMessage },
    dataset: { extensionId },
  } as unknown as HTMLIFrameElement
  return { iframe, postMessage }
}

describe('StreamDispatcher', () => {
  let dispatcher: StreamDispatcher
  let querySpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // @ts-ignore
    dispatcher = new StreamDispatcher()
    vi.clearAllMocks()
    querySpy = vi.fn()
    vi.stubGlobal('document', { querySelector: querySpy })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sendChunk posts asyar:stream chunk message to the correct iframe', () => {
    const { iframe, postMessage } = makeIframe('ext-1')
    querySpy.mockReturnValue(iframe)

    const handle = dispatcher.create('ext-1', 'stream-abc')
    handle.sendChunk({ token: 'hello' })

    expect(querySpy).toHaveBeenCalledWith('iframe[data-extension-id="ext-1"]')
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'asyar:stream', streamId: 'stream-abc', phase: 'chunk', data: { token: 'hello' } },
      'asyar-extension://ext-1',
    )
  })

  it('sendDone posts done message and removes stream from map', () => {
    const { iframe, postMessage } = makeIframe('ext-1')
    querySpy.mockReturnValue(iframe)

    const handle = dispatcher.create('ext-1', 'stream-abc')
    handle.sendDone(0)

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'asyar:stream', streamId: 'stream-abc', phase: 'done', data: { exitCode: 0 } },
      'asyar-extension://ext-1',
    )
    // After sendDone, further sendChunk is a no-op
    handle.sendChunk({ token: 'late' })
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('sendError posts error wrapped in data field (matches ShellServiceProxy data?.error)', () => {
    const { iframe, postMessage } = makeIframe('ext-1')
    querySpy.mockReturnValue(iframe)

    const handle = dispatcher.create('ext-1', 'stream-abc')
    handle.sendError({ code: 'provider_error', message: 'rate limited' })

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:stream',
        streamId: 'stream-abc',
        phase: 'error',
        data: { error: { code: 'provider_error', message: 'rate limited' } },
      },
      'asyar-extension://ext-1',
    )
    handle.sendChunk({ token: 'late' })
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('sendDone forwards exitCode in data field (matches ShellServiceProxy data?.exitCode)', () => {
    const { iframe, postMessage } = makeIframe('ext-1')
    querySpy.mockReturnValue(iframe)

    const handle = dispatcher.create('ext-1', 'stream-abc')
    handle.sendDone(0)

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'asyar:stream', streamId: 'stream-abc', phase: 'done', data: { exitCode: 0 } },
      'asyar-extension://ext-1',
    )
  })

  it('sendDone with no exitCode sends data with undefined exitCode', () => {
    const { iframe, postMessage } = makeIframe('ext-1')
    querySpy.mockReturnValue(iframe)

    const handle = dispatcher.create('ext-1', 'stream-abc')
    handle.sendDone()

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'asyar:stream', streamId: 'stream-abc', phase: 'done', data: { exitCode: undefined } },
      'asyar-extension://ext-1',
    )
  })

  it('abort() triggers onAbort callbacks', () => {
    querySpy.mockReturnValue(null)
    const onAbort = vi.fn()

    const handle = dispatcher.create('ext-1', 'stream-abc')
    handle.onAbort(onAbort)
    dispatcher.abort('stream-abc')

    expect(onAbort).toHaveBeenCalledOnce()
  })

  it('abort() on unknown streamId is a no-op', () => {
    // must not throw
    expect(() => dispatcher.abort('non-existent')).not.toThrow()
  })

  it('sendChunk after abort is a no-op', () => {
    const { iframe, postMessage } = makeIframe('ext-1')
    querySpy.mockReturnValue(iframe)

    const handle = dispatcher.create('ext-1', 'stream-abc')
    dispatcher.abort('stream-abc')
    handle.sendChunk({ token: 'too late' })

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('create() with a duplicate streamId throws', () => {
    querySpy.mockReturnValue(null)
    dispatcher.create('ext-1', 'dup-stream')
    expect(() => dispatcher.create('ext-1', 'dup-stream')).toThrow('already active')
  })

  it('warns and does not throw when target iframe is missing', () => {
    querySpy.mockReturnValue(null)
    const handle = dispatcher.create('ext-1', 'stream-abc')
    expect(() => handle.sendChunk({ token: 'x' })).not.toThrow()
    expect(logService.warn).toHaveBeenCalledWith(
      expect.stringContaining('ext-1'),
    )
  })

  it('two concurrent streams to different extensions do not interfere', () => {
    const { iframe: iframe1, postMessage: pm1 } = makeIframe('ext-1')
    const { iframe: iframe2, postMessage: pm2 } = makeIframe('ext-2')
    querySpy.mockImplementation((selector: string) => {
      if (selector.includes('ext-1')) return iframe1
      if (selector.includes('ext-2')) return iframe2
      return null
    })

    const h1 = dispatcher.create('ext-1', 'stream-1')
    const h2 = dispatcher.create('ext-2', 'stream-2')

    h1.sendChunk({ token: 'a' })
    h2.sendChunk({ token: 'b' })
    h1.sendDone()
    h2.sendDone()

    expect(pm1).toHaveBeenCalledTimes(2)
    expect(pm2).toHaveBeenCalledTimes(2)
    // Each stream routed to its own iframe
    expect(pm1.mock.calls[0][0]).toMatchObject({ streamId: 'stream-1' })
    expect(pm2.mock.calls[0][0]).toMatchObject({ streamId: 'stream-2' })
  })
})
