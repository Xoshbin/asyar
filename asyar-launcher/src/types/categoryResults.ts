import type { ResultCategory } from "./resultCategory";
import type { SearchResultItem } from "./searchResults";

export interface CategoryResults {
  name: string | null | undefined;
  category: ResultCategory;
  title: string;
  items: SearchResultItem[];
}
