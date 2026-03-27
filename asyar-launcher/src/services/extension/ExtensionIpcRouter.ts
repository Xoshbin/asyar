import { invoke } from "@tauri-apps/api/core";
import { logService } from "../log/logService";
import { checkPermission } from "../permissionGate";
import { envService } from "../envService";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { NotificationService } from "../notification/notificationService";
import type { ExtensionManifest } from "asyar-sdk";

interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
}

export const BLOCKED_EXTENSION_INVOKE_COMMANDS = new Set([
  'install_extension_from_url',
  'uninstall_extension',
  'register_dev_extension',
  'get_dev_extension_paths',
  'write_binary_file_recursive',
  'write_text_file_absolute',
  'read_text_file_absolute',
  'mkdir_absolute',
  'spawn_headless_extension',
  'kill_extension',
  'set_focus_lock',
  'sync_snippets_to_rust',
  'set_snippets_enabled',
  'expand_and_paste',
  'update_tray_menu',
  'initialize_autostart_from_settings',
  'initialize_shortcut_from_settings',
  'update_global_shortcut',
  'register_item_shortcut',
  'unregister_item_shortcut',
  'pause_user_shortcuts',
  'resume_user_shortcuts',
]);

export class ExtensionIpcRouter {
  constructor(
    private serviceRegistry: Record<string, any>,
    private getManifestById: (id: string) => ExtendedManifest | undefined,
    private goBack: () => void,
    private saveSearchIndex: () => void
  ) {}

