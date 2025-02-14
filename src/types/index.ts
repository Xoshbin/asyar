import { Key } from "react";

export type View = "search" | "clipboard" | "plugin";

export interface AppResult {
  name: string;
  path: string;
}

export type ResultCategory =
  | "application"
  | "command"
  | "calculation"
  | "snippet"
  | "clipboard";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  category: ResultCategory;
  icon?: string;
  action: () => Promise<ActionResult>; // Remove void from return type
  score: number; // For ranking results
  metadata?: Record<string, any>;
}

export interface CategoryResults {
  name: Key | null | undefined;
  category: ResultCategory;
  title: string;
  items: SearchResultItem[];
}

export interface SearchResults {
  categories: CategoryResults[];
}

export interface ViewTransitionAction {
  type: "SET_VIEW";
  view: View;
  pluginId?: string;
  viewName?: string;
}

// Different types of actions for search results:
// - SET_VIEW: Returns a view (e.g., clipboard history)
// - NONE: No return value (e.g., opening applications, Performs clipboard action "copy calculator result")
export type ActionResult = {
  type: "SET_VIEW" | "NONE";
  view?: string;
  pluginId?: string;
  viewName?: string;
};
