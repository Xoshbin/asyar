import { invoke } from "@tauri-apps/api/core";
import { useEffect, useCallback } from "react";
import type { View } from "../types";

interface UseEscapeProps {
  view: View;
  query: string;
  onBack: () => void;
}

const useEscape = ({ view, query, onBack }: UseEscapeProps) => {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();

        if (view === "search" && !query) {
          // If in search view with empty query, hide the app
          invoke("hide");
        } else {
          // If in another view or has query, go back
          onBack();
        }
      } else if (event.key === "Backspace" && !query && view !== "search") {
        // If backspace with empty input and not in search view, go back
        event.preventDefault();
        onBack();
      }
    },
    [view, query, onBack]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
};

export default useEscape;
