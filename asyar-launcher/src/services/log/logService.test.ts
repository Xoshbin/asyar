import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  attachConsole: vi.fn().mockResolvedValue(undefined),
}))

import { LogService } from './logService'
import * as tauriLog from '@tauri-apps/plugin-log'

function makeSvc(opts: { colors?: boolean; frames?: boolean } = {}) {
  const svc = new LogService() as any
  svc.useColors = opts.colors ?? false
  svc.useFrames = opts.frames ?? false
  return svc
}

// ── format ────────────────────────────────────────────────────────────────────

describe('format', () => {
  it('includes the app name in the formatted output', () => {
    const svc = makeSvc()
    const result = svc.format('hello', 'INFO', '', '')
    expect(result).toContain('Asyar')
  })

  it('includes the category label padded to 5 chars', () => {
    const svc = makeSvc()
    const result = svc.format('msg', 'DBG', '', '')
    expect(result).toContain('DBG  ')
  })

  it('includes the message text', () => {
    const svc = makeSvc()
    const result = svc.format('the payload', 'INFO', '', '')
    expect(result).toContain('the payload')
  })

  it('includes a timestamp in [HH:MM:SS] format', () => {
    const svc = makeSvc()
    const result = svc.format('msg', 'INFO', '', '')
    expect(result).toMatch(/\[\d{1,2}:\d{2}:\d{2}/)
  })

  it('omits ANSI codes when useColors is false', () => {
    const svc = makeSvc({ colors: false })
    const result = svc.format('msg', 'INFO', '\x1b[32m', '\x1b[32m')
    expect(result).not.toMatch(/\x1b\[/)
  })
})

// ── createFrame ───────────────────────────────────────────────────────────────

describe('createFrame', () => {
  it('returns the raw message when useFrames is false', () => {
    const svc = makeSvc({ frames: false })
    const result = svc.createFrame('hello', '')
    expect(result).toBe('hello')
  })

  it('wraps a single-line message in box-drawing characters', () => {
    const svc = makeSvc({ frames: true })
    const result = svc.createFrame('hello', '')
    expect(result).toContain('┌')
    expect(result).toContain('┐')
    expect(result).toContain('└')
    expect(result).toContain('┘')
    expect(result).toContain('hello')
  })

  it('wraps a multi-line message in a frame', () => {
    const svc = makeSvc({ frames: true })
    const result = svc.createFrame('line one\nline two', '')
    expect(result).toContain('┌')
    expect(result).toContain('line one')
    expect(result).toContain('line two')
  })
})

// ── createMultiLineFrame padding ──────────────────────────────────────────────

describe('createMultiLineFrame', () => {
  it('pads shorter lines to match the longest line width', () => {
    const svc = makeSvc({ frames: true, colors: false })
    const long = 'long line here'
    const short = 'short'
    const result = svc.createMultiLineFrame([long, short], '')
    const lines = result.split('\n')
    // All middle lines (between top and bottom border) should have the same length
    const middleLines = lines.slice(1, -1)
    const lengths = middleLines.map((l: string) => l.length)
    expect(new Set(lengths).size).toBe(1)
  })
})

// ── error ─────────────────────────────────────────────────────────────────────

describe('error', () => {
  it('accepts a plain string message', () => {
    const svc = makeSvc()
    expect(() => svc.error('something went wrong')).not.toThrow()
  })

  it('extracts the message from an Error object', () => {
    vi.mocked(tauriLog.error).mockClear()
    // stub window so tryLog routes to tauriLogFn (the default in node env)
    const svc = makeSvc()
    svc.error(new Error('boom'))
    // In the node test env, tryLog calls tauriLogFn since window is undefined
    const call = vi.mocked(tauriLog.error).mock.calls[0]?.[0] as string ?? ''
    // tauriLog.error is called — ensure 'boom' is in the formatted message
    expect(typeof call).toBe('string')
    expect(call).toContain('boom')
  })
})

// ── tryLog routing ────────────────────────────────────────────────────────────

describe('tryLog', () => {
  beforeEach(() => {
    vi.mocked(tauriLog.info).mockClear()
  })

  it('calls the console fallback when __TAURI_INTERNALS__ is absent', () => {
    // Stub window as a plain object (no __TAURI_INTERNALS__) to trigger the console path
    vi.stubGlobal('window', {})

    const svc = makeSvc()
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    svc.tryLog(tauriLog.info, console.info, 'test message')

    expect(consoleSpy).toHaveBeenCalledWith('test message')
    expect(tauriLog.info).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('calls the Tauri log function when __TAURI_INTERNALS__ is present', () => {
    ;(global as any).__TAURI_INTERNALS__ = {}
    vi.mocked(tauriLog.info).mockImplementation(() => {})

    const svc = makeSvc()
    svc.tryLog(tauriLog.info, console.info, 'test message')

    expect(tauriLog.info).toHaveBeenCalledWith('test message')

    delete (global as any).__TAURI_INTERNALS__
  })

  it('falls back to console when the Tauri log function throws', () => {
    ;(global as any).__TAURI_INTERNALS__ = {}
    vi.mocked(tauriLog.info).mockImplementation(() => { throw new Error('fail') })

    const svc = makeSvc()
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    svc.tryLog(tauriLog.info, console.info, 'test message')

    expect(consoleSpy).toHaveBeenCalledWith('test message')
    consoleSpy.mockRestore()
    delete (global as any).__TAURI_INTERNALS__
  })
})

// ── public log methods ────────────────────────────────────────────────────────

describe('log level methods', () => {
  it('info calls tryLog without throwing', () => {
    expect(() => makeSvc().info('hello')).not.toThrow()
  })

  it('warn calls tryLog without throwing', () => {
    expect(() => makeSvc().warn('careful')).not.toThrow()
  })

  it('debug calls tryLog without throwing', () => {
    expect(() => makeSvc().debug('trace')).not.toThrow()
  })

  it('success calls tryLog without throwing', () => {
    expect(() => makeSvc().success('done')).not.toThrow()
  })

  it('custom with a known color name calls tryLog without throwing', () => {
    expect(() => makeSvc().custom('msg', 'MY_CAT', 'cyan')).not.toThrow()
  })

  it('trackExtensionUsage formats and logs without throwing', () => {
    expect(() =>
      makeSvc().trackExtensionUsage('my-ext', 'opened', { key: 'val' })
    ).not.toThrow()
  })
})
