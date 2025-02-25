import { writable } from "svelte/store";

function createClipboardViewState() {
  const { subscribe, set, update } = writable({
    searchQuery: "",
    filtered: false,
    lastSearch: Date.now(),
  });

  return {
    subscribe,
    setSearch: (query: string) =>
      update((state) => ({
        ...state,
        searchQuery: query,
        filtered: query.length > 0,
        lastSearch: Date.now(),
      })),
    reset: () =>
      set({
        searchQuery: "",
        filtered: false,
        lastSearch: Date.now(),
      }),
  };
}

export const clipboardViewState = createClipboardViewState();
