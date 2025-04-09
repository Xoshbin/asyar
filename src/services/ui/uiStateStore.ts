import { writable } from 'svelte/store';

// Store for the index of the currently selected item in the results list
export const selectedIndex = writable<number>(-1);

// Store to indicate if the main search results are currently loading
export const isSearchLoading = writable<boolean>(false);

// Store to track if the action drawer is open
export const isActionDrawerOpen = writable<boolean>(false);

// Store for the currently selected action index within the drawer
export const selectedActionIndex = writable<number>(0);

// Store for the primary action label provided by the active extension view
export const activeViewPrimaryActionLabel = writable<string | null>(null);

// You can add more UI-related states here as needed,
// for example, focus management state if it becomes complex.
