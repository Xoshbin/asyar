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

// Store for the secondary status message (like a loading indicator) provided by the active extension view
export const activeViewStatusMessage = writable<string | null>(null);

// You can add more UI-related states here as needed,
// for example, focus management state if it becomes complex.

// Store to track if the active iframe extension has an input focused
export const extensionHasInputFocus = writable<boolean>(false);

// Signal to activate a specific context mode provider from outside +page.svelte (e.g., keyboard shortcut)
export const contextActivationId = writable<string | null>(null);

// Store to signal that ShortcutCapture is active and owns all keyboard input
export const isCapturingShortcut = writable<boolean>(false);
