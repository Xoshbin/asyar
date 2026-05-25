/**
 * Shortcode regex used to validate keys passed to `registerShortcodes`.
 * The launcher uses a byte-equivalent Rust regex (`snippets.rs`). See
 * `shortcode-pattern.contract.test.ts` for the cross-side equivalence check.
 */
export const SHORTCODE_PATTERN = /^:[a-z0-9_+-]{1,32}:$/;

export function isValidShortcode(key: string): boolean {
  return SHORTCODE_PATTERN.test(key);
}

/**
 * `:shortcode:` → expansion string. Expansion is *exactly one grapheme cluster*
 * for emoji use, but the contract does not enforce this — any text is allowed.
 * Keys must match SHORTCODE_PATTERN; the proxy rejects malformed entries before
 * dispatch.
 */
export type ShortcodeMap = Record<string, string>;

export interface ISnippetsService {
  /**
   * Contribute a static dictionary of shortcode → expansion pairs to the
   * launcher's global keystroke matcher. Calling again replaces the calling
   * extension's previous contribution wholesale. Requires the
   * `snippets:contribute` permission.
   *
   * Keys must match SHORTCODE_PATTERN. Malformed entries cause the proxy to
   * reject the whole call with an error — partial registration is not allowed.
   */
  registerShortcodes(map: ShortcodeMap): Promise<void>;

  /** Remove the calling extension's entire contribution. Idempotent. */
  unregisterShortcodes(): Promise<void>;

  /**
   * Return all AI-learned shortcode → emoji pairs that are currently cached
   * (i.e. shortcodes the inline emoji fallback resolved at least once).
   * Requires the `snippets:contribute` permission.
   */
  listLearnedShortcodes(): Promise<Array<[string, string]>>;

  /**
   * Promote an AI-learned shortcode to a permanent user snippet and remove it
   * from the learned cache. The launcher emits `snippet:promote-from-cache` and
   * the main window persists the entry via the existing snippets storage path.
   */
  promoteLearnedShortcode(shortcode: string): Promise<void>;

  /** Remove a single cached AI-learned shortcode entry. */
  forgetLearnedShortcode(shortcode: string): Promise<void>;

  /** Clear all AI-learned shortcode cache entries. */
  clearLearnedShortcodes(): Promise<void>;

  /**
   * Enable or disable the launcher's inline AI fallback for unmatched
   * `:shortcodes:`. When disabled, the dispatcher silently no-ops on every
   * shortcode-miss event. Requires the `snippets:contribute` permission.
   */
  setInlineFallbackEnabled(enabled: boolean): Promise<void>;
}
