import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getClipboardStore } from "../stores/clipboardStore";
import { ClipboardService, ClipboardItem } from "../services/clipboard";
import { useKeyboardNavigation } from "../hooks/useKeyboardNavigation";

export function ClipboardView() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const selectedIndex = useKeyboardNavigation(items.length);

  useEffect(() => {
    let interval: number;

    const initStore = async () => {
      try {
        const store = await getClipboardStore();
        setItems(store.getHistory());
        setIsLoading(false);

        interval = window.setInterval(async () => {
          const updatedStore = await getClipboardStore();
          setItems(updatedStore.getHistory());
        }, 1000);
      } catch (error) {
        console.error("Failed to initialize clipboard view:", error);
        setIsLoading(false);
      }
    };

    initStore();

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Enter" && items.length > 0) {
        await handleItemSelect(items[selectedIndex].content);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [items, selectedIndex]);

  const handleItemSelect = async (content: string) => {
    await ClipboardService.write(content);
    await invoke("hide"); // Hide the panel after selection
    await invoke("simulate_paste"); // Simulate CMD+V to paste the content
  };

  return (
    <div className="clipboard-view split-panel">
      <div className="left-panel">
        <div className="category-label">Clipboard History</div>
        {isLoading ? (
          <div className="result-item">Loading clipboard history...</div>
        ) : items.length === 0 ? (
          <div className="result-item">No clipboard history yet</div>
        ) : (
          items.map((item, index) => (
            <div
              key={item.id}
              className={`result-item ${
                index === selectedIndex ? "selected" : ""
              }`}
              onClick={() => handleItemSelect(item.content)}
            >
              <div className="result-icon">📋</div>
              <div className="result-content">
                <div className="result-title">
                  {ClipboardService.formatClipboardContent(item.content, 30)}
                </div>
                <div className="result-subtitle">
                  {new Date(item.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="right-panel">
        <div className="category-label">Content Preview</div>
        <div className="content-preview">
          {items.length > 0 ? (
            <pre>{items[selectedIndex].content}</pre>
          ) : (
            <div className="empty-preview">No content selected</div>
          )}
        </div>
      </div>
    </div>
  );
}
