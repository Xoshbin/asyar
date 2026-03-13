with open('src/services/extension/extensionManager.ts', 'r') as f:
    content = f.read()

import re
content = re.sub(r'  // Set up IPC handler for iframe messages[\s\S]*?    \}\);\n  \}\n', '', content)

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
            new NotificationService().notify(payload);
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

content = content.replace("  public getManifest", ipc_handler + "\n  public getManifest")

with open('src/services/extension/extensionManager.ts', 'w') as f:
    f.write(content)
