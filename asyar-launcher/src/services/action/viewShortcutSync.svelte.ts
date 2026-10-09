import { untrack } from 'svelte';
import { isBuiltInFeature } from '../extension/extensionDiscovery';
import { extensionIframeManager } from '../extension/extensionIframeManager.svelte';
import { viewManager } from '../extension/viewManager.svelte';
import { actionService } from './actionService.svelte';
import { actionShortcuts } from './actionShortcuts';

/**
 * Keeps a Tier 2 view iframe informed of the action shortcuts that are live in
 * it. Key presses inside an iframe never reach the launcher window, so the
 * SDK forwarder needs to know which chords to hand across; the launcher owns
 * dispatch and announces the answer here.
 *
 * The contract is plain data — the full current set of physical chord strings
 * — sent whenever it changes and on every fresh iframe load (a view that mounts
 * after the last announcement would otherwise start with an empty set).
 * Built-in views are same-window and receive keys directly, so they are skipped.
 */
const lastSent = new Map<string, string>();

export function announceActiveViewShortcuts(opts: { force?: boolean } = {}): void {
  const view = viewManager.activeView;
  if (!view) return;
  const extensionId = view.split('/')[0];
  if (isBuiltInFeature(extensionId)) return;

  const chords = actionShortcuts.activeChords().sort();
  const signature = chords.join('|');
  if (!opts.force && lastSent.get(extensionId) === signature) return;
  lastSent.set(extensionId, signature);
  extensionIframeManager.sendActionShortcuts(extensionId, chords);
}

/** Re-announces on every change of view or of the visible actions. */
export function startViewShortcutSync(): () => void {
  return $effect.root(() => {
    $effect(() => {
      // Dependencies: which view is active and which actions are visible.
      void viewManager.activeView;
      void actionService.filteredActions;
      untrack(() => announceActiveViewShortcuts());
    });
  });
}
