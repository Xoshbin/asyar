import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/style.css";
import { HashRouter } from "react-router-dom";

// Add debugging
console.log("Current path:", window.location.pathname);
console.log("Current hash:", window.location.hash);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
