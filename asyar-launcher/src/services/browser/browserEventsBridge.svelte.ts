import { createPushBridge } from '../eventPushBridge/createPushBridge';

/** Routes Rust subscription events through the shared worker-aware delivery bridge. */
export const browserEventsBridge = createPushBridge(
  'asyar:browser-event',
  'asyar:event:browser-event:push',
  'browserEventsBridge',
);
