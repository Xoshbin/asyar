import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import AppContent from "./components/AppContent";
import Settings from "./components/Settings";
import { routes } from "./routes";

function App() {
  const location = useLocation();

  useEffect(() => {
    console.log("Current route:", location.pathname);
    console.log("Current hash:", location.hash);
  }, [location]);

  return (
    <Routes>
      {routes.map((route) => (
        <Route key={route.path} {...route} />
      ))}
    </Routes>
  );
}

export default App;
