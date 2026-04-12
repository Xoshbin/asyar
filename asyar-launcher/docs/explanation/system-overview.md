---
order: 7
---
## 1. System Overview

Asyar is an extensible desktop launcher and productivity tool built on the Rust-based Tauri framework and web technologies. The core architectural challenge Asyar solves is providing a unified search and command execution interface capable of running both deeply integrated native features (Tier 1) and isolated third-party extensions (Tier 2) without compromising host security or user experience.

```ascii
+-----------------------------------------------------------------------------------+
|                                 Operating System (macOS / Windows / Linux)        |
+-----------------------------------------------------------------------------------+
      | Global Hotkeys        | Tray Menu       | File System       | Clipboard
+-----------------------------------------------------------------------------------+
|                                   Rust Host (Tauri 2)                             |
|  - asyar_lib::run()                                                               |
|  - Custom Protocol: asyar-extension://                                            |
|  - Global Shortcuts, Window Management, Notifications                             |
+-----------------------------------------------------------------------------------+
      | Tauri IPC (`@tauri-apps/api/core`)
+-----------------------------------------------------------------------------------+
|                            Privileged Host Context (WebView)                      |
|                                                                                   |
|  SvelteKit Frontend (`src/routes/+page.svelte`)                                   |
|  - ExtensionManager (`extensionManager.ts`)                                       |
|  - ExtensionLoaderService (`extensionLoaderService.ts`)                           |
|  - SearchService & Command Index                                                  |
|                                                                                   |
|  +---------------------------------------+                                        |
|  |     Tier 1: Built-in Features       |                                        |
|  |     (Shared JS Context)               |                                        |
|  |     e.g., Clipboard History, Store    |                                        |
|  +---------------------------------------+                                        |
|       | asyar-sdk proxy        ^                                                  |
|       v                        |                                                  |
|  +---------------------------------------+    +--------------------------------+  |
|  |        ExtensionIframe.svelte         |    |   Tier 2: Installed Extensions |  |
|  |        (IPC Bridge / postMessage)     |<---|   (Isolated Iframe Sandbox)    |  |
|  +---------------------------------------+    +--------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---
