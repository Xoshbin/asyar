import type { SearchResult as SearchResultBase } from '../../../bindings';

/**
 * Frontend SearchResult extends the Rust-generated base with UI-only fields
 * and narrows the `type` discriminant to its two real values.
 * Base fields stay in sync with Rust automatically via specta.
 */
export interface SearchResult extends Omit<SearchResultBase, 'type'> {
  type: "application" | "command";
  // Frontend-only fields (not in Rust struct):
  action?: string | (() => unknown);
  subtitle?: string;
  description?: string;
  category?: string;
  style?: "default" | "large";
}
