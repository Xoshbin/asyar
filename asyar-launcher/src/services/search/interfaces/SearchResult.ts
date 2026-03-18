export interface SearchResult {
  objectId: string;
  name: string;
  type: "application" | "command";
  icon?: string;
  score: number;
  action?: string | (() => any); // Allow string or function
  path?: string;
  subtitle?: string;
  description?: string;
  category?: string;
  extensionId?: string;
  style?: "default" | "large";
  // Add other fields returned by search engine if needed (e.g., highlights)
}
