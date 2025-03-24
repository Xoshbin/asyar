import type { ActionResult } from "./ActionResultType";
import type { CategoryResults } from "./CategoryResultsType";
import type { ResultCategory } from "./ResultCategoryType";

export interface SearchResults {
  categories: CategoryResults[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  category: ResultCategory;
  icon?: string;
  action: () => Promise<ActionResult>;
  score: number; // For ranking results
  metadata?: Record<string, any>;
}
