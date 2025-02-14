import React from "react";
import type {
  SearchResults as SearchResultsType,
  ActionResult,
} from "../types";

interface SearchResultsProps {
  categories: SearchResultsType["categories"];
  selectedIndex: number;
  onSelect: (
    action: () => Promise<ActionResult>,
    title?: string
  ) => Promise<void>;
}

export const SearchResults = ({
  categories,
  selectedIndex,
  onSelect,
}: SearchResultsProps) => {
  if (!categories.length) {
    return <div className="no-results">No results found</div>;
  }

  let currentIndex = 0;

  return (
    <div className="search-results">
      {categories.map((category) => (
        <div key={category.name} className="category">
          <div className="items">
            {category.items.map((item) => {
              const isSelected = currentIndex++ === selectedIndex;
              return (
                <div
                  key={item.title}
                  className={`item ${isSelected ? "selected" : ""}`}
                  onClick={() => onSelect(item.action, item.title)}
                >
                  <div className="result-icon">
                    {typeof item.icon === "string" ? (
                      <img src={item.icon} alt="" className="app-icon" />
                    ) : (
                      <span className="material-symbols-outlined">
                        {item.icon || "radio_button_unchecked"}
                      </span>
                    )}
                  </div>
                  <div className="result-content">
                    <div className="result-title">{item.title}</div>
                    {item.subtitle && (
                      <div className="result-subtitle">{item.subtitle}</div>
                    )}
                  </div>
                  <div className={`result-category category-${item.category}`}>
                    {category.title}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
