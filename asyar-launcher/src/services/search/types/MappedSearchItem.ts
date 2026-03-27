/**
 * Shape of a search result after mapping for display in ResultsList.
 * Single source of truth shared by +page.svelte and ResultsList.svelte.
 */
export type MappedSearchItem = {
  object_id: string;
  title: string;
  subtitle?: string;
  /** Internal type used for action filtering (e.g. "command" vs "application") */
  type?: string;
  typeLabel?: string;
  icon?: string;
  score: number;
  style?: "default" | "large";
  shortcut?: string;
  action: () => void;
};
