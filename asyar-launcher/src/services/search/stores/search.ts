import { writable } from "svelte/store";
import type { SearchResult } from "../interfaces/SearchResult";

export const searchQuery = writable("");
export const selectedIndex = writable<number>(-1);
export const isSearchLoading = writable<boolean>(false);
