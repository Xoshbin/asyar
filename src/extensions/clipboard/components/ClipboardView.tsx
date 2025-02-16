import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { keyboardNavigation } from "@asyar/api";
import { clipboardApi } from "@asyar/api";
import type { ClipboardItem } from "@asyar/api";

export const ClipboardView: React.FC = () => {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    keyboardNavigation.initialize(items.length);
    setSelectedIndex(keyboardNavigation.getCurrentIndex());

    return () => {
      keyboardNavigation.destroy();
    };
  }, [items.length]);

  useEffect(() => {
    const checkIndex = () => {
      const newIndex = keyboardNavigation.getCurrentIndex();
      if (newIndex !== selectedIndex) {
        setSelectedIndex(newIndex);
      }
    };

    const interval = setInterval(checkIndex, 50);
    return () => clearInterval(interval);
  }, [selectedIndex]);

  useEffect(() => {
    let interval: number;

    const initStore = async () => {
      try {
        setItems(await clipboardApi.getHistory());
        setIsLoading(false);

        interval = window.setInterval(async () => {
          setItems(await clipboardApi.getHistory());
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
    await clipboardApi.copyToClipboard(content);
    await invoke("hide");
    await invoke("simulate_paste");
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
                  {clipboardApi.formatContent(item.content, 30)}
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
};
