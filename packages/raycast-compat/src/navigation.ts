import { getActiveContext } from './context';
import type { IOpenerService } from 'asyar-sdk/contracts';

export type Application = {
  name: string;
  path?: string;
  bundleId?: string;
};

export async function open(target: string, application?: string | Application): Promise<void> {
  const service = getActiveContext().getService<IOpenerService>('opener');
  const isUrl =
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target) ||
    target.startsWith('mailto:') ||
    target.startsWith('tel:');

  if (isUrl) {
    await service.openUrl(target);
    return;
  }

  const appName = typeof application === 'string' ? application : application?.name;
  await service.openPath(target, appName ? { with: appName } : undefined);
}

export async function closeMainWindow(_options?: { clearRootSearch?: boolean }): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    window.parent &&
    typeof window.parent.postMessage === 'function'
  ) {
    window.parent.postMessage({ type: 'asyar:window:hide' }, '*');
  }
  try {
    const ctx = getActiveContext() as any;
    if (typeof ctx.hideLauncher === 'function') {
      ctx.hideLauncher();
    }
  } catch {
    // context may not support hideLauncher directly
  }
}

export async function popToRoot(_options?: { clearSearchBar?: boolean }): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    window.parent &&
    typeof window.parent.postMessage === 'function'
  ) {
    window.parent.postMessage({ type: 'asyar:window:hide' }, '*');
  }
}
