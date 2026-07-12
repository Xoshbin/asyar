import type { MissingRuntime } from '../../../lib/ipc/extensionBuilderCommands';

/** List-shaped consent prompt for the AI Extension Builder's combined
 * bun+claude download flow — kept separate from `mcpService`'s single-item
 * `runtimeConsentPrompt` since that call site only ever needs one runtime. */
class ExtBuilderRuntimeConsentStore {
  prompt = $state<{
    runtimes: MissingRuntime[];
    resolve: (approved: boolean) => void;
  } | null>(null);

  request(runtimes: MissingRuntime[]): Promise<boolean> {
    return new Promise((resolve) => {
      this.prompt = { runtimes, resolve };
    });
  }

  decide(approved: boolean): void {
    const p = this.prompt;
    if (!p) return;
    p.resolve(approved);
    this.prompt = null;
  }
}

export const extBuilderRuntimeConsentStore = new ExtBuilderRuntimeConsentStore();
