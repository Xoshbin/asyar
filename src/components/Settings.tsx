import React, { useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import "../styles/Settings.css";

// TODO: The shortcut UI works but the Rust backend needs to be updated to handle the new shortcut
// Currently, the 'update_global_shortcut' command is not implemented in the Rust side
// TODO: Rust backend needs to be updated to handle auto start
// Currently, there's no implementation for managing app auto start in the Rust side

const Settings = () => {
  const [recording, setRecording] = useState(false);
  const [currentShortcut, setCurrentShortcut] = useState<string>("⌘ + K");

  useEffect(() => {
    loadSavedShortcut();
  }, []);

  const loadSavedShortcut = async () => {
    const store = await load(".settings.dat", {
      path: ".settings.dat",
      defaults: {
        spotlight_shortcut: "⌘ + K",
      },
    } as any);
    const shortcut = await store.get<string>("spotlight_shortcut");
    if (shortcut) {
      setCurrentShortcut(shortcut);
    }
  };

  const saveShortcut = async (shortcut: string) => {
    const store = await load(".settings.dat");
    await store.set("spotlight_shortcut", shortcut);
    await store.save();
    await invoke("update_global_shortcut", { shortcut });
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (!recording) return;

    e.preventDefault();

    const modifiers = [];
    if (e.metaKey) modifiers.push("⌘");
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");

    const key = e.key.toUpperCase();
    if (
      key !== "META" &&
      key !== "CONTROL" &&
      key !== "ALT" &&
      key !== "SHIFT"
    ) {
      const newShortcut = [...modifiers, key].join(" + ");
      setCurrentShortcut(newShortcut);
      setRecording(false);
      await saveShortcut(newShortcut);
    }
  };

  return (
    <div className="settings-container">
      <header className="settings-header">
        <h1>Asyar Settings</h1>
      </header>
      <main className="settings-content">
        <section className="settings-section">
          <h2>General</h2>
          <div className="setting-item">
            <label>Launch at startup</label>
            <input
              type="checkbox"
              onChange={(e) =>
                console.log("Checkbox changed:", e.target.checked)
              }
            />
          </div>
        </section>
        <section className="settings-section">
          <h2>Shortcuts</h2>
          <div className="setting-item">
            <label>Toggle Spotlight</label>
            <div
              className={`shortcut-display ${recording ? "recording" : ""}`}
              onClick={() => setRecording(true)}
              onKeyDown={handleKeyDown}
              tabIndex={0}
            >
              {recording ? "Press new shortcut..." : currentShortcut}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Settings;
