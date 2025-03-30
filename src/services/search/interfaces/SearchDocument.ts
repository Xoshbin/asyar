export interface SearchDocument {
  objectID: string; // Unique ID across ALL items
  name: string;
  type: "application" | "command"; // Matches the 'category' from source types
  content: string; // Combined text for full-text search
  // originalData?: any; // Optional: Store original if needed for display
}
