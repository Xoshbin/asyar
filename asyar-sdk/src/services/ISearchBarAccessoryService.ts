import type {
  SearchBarAccessorySetOptions,
  SearchBarAccessoryListener,
} from '../types/SearchBarAccessoryType';

/**
 * Per-view-mode-command searchbar accessory. The launcher chrome owns
 * the visible dropdown; this interface is what view-mode extension code
 * uses to declare options dynamically and react to selection changes.
 *
 * Seeding contract: when the view mounts, the launcher pushes the
 * active accessory's current value as a `filterChange` event. Handlers
 * registered via `onChange` receive that seed value through normal event
 * delivery — `onChange` itself does not synthesize a separate seed call.
 * Call order of `set()` / `onChange()` during the view's lifetime is
 * not significant.
 */
export interface ISearchBarAccessoryService {
  set(opts: SearchBarAccessorySetOptions): Promise<void>;
  clear(): Promise<void>;
  onChange(handler: SearchBarAccessoryListener): () => void;
}
