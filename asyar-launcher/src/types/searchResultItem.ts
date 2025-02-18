import type { ActionResult } from "./actionResult";
import type { ResultCategory } from "./resultCategory";

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
