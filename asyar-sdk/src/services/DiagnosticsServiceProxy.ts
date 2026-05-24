import { BaseServiceProxy } from './BaseServiceProxy';
import type { Diagnostic, IDiagnosticsService } from '../contracts/diagnostics';

/**
 * SDK-side proxy for the Diagnostics Service.
 *
 * Communicates with the Launcher Host via asyar:api:diagnostics:report IPC messages.
 * The host automatically injects the source ('extension') and extensionId from the
 * calling iframe context.
 *
 * The payload is wrapped in a single-keyed envelope (`{ d }`) so the launcher's
 * IPC dispatcher (which calls `Object.values(payload)` to spread positional args
 * — see ExtensionIpcRouter.dispatchApiCall) yields a single argument [d] rather
 * than spreading `d`'s fields in unstable key order. Same pattern as
 * SearchBarServiceProxy.set.
 */
export class DiagnosticsServiceProxy
  extends BaseServiceProxy
  implements IDiagnosticsService
{
  report(d: Omit<Diagnostic, 'source' | 'extensionId'>): Promise<void> {
    return this.broker.invoke('diagnostics:report', { d });
  }
}
