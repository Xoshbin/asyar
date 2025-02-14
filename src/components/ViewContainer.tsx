import { SearchResults } from "./SearchResults";
import { ClipboardView } from "./ClipboardView";

import type {
  View,
  SearchResults as SearchResultsType,
  ActionResult,
} from "../types";
import { ExtensionViewContainer } from "./ExtensionViewContainer";

interface ViewContainerProps {
  view: View;
  searchResults: SearchResultsType;
  selectedIndex: number;
  currentExtensionView: { extensionId: string; viewName: string } | null;
  onSelect: (
    action: () => Promise<ActionResult>,
    title?: string
  ) => Promise<void>;
}

export const ViewContainer = ({
  view,
  searchResults,
  selectedIndex,
  currentExtensionView,
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
      case "extension":
        return currentExtensionView ? (
          <ExtensionViewContainer
            key={`${currentExtensionView.extensionId}-${currentExtensionView.viewName}`}
            extensionId={currentExtensionView.extensionId}
            viewName={currentExtensionView.viewName}
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
