import { Key } from "react";
import { SearchResultItem } from "./searchResultItem";
import { ResultCategory } from "./resultCategory";

export interface CategoryResults {
  name: Key | null | undefined;
  category: ResultCategory;
  title: string;
  items: SearchResultItem[];
}
