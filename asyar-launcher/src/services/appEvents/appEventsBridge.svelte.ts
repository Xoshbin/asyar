import { createPushBridge } from '../eventPushBridge/createPushBridge';

/** Routes Rust subscription events through the shared worker-aware delivery bridge. */
export const appEventsBridge = createPushBridge(
  'asyar:app-event',
  'asyar:event:app-event:push',
  'appEventsBridge',
);
