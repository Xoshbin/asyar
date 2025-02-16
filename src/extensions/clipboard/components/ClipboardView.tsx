import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clipboardApi } from "@asyar/api";
import type { ClipboardItem } from "@asyar/api";

export const ClipboardView: React.FC = () => {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedItemRef = useRef<HTMLDivElement>(null);

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
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (items.length === 0) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
          break;
        case "Enter":
          if (items[selectedIndex]) {
            handleItemSelect(items[selectedIndex].content);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, selectedIndex]);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [selectedIndex]);

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
              ref={index === selectedIndex ? selectedItemRef : null}
              className={`result-item ${
                index === selectedIndex ? "selected" : ""
              }`}
              onClick={() => handleItemSelect(item.content)}
              onMouseEnter={() => setSelectedIndex(index)}
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
          {items.length > 0 && items[selectedIndex] ? (
            <pre>{items[selectedIndex].content}</pre>
          ) : (
            <div className="empty-preview">No content selected</div>
          )}
        </div>
      </div>
    </div>
  );
};
