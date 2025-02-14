import React, { useEffect } from "react";
import { pluginManager } from "../services/pluginManagerInstance";
import { info, error } from "@tauri-apps/plugin-log";

interface PluginViewContainerProps {
  pluginId: string;
  viewName: string;
}

export const PluginViewContainer: React.FC<PluginViewContainerProps> = ({
  pluginId,
  viewName,
}) => {
  useEffect(() => {
    info(`Rendering plugin view: ${pluginId}/${viewName}`);
  }, [pluginId, viewName]);

  const ViewComponent = pluginManager.getPluginView(pluginId, viewName);

  if (!ViewComponent) {
    error(`Plugin view not found: ${pluginId}/${viewName}`);
    return (
      <div className="p-4 text-red-500">
        Error: Plugin view not found ({pluginId}/{viewName})
      </div>
    );
  }

  try {
    return <ViewComponent />;
  } catch (err) {
    error(`Error rendering plugin view: ${err}`);
    return (
      <div className="p-4 text-red-500">
        Error rendering plugin view: {String(err)}
      </div>
    );
  }
};