  public setup(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('message', async (event: MessageEvent) => {
      const { type, payload, messageId, extensionId: msgExtensionId } = event.data;
      if (!type || !type.startsWith('asyar:')) return;

      // Extension requests launcher to hide
      if (type === 'asyar:window:hide') {
        this.goBack();
        this.saveSearchIndex();
        invoke('hide');
        return;
      }
      
      // Ignore responses sent to extensions from the main process to prevent infinite loops
      if (type === 'asyar:response') return;

      const isPrivilegedHostContext = event.source === window;
      const extensionId = msgExtensionId || payload?.extensionId;

      // Mandatory Validation only for external iframe contexts
      if (!isPrivilegedHostContext) {
        if (!extensionId) {
          logService.error(`[Main] Rejected IPC message: No extensionId provided by untrusted frame for type ${type}`);
          return;
        }

        const manifest = this.getManifestById(extensionId);
        if (!manifest) {
          logService.error(`[Main] Unauthorized: No registered manifest found for iframe extension ${extensionId}`);
          (event.source as Window)?.postMessage({
            type: 'asyar:response',
            messageId,
            success: false,
            error: `Unknown extension: ${extensionId}`
          }, event.origin && event.origin !== 'null' ? event.origin : '*');
          return;
        }

        // --- Permission Gate ---
        const permissionResult = checkPermission(
          extensionId,
          type,
          manifest.permissions ?? []
        );

        if (!permissionResult.allowed) {
          logService.warn(`[PermissionGate] BLOCKED: ${permissionResult.reason}`);
          (event.source as Window)?.postMessage({
            type: 'asyar:response',
            messageId,
            success: false,
            error: `Permission denied: "${permissionResult.requiredPermission}" is required but not declared in manifest.json`
          }, event.origin && event.origin !== 'null' ? event.origin : '*');
          return;
        }
      }

      logService.debug(`[Main] Received IPC message${extensionId ? ` from ${extensionId}` : ' from Privileged Host Context'}: ${type}`);

      try {
        let result: any;
        
        // Unify handling for asyar:api:* and asyar:service:*
        if (type.startsWith('asyar:api:') || type.startsWith('asyar:service:')) {
          const parts = type.split(':');
          let serviceName = '';
          let methodName = '';
          let isServiceStyle = type.startsWith('asyar:service:');

          if (isServiceStyle) {
            serviceName = parts[2];
            methodName = parts[3];
          } else {
            serviceName = parts[2];
            methodName = parts[3] || parts[2];
          }

          const serviceMap: Record<string, string> = {
            'log': 'LogService',
            'extension': 'ExtensionManager',
            'notification': 'NotificationService',
            'clipboard': 'ClipboardHistoryService',
            'command': 'CommandService',
            'action': 'ActionService',
            'statusbar': 'StatusBarService'
          };
          
          const targetServiceName = serviceMap[serviceName] || serviceName;

          if (type === 'asyar:api:invoke') {
             if (!isPrivilegedHostContext && BLOCKED_EXTENSION_INVOKE_COMMANDS.has(payload?.cmd)) {
               logService.warn(`[PermissionGate] BLOCKED invoke: iframe extension "${extensionId}" tried to call restricted command "${payload.cmd}"`);
               throw new Error(`Command "${payload.cmd}" is not available to extensions`);
             }
             if (envService.isTauri) {
               result = await invoke(payload.cmd, payload.args);
             } else {
               logService.warn(`[Main] Mocking invoke for ${payload.cmd} in browser`);
               result = null;
             }
          } else if (type === 'asyar:api:opener:open') {
             const { url } = payload;
             if (url && envService.isTauri) {
               await invoke('plugin:opener|open_url', { url });
             }
          } else if (type === 'asyar:api:notification:notify' || type === 'asyar:api:notification:show') {
            if (envService.isTauri && import.meta.env.DEV) {
              const opts = (payload && typeof payload === 'object' && 'options' in payload)
                ? (payload as { options: { title?: string; body?: string } }).options
                : payload as { title?: string; body?: string };
              await invoke('send_notification', {
                title: opts?.title ?? '',
                body:  opts?.body  ?? '',
                callerExtensionId: isPrivilegedHostContext ? null : (extensionId ?? null),
              });
            } else {
              const ns = this.serviceRegistry['NotificationService'] as NotificationService;
              const opts = (payload && typeof payload === 'object' && 'options' in payload)
                ? (payload as { options: any }).options
                : payload;
              await ns.notify(opts);
            }
          } else if (type === 'asyar:api:network:fetch') {
             const { url, options } = payload;
             if (envService.isTauri) {
               result = await invoke('fetch_url', {
                 url,
                 method: options?.method ?? 'GET',
                 headers: options?.headers,
                 timeoutMs: options?.timeout ?? 20000,
                 callerExtensionId: isPrivilegedHostContext ? null : (extensionId ?? null),
               });
             } else {
               const res = await httpFetch(url, {
                 method: options?.method ?? 'GET',
                 headers: options?.headers,
                 body: options?.body,
               });
               const responseHeaders: Record<string, string> = {};
               res.headers.forEach((value: string, key: string) => { responseHeaders[key] = value; });
               const body = await res.text();
               result = {
                 status: res.status,
                 statusText: res.statusText,
                 headers: responseHeaders,
                 body,
                 ok: res.ok,
               };
             }
          } else {
             const service = this.serviceRegistry[targetServiceName];
             if (service && typeof service[methodName] === 'function') {
               if (isServiceStyle && Array.isArray(payload)) {
                 result = await service[methodName](...payload);
               } else {
                 let args: unknown[];
                 if (payload === null || payload === undefined) {
                   args = [];
                 } else if (typeof payload !== 'object' || Array.isArray(payload)) {
                   args = Array.isArray(payload) ? payload : [payload];
                 } else {
                   const values = Object.values(payload as Record<string, unknown>);
                   args = values.length === 0 ? [] : values;
                 }
                 result = await service[methodName](...args);
               }
             } else if (type === 'asyar:extension:loaded') {
                logService.info(`Extension ready: ${extensionId}`);
             } else if (type === 'asyar:api:notification:show') {
                new NotificationService().notify(payload);
             } else {
               logService.warn(`[Main] Dispatch failed for ${type}: Service ${targetServiceName}.${methodName} not found`);
             }
          }
        } else {
           if (import.meta.env.DEV) {
              logService.warn(`[IPC] Unhandled message type: ${type}`);
           }
        }

        (event.source as WindowProxy)?.postMessage({
          type: 'asyar:response',
          messageId,
          result,
          success: true
        }, event.origin && event.origin !== 'null' ? event.origin : '*');

      } catch (error) {
        logService.error(`[Main] IPC handling error for ${extensionId}: ${error}`);
        (event.source as Window)?.postMessage({
          type: 'asyar:response',
          messageId,
          error: error instanceof Error ? error.message : String(error),
          success: false
        }, event.origin && event.origin !== 'null' ? event.origin : '*');
      }
    });
  }
}
