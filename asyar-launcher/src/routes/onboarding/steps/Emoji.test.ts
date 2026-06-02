import { describe, it, expect, vi, beforeEach } from 'vitest'

const installExtension = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const listInstalledExtensions = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('../../../built-in-features/store/index.svelte', () => ({ default: { installExtension } }))
vi.mock('../../../lib/ipc/commands', () => ({ listInstalledExtensions }))

import { installEmoji } from './emojiSetup'

describe('installEmoji', () => {
  beforeEach(() => vi.clearAllMocks())
  it('installs the emoji extension when missing', async () => {
    const did = await installEmoji()
    expect(installExtension).toHaveBeenCalledWith('emoji', 'org.asyar.emoji', 'Emoji')
    expect(did).toBe(true)
  })
  it('skips install when already present', async () => {
    listInstalledExtensions.mockResolvedValueOnce(['org.asyar.emoji'])
    const did = await installEmoji()
    expect(installExtension).not.toHaveBeenCalled()
    expect(did).toBe(true)
  })
})
