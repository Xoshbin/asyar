import { useState, useEffect, useCallback } from "react";

export function useKeyboardNavigation(
  itemCount: number,
  onSelect?: () => void
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when item count changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [itemCount]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (itemCount === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % itemCount);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + itemCount) % itemCount);
          break;
        case "Enter":
          e.preventDefault();
          if (onSelect) {
            onSelect();
          }
          break;
      }
    },
    [itemCount, onSelect]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return selectedIndex;
}
