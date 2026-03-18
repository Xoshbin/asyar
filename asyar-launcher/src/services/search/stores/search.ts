import { writable } from "svelte/store";
import type { SearchResult } from "../interfaces/SearchResult";

export const searchQuery = writable("");
