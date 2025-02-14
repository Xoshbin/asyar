import React, { useEffect } from "react";
import { extensionManager } from "../services/extensionManagerInstance";
import { info, error } from "@tauri-apps/plugin-log";

interface ExtensionViewContainerProps {
  extensionId: string;
  viewName: string;
}

export const ExtensionViewContainer: React.FC<ExtensionViewContainerProps> = ({
  extensionId,
  viewName,
}) => {
  useEffect(() => {
    info(`Rendering extension view: ${extensionId}/${viewName}`);
  }, [extensionId, viewName]);

  const ViewComponent = extensionManager.getExtensionView(
    extensionId,
    viewName
  );

  if (!ViewComponent) {
    error(`Extension view not found: ${extensionId}/${viewName}`);
    return (
      <div className="p-4 text-red-500">
        Error: Extension view not found ({extensionId}/{viewName})
      </div>
    );
  }

  try {
    return <ViewComponent />;
  } catch (err) {
    error(`Error rendering extension view: ${err}`);
    return (
      <div className="p-4 text-red-500">
        Error rendering extension view: {String(err)}
      </div>
    );
  }
};
