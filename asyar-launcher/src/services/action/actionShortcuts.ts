import { getHostPlatform } from '../../lib/keyboard/hostPlatform';
import { logService } from '../log/logService';
import { actionService } from './actionService.svelte';
import { createActionShortcutDispatcher, isActionOverlayOpen } from './actionShortcutDispatcher';
import { invokeAction } from './invokeAction';

/**
 * The app's one action shortcut dispatcher, bound to the real `actionService`.
 * `launcherKeyboard` routes keydown through `handle`; the Tier 2 shortcut sync
 * reads `activeChords`. Both talk to this instance so there is exactly one
 * answer to "which chords are live right now".
 */
export const actionShortcuts = createActionShortcutDispatcher({
  getCandidates: () => actionService.getShortcutCandidates(),
  run: invokeAction,
  platform: getHostPlatform(),
  isSuppressed: () => typeof document !== 'undefined' && isActionOverlayOpen(document),
  warn: (message) => logService.warn(`[ActionShortcuts] ${message}`),
});
