import storeExtension from '../../../built-in-features/store/index.svelte'
import { listInstalledExtensions } from '../../../lib/ipc/commands'

const EMOJI_ID = 'org.asyar.emoji'

export async function installEmoji(): Promise<boolean> {
  const installed = (await listInstalledExtensions()) ?? []
  if (installed.includes(EMOJI_ID)) return true
  await storeExtension.installExtension('emoji', EMOJI_ID, 'Emoji')
  return true
}
