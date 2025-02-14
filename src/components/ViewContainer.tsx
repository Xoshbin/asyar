import { SearchResults } from "./SearchResults";
import { ClipboardView } from "./ClipboardView";
import { PluginViewContainer } from "./PluginViewContainer";
import type {
  View,
  SearchResults as SearchResultsType,
  ActionResult,
} from "../types";

interface ViewContainerProps {
  view: View;
  searchResults: SearchResultsType;
  selectedIndex: number;
  currentPluginView: { pluginId: string; viewName: string } | null;
  onSelect: (
    action: () => Promise<ActionResult>,
    title?: string
  ) => Promise<void>;
}

export const ViewContainer = ({
  view,
  searchResults,
  selectedIndex,
  currentPluginView,
  onSelect,
}: ViewContainerProps) => {
  const renderView = () => {
    switch (view) {
      case "search":
        return (
          <SearchResults
            categories={searchResults.categories}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
          />
        );
      case "plugin":
        return currentPluginView ? (
          <PluginViewContainer
            key={`${currentPluginView.pluginId}-${currentPluginView.viewName}`}
            pluginId={currentPluginView.pluginId}
            viewName={currentPluginView.viewName}
          />
        ) : null;
      case "clipboard":
        return <ClipboardView />;
      default:
        return <div>Unknown view state</div>;
    }
  };

  return <div className="container expanded">{renderView()}</div>;
};
