/**
 * Per-option shape used by the dropdown variant of a searchbar accessory.
 * Mirrors `CommandArgumentDropdownOption` intentionally — same wire shape,
 * but kept as a distinct type so the two features can evolve independently.
 */
export interface SearchBarAccessoryDropdownOption {
  value: string;
  title: string;
}

/**
 * Manifest declaration for a per-command searchbar accessory. Only
 * `dropdown` is supported in v1; the discriminator field reserves room
 * for future types without breaking the schema shape.
 */
export interface SearchBarAccessoryManifestDeclaration {
  type: "dropdown";
  default?: string;
  options: SearchBarAccessoryDropdownOption[];
}

/**
 * Imperative override shape used by `ISearchBarAccessoryService.set`.
 * `options` replaces the dropdown's option list (or supplies it when the
 * manifest didn't); `value` is a programmatic selection that also fires
 * `onChange` handlers.
 */
export interface SearchBarAccessorySetOptions {
  options?: SearchBarAccessoryDropdownOption[];
  value?: string;
}

/**
 * Listener signature for `ISearchBarAccessoryService.onChange`. Called
 * with the seed value once on subscribe, then on every user pick or
 * programmatic `set({ value })`.
 */
export type SearchBarAccessoryListener = (value: string) => void;
