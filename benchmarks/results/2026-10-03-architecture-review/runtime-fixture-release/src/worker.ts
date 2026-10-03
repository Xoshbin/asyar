import { ExtensionContext, extensionBridge } from '../../../../../asyar-sdk/src/worker';
import manifest from '../manifest.json';
const context = new ExtensionContext();
context.setExtensionId(manifest.id);
const status = {
  runId: Date.now(),
  ticks: 0,
  actions: 0,
  preferences: context.preferences.values,
  dom: typeof document,
  role: (self as any).__ASYAR_ROLE__,
  permitted: false,
  denied: '',
};
context.onPreferencesChanged(() => {
  status.preferences = context.preferences.values;
});
self.setInterval(() => {
  status.ticks++;
}, 1000);
context.onRequest('status', async () => status);
const action = async () => {
  status.actions++;
  await context.proxies.storage!.set('actions', String(status.actions));
};
context.proxies.actions!.registerActionHandler('probe', action);
extensionBridge.registerManifest(manifest as any);
extensionBridge.registerExtensionImplementation(manifest.id, {
  initialize: async () => {},
  executeCommand: action,
  search: async (query: string) =>
    query.toLowerCase().includes('worker probe')
      ? [
          {
            id: 'probe-hit',
            title: 'Architecture Worker Probe',
            score: 1,
            type: 'result',
            actionId: 'probe',
            actionPayload: { source: 'search' },
          },
        ]
      : [],
} as any);
(async () => {
  try {
    await context.proxies.storage!.set('proof', 'permitted');
    status.permitted = (await context.proxies.storage!.get('proof')) === 'permitted';
  } catch (error) {
    status.denied = `unexpected storage error: ${error}`;
  }
  try {
    await context.proxies.notes!.list();
    status.denied = 'ERROR: unpermitted notes call succeeded';
  } catch (error) {
    status.denied = String(error);
  }
})();
