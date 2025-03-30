import { writable } from "svelte/store";
import type { SearchResult } from "../interfaces/SearchResult";

export const searchQuery = writable("");
export const searchResults = writable<{
  extensions: SearchResult[];
  applications: SearchResult[];
  selectedIndex: number;
}>({
  extensions: [],
  applications: [],
  selectedIndex: 0,
});
