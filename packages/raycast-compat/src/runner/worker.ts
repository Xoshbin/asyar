import {
  ExtensionContext,
  extensionBridge,
  type Extension,
  type ExtensionResult,
  type ExtensionManifest,
} from 'asyar-sdk/contracts';
import { getActiveContext } from '../context.js';

export interface RaycastCommandProps {
  arguments?: Record<string, unknown>;
}

export type RaycastWorkerCommandHandler = (
  props: RaycastCommandProps,
) => Promise<unknown> | unknown;

export interface WorkerRunnerOptions {
  manifest?: ExtensionManifest | Record<string, unknown>;
  commands: Record<string, RaycastWorkerCommandHandler>;
}

export interface WorkerRunnerHandle {
  context: ExtensionContext;
  implementation: Extension;
  executeCommand: (id: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Starts the Raycast worker runner inside Asyar's Tier 2 worker iframe.
 * Connects background commands (mode: "no-view") to ExtensionBridge.
 */
export function startWorkerRunner(options: WorkerRunnerOptions): WorkerRunnerHandle {
  // Ensure role is set to 'worker'
  if (typeof window !== 'undefined' && !(window as any).__ASYAR_ROLE__) {
    (window as any).__ASYAR_ROLE__ = 'worker';
  }

  const context = getActiveContext() as ExtensionContext;
  const manifest = options.manifest as ExtensionManifest | undefined;
  const extensionId =
    manifest?.id || (context as any)?.extensionId || 'org.asyar.raycast-extension';

  if (manifest) {
    extensionBridge.registerManifest(manifest);
  }

  class RaycastWorkerImplementation implements Extension {
    async initialize(_c: ExtensionContext): Promise<void> {}
    async activate(): Promise<void> {}
    async deactivate(): Promise<void> {}

    async executeCommand(id: string, args?: Record<string, unknown>): Promise<unknown> {
      const handler = options.commands[id];
      if (typeof handler === 'function') {
        return await handler({ arguments: args ?? {} });
      }
      throw new Error(
        `[raycast-compat:worker] Command '${id}' not found in registered commands: ${Object.keys(options.commands).join(', ')}`,
      );
    }

    async search(_query: string): Promise<ExtensionResult[]> {
      return [];
    }
  }

  const implementation = new RaycastWorkerImplementation();
  extensionBridge.registerExtensionImplementation(extensionId, implementation);

  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId, role: 'worker' }, '*');
  }

  return {
    context,
    implementation,
    executeCommand: (id: string, args?: Record<string, unknown>) =>
      implementation.executeCommand(id, args),
  };
}
