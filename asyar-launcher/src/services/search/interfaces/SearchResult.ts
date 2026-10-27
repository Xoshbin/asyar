import type { SearchResult as SearchResultBase } from '../../../bindings';
import type { BuiltinRowAction } from '../builtinSearchProviders';

/**
 * Frontend SearchResult extends the Rust-generated base with UI-only fields
 * and narrows the `type` discriminant to its real values.
 * Base fields stay in sync with Rust automatically via specta.
 */
export interface SearchResult extends Omit<SearchResultBase, 'type'> {
  type: 'application' | 'command' | 'file' | 'scope';
  // Frontend-only fields (not in Rust struct):
  action?: string | (() => unknown);
  /** ⌘K actions contributed by the owning built-in for this row. */
  rowActions?: BuiltinRowAction[];
  /** Bottom-bar Enter label supplied by the owning built-in; falls back to the type default. */
  primaryActionLabel?: string;
  subtitle?: string;
  description?: string;
  category?: string;
  style?: 'default' | 'large';
  /** `'hint'` draws the row in the shared hint look (an offer, not a result). */
  variant?: 'hint';
}
