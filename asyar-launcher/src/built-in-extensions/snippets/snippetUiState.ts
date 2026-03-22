import { writable } from 'svelte/store';
export const snippetEditorTrigger = writable<'add' | null>(null);
