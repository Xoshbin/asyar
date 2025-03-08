import type { ResultCategory } from "./ResultCategoryType";
import type { SearchResultItem } from "./SearchResultsType";

export interface CategoryResults {
  name: string | null | undefined;
  category: ResultCategory;
  title: string;
  items: SearchResultItem[];
}
