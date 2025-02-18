import type { ResultCategory } from "./resultCategory";
import type { SearchResultItem } from "./searchResultItem";

export interface CategoryResults {
  name: string | null | undefined;
  category: ResultCategory;
  title: string;
  items: SearchResultItem[];
}
