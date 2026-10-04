import { createPushBridge } from '../eventPushBridge/createPushBridge';

/** Routes Rust subscription events through the shared worker-aware delivery bridge. */
export const systemEventsBridge = createPushBridge(
  'asyar:system-event',
  'asyar:event:system-event:push',
  'systemEventsBridge',
);
