import { writable } from "svelte/store";
import type { AppResult } from "../types";
import type { ExtensionResult } from "../types/ExtensionType";

export const searchQuery = writable("");
export const searchResults = writable<{
  extensions: ExtensionResult[];
  applications: AppResult[];
  selectedIndex: number;
}>({
  extensions: [],
  applications: [],
  selectedIndex: 0,
});
