with open('src/services/extension/extensionManager.ts', 'r') as f:
    content = f.read()

# Fix duplicated method
parts = content.split("  // Set up IPC handler for iframe messages")
if len(parts) > 2:
    # It was duplicated, keep only one.
    # The first one was inserted near `public getManifest`
    # The second one near `this.bridge.registerComponent`
    pass # we'll fix it cleanly below

import re

# Remove ALL existing setupIpcHandler methods to avoid duplicates
content = re.sub(r'  // Set up IPC handler for iframe messages[\s\S]*?    \}\);\n  \}\n', '', content)

# Remove any calls in the constructor we added
content = content.replace("    this.setupIpcHandler();\n", "")

with open('src/services/extension/extensionManager.ts', 'w') as f:
    f.write(content)

with open('src/services/extension/extensionManager.ts', 'r') as f:
    content = f.read()

ipc_handler = """
  // Set up IPC handler for iframe messages
  private setupIpcHandler() {
    window.addEventListener('message', async (event) => {
      // Basic security check (could be improved)
      if (event.source === window) return;

      const { type, payload, messageId } = event.data;
      if (!type || !type.startsWith('asyar:')) return;

      logService.debug(`[Main] Received IPC message: ${type}`);

      try {
        let result: any;
        // Map asyar-api requests to main process functionality
        switch (type) {
          case 'asyar:api:invoke':
            // Proxy Tauri invoke calls
            result = await invoke(payload.cmd, payload.args);
            break;
          case 'asyar:api:notification:show':
            // Delegate to main NotificationService
            await new NotificationService().show({ title: payload.title, body: payload.body, type: payload.type });
            break;
          case 'asyar:api:clipboard:readText':
            result = await ClipboardHistoryService.getInstance().getHistory(); // Approximation
            break;
          case 'asyar:api:clipboard:writeText':
            await ClipboardHistoryService.getInstance().add(payload); // Approximation
            break;
          case 'asyar:api:log:info':
            logService.info(payload);
            break;
          case 'asyar:api:log:error':
            logService.error(payload);
            break;
          case 'asyar:extension:loaded':
            logService.info(`Extension ready: ${payload.id}`);
            break;
          default:
            logService.warn(`Unknown IPC message type: ${type}`);
            throw new Error(`Unknown action: ${type}`);
        }

        // Send response back
        event.source?.postMessage({
          type: 'asyar:response',
          messageId,
          result,
          success: true
        }, { targetOrigin: '*' });

      } catch (error) {
        logService.error(`[Main] IPC handling error: ${error}`);
        event.source?.postMessage({
          type: 'asyar:response',
          messageId,
          error: error instanceof Error ? error.message : String(error),
          success: false
        }, { targetOrigin: '*' });
      }
    });
  }
"""

if "setupIpcHandler()" not in content:
    content = content.replace("this.bridge.registerComponent(\"Button\", Button);", "this.bridge.registerComponent(\"Button\", Button);\n    this.setupIpcHandler();")
    content = content.replace("  public getManifest", ipc_handler + "\n  public getManifest")

with open('src/services/extension/extensionManager.ts', 'w') as f:
    f.write(content)
