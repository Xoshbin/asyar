import AppContent from "./components/AppContent";
import Settings from "./components/Settings";

export const routes = [
  {
    path: "/",
    element: <AppContent />,
  },
  {
    path: "/settings",
    element: <Settings />,
  },
];
