export interface SearchResult {
  objectID: string;
  name: string;
  type: "application" | "command";
  icon?: string;
  score: number;
  action?: string;
  // Add other fields returned by search engine if needed (e.g., highlights)
}
