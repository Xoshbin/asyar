import { writable } from "svelte/store";

export const lastCalculatorQuery = writable<string>("");

// Manage an array of prior queries + inputs if necessary globally
