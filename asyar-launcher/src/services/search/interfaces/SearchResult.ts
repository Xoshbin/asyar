export interface SearchResult {
  objectId: string;
  name: string;
  type: "application" | "command";
  icon?: string;
  score: number;
  action?: string | (() => any); // Allow string or function
  path?: string;
  // Add other fields returned by search engine if needed (e.g., highlights)
}
