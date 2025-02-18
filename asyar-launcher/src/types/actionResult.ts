// Different types of actions for search results:
// - SET_VIEW: Returns a view (e.g., clipboard history)
// - NONE: No return value (e.g., opening applications, Performs clipboard action "copy calculator result")
export type ActionResult = {
    type: "SET_VIEW" | "NONE";
    view?: string;
    extensionId?: string;
    viewName?: string;
  };