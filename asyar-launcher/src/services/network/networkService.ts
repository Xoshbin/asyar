import { fetchUrl, fetchUrlWithSecrets, wsConnect, wsSend, wsClose } from '../../lib/ipc/commands';
import { lanDevicesForCaller, lanHostValidate, type LanDevice } from '../../lib/ipc/lanCommands';
import { lanDevicePickerService } from './lanDevicePickerService.svelte';
import { resolveExtensionName } from '../extension/extensionDispatcher.svelte';

type IframeRole = 'view' | 'worker';

export class NetworkService {
  async listLanDevices(callerExtensionId: string | null): Promise<LanDevice[]> {
    return lanDevicesForCaller(callerExtensionId);
  }

  async requestLanDevice(
    callerExtensionId: string | null,
    options?: { reason?: string; serviceTypes?: string[]; allowManualEntry?: boolean } | IframeRole,
    originRole?: IframeRole,
  ): Promise<LanDevice | null> {
    const isRoleSecondArg = typeof options === 'string';
    const effectiveRole = isRoleSecondArg ? (options as IframeRole) : originRole;
    const effectiveOptions = !isRoleSecondArg && options ? options : {};
    const extensionId = this.requirePickerCaller(callerExtensionId, effectiveRole);
    return lanDevicePickerService.request({
      extensionId,
      extensionName: resolveExtensionName(extensionId),
      mode: 'discover',
      reason: effectiveOptions.reason,
      serviceTypes: effectiveOptions.serviceTypes,
      allowManualEntry: effectiveOptions.allowManualEntry ?? true,
    });
  }

  async requestLanHost(
    callerExtensionId: string | null,
    target: LanDevice,
    originRole?: IframeRole,
  ): Promise<LanDevice | null> {
    const extensionId = this.requirePickerCaller(callerExtensionId, originRole);
    await lanHostValidate(target.host, target.port);
    return lanDevicePickerService.request({
      extensionId,
      extensionName: resolveExtensionName(extensionId),
      mode: 'direct',
      allowManualEntry: false,
      target,
    });
  }

  private requirePickerCaller(callerExtensionId: string | null, originRole?: IframeRole): string {
    if (!callerExtensionId) throw new Error('LAN_PICKER_REQUIRES_EXTENSION_CALLER');
    if (originRole === 'worker') throw new Error('LAN_PICKER_REQUIRES_VIEW');
    return callerExtensionId;
  }

  async fetch(
    callerExtensionId: string | null,
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    },
  ): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    ok: boolean;
  }> {
    return fetchUrl({
      url,
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
      timeoutMs: options?.timeout ?? 20000,
      callerExtensionId,
    });
  }

  async fetchWithSecrets(
    callerExtensionId: string | null,
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
      secretRefs: string[];
    },
  ): ReturnType<typeof fetchUrl> {
    return fetchUrlWithSecrets({
      url,
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
      timeoutMs: options?.timeout ?? 20000,
      callerExtensionId,
      secretRefs: options?.secretRefs,
    });
  }

  async wsConnect(
    callerExtensionId: string | null,
    socketId: string,
    url: string,
    headers?: Record<string, string>,
    originRole?: IframeRole,
  ): Promise<boolean> {
    return wsConnect(socketId, url, headers, callerExtensionId, originRole);
  }

  async wsSend(
    callerExtensionId: string | null,
    socketId: string,
    message: string,
  ): Promise<boolean> {
    return wsSend(socketId, message, callerExtensionId);
  }

  async wsClose(
    callerExtensionId: string | null,
    socketId: string,
    code?: number,
    reason?: string,
  ): Promise<boolean> {
    return wsClose(socketId, code, reason, callerExtensionId);
  }
}

export const networkService = new NetworkService();
