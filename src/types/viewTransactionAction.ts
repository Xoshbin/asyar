import { View } from "./view";

export interface ViewTransitionAction {
  type: "SET_VIEW";
  view: View;
  extensionId?: string;
  viewName?: string;
}
