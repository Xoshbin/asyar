import { useState, useCallback, useEffect, useMemo } from "react";
import useEscape from "../hooks/useEscape";
import { ViewContainer } from "./ViewContainer";
import type {
  View,
  SearchResults as SearchResultsType,
  ActionResult,
  ResultCategory,
} from "../types";
import { load } from "@tauri-apps/plugin-store";
import "../styles/App.css";
import { SearchHandler } from "../services/SearchHandler";
import { discoverExtensions } from "../services/extensionDiscovery";
import { extensionManager } from "../services/extensionManagerInstance";
import { loadExtension } from "../services/extensionLoader";
import { SuggestionService } from "../services/SuggestionService";
import { ActionHandlerService } from "../services/ActionHandlerService";
import { log } from "../api/services/log";

function AppContent() {
  const suggestionService = useMemo(() => new SuggestionService(), []);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("search");
  useEscape({
    view,
    query,
    onBack: () => {},
  });
  const [searchResults, setSearchResults] = useState<SearchResultsType>({
    categories: [],
  });
  const [store, setStore] = useState<any>(null);
  const [currentExtensionView, setCurrentExtensionView] = useState<{
    extensionId: string;
    viewName: string;
  } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actionHandler = useMemo(() => new ActionHandlerService(store), [store]);

  const handleSelect = useCallback(
    async (
      action: () => Promise<ActionResult>,
      title?: string,
      category?: string
    ) => {
      try {
        if (title && category) {
          suggestionService.trackSelection(title, category);
          await SearchHandler.updateSearchHistory(store, title);
        }

        const result = await action();
        if (result?.type === "SET_VIEW" && result.view) {
          if (result.view === "extension") {
            setCurrentExtensionView({
              extensionId: result.extensionId!,
              viewName: result.viewName!,
            });
          }
          setView(result.view as View);
          setQuery("");
          setSearchResults({ categories: [] });
        }
      } catch (error) {
        log.error(`Selection error: ${error}`);
      }
    },
    [store, suggestionService]
  );

  const getSelectedItem = useCallback(() => {
    let currentIndex = 0;
    for (const category of searchResults.categories) {
      for (const item of category.items) {
        if (currentIndex === selectedIndex) {
          return item;
        }
        currentIndex++;
      }
    }
    return null;
  }, [searchResults, selectedIndex]);

  const handleKeyboardSelect = useCallback(() => {
    const selectedItem = getSelectedItem();
    if (selectedItem) {
      handleSelect(
        selectedItem.action,
        selectedItem.title,
        selectedItem.category
      );
    }
  }, [getSelectedItem, handleSelect]);

  const totalItems = searchResults.categories.reduce(
    (sum: number, category) => sum + category.items.length,
    0
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (totalItems === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % totalItems);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
          break;
        case "Enter":
          e.preventDefault();
          handleKeyboardSelect();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalItems, handleKeyboardSelect]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  useEffect(() => {
    const initializeApp = async () => {
      const newStore = await load("search_history.json");
      setStore(newStore);
      // Show initial suggestions
      setSearchResults(getSuggestionsAsSearchResults());
    };
    initializeApp();
  }, []); // Replace the existing store initialization effect

  useEffect(() => {
    const initializeExtensions = async () => {
      try {
        log.info("Discovering extensions...");
        const discoveredExtensions = await discoverExtensions();

        for (const extensionId of discoveredExtensions) {
          const extension = await loadExtension(extensionId);
          if (extension) {
            await extensionManager.loadExtension(extension);
            log.info(`Initialized extension: ${extensionId}`);
          }
        }
      } catch (error) {
        log.error(`Failed to initialize extensions: ${error}`);
      }
    };

    initializeExtensions();
  }, []);

  const getSuggestionsAsSearchResults = useCallback((): SearchResultsType => {
    const suggestions = suggestionService.getSuggestions();
    if (suggestions.length === 0) return { categories: [] };

    return {
      categories: [
        {
          name: "Recent Items",
          items: suggestions.map((suggestion) => ({
            id: suggestion.title,
            score: 1,
            title: suggestion.title,
            category: suggestion.category as ResultCategory,
            action: () =>
              actionHandler.executeAction(
                suggestion.title,
                suggestion.category
              ),
          })),
          category: "command" as ResultCategory,
          title: "Suggestions",
        },
      ],
    };
  }, [suggestionService, actionHandler]);

  const handleSearch = useCallback(
    async (value: string) => {
      try {
        if (!value.trim()) {
          setSearchResults(getSuggestionsAsSearchResults());
          return;
        }

        const results = await SearchHandler.handleSearch(value, store);
        if (results.categories.length > 0) {
          setSearchResults(results);
        } else {
          const extensionResults = await extensionManager.search(value);
          if (extensionResults.length > 0) {
            setSearchResults({
              categories: [
                {
                  name: "Extensions",
                  items: extensionResults,
                  category: "command",
                  title: "",
                },
              ],
            });
          } else {
            setSearchResults({ categories: [] });
          }
        }
      } catch (error) {
        log.error(`Search error: ${error}`);
        setSearchResults({ categories: [] });
      }
    },
    [store, getSuggestionsAsSearchResults]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setQuery(newValue);
      handleSearch(newValue);
    },
    [handleSearch]
  );

  const handleBack = useCallback(() => {
    if (view !== "search") {
      setView("search");
      setCurrentExtensionView(null);
    }
    setQuery("");
    setSearchResults({ categories: [] });
  }, [view]);

  useEscape({
    view,
    query,
    onBack: handleBack,
  });

  return (
    <div className="spotlight-wrapper">
      <input
        type="text"
        className="search-input"
        placeholder="Search applications, calculate, or type 'cl' for clipboard..."
        autoFocus
        value={query}
        onChange={handleInputChange}
        autoComplete="off"
        spellCheck={false}
      />

      <ViewContainer
        view={view}
        searchResults={searchResults}
        selectedIndex={selectedIndex}
        currentExtensionView={currentExtensionView}
        onSelect={handleSelect}
      />
    </div>
  );
}

export default AppContent;
