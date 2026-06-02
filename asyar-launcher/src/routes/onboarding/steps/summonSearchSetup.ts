import { updateShortcut } from '../../../utils/shortcutManager'

export async function saveHotkey(detail: { modifier: string; key: string }): Promise<string | true> {
  const success = await updateShortcut(detail.modifier, detail.key)
  return success ? true : 'Could not set that shortcut'
}
