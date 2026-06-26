import { invokeSafe, invokeSafeVoid } from './invokeSafe';

// `contribute_shortcodes`/`revoke_shortcodes`/`promote_learned_to_snippet`/
// `set_inline_emoji_fallback_enabled`/`record_inline_emoji_fallback_outcome`
// are all `Result<(), AppError>` on the Rust side — Ok(()) and invokeSafe's
// failure sentinel both serialize to `null`, so these use invokeSafeVoid's
// boolean signal instead. `list_learned_shortcodes`/`forget_learned_shortcode`/
// `clear_learned_shortcodes` are plain (non-Result) commands and keep invokeSafe.

export async function contributeShortcodes(
  extensionId: string | undefined,
  map: Record<string, string>,
): Promise<boolean> {
  return invokeSafeVoid('contribute_shortcodes', { extensionId, map });
}

export async function revokeShortcodes(extensionId: string | undefined): Promise<boolean> {
  return invokeSafeVoid('revoke_shortcodes', { extensionId });
}

export async function listLearnedShortcodes(): Promise<[string, string][] | null> {
  return invokeSafe<[string, string][]>('list_learned_shortcodes');
}

export async function promoteLearnedToSnippet(shortcode: string): Promise<boolean> {
  return invokeSafeVoid('promote_learned_to_snippet', { shortcode });
}

export async function forgetLearnedShortcode(shortcode: string): Promise<void> {
  await invokeSafe('forget_learned_shortcode', { shortcode });
}

export async function clearLearnedShortcodes(): Promise<void> {
  await invokeSafe('clear_learned_shortcodes');
}

export async function setInlineEmojiFallbackEnabled(enabled: boolean): Promise<boolean> {
  return invokeSafeVoid('set_inline_emoji_fallback_enabled', { enabled });
}

export async function recordInlineEmojiFallbackOutcome(
  shortcode: string,
  outcome: 'hit' | 'miss',
  emoji: string | undefined,
): Promise<boolean> {
  return invokeSafeVoid('record_inline_emoji_fallback_outcome', { shortcode, outcome, emoji });
}
