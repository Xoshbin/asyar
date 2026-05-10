import { agentsBackfillThreadTitles, replaceDynamicCommandsBuiltin } from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import type { DynamicCommandRegistration } from 'asyar-sdk/contracts';
import type { AgentService } from './agentService.svelte';
import { agentService as defaultAgentService } from './agentService.svelte';

const AGENTS_EXTENSION_ID = 'agents';

export class AgentsManager {
  currentAgentId = $state<string | null>(null);
  /**
   * Active thread id for the chat view, set by AgentChatView on mount and
   * read by the agents extension's `onViewSubmit` so launcher-bar Enter
   * routes the query into the right thread.
   */
  currentThreadId = $state<string | null>(null);
  /**
   * In-flight assistant response. While a turn is streaming, tokens land
   * here and the chat view renders them as a temporary bubble. Cleared
   * when the turn is persisted (real message takes over).
   */
  streamingText = $state<string>('');
  /** True while a `runAgent` invocation is in-flight for the active thread. */
  sending = $state<boolean>(false);
  /**
   * AbortController for the active send. The chat view's Cancel button (and
   * the launcher Esc handler) call `.abort()` on this; agentLoop watches it
   * via the abortSignal arg.
   */
  activeAbortController = $state<AbortController | null>(null);
  private service: AgentService;
  private started = false;

  constructor(service?: AgentService) {
    this.service = service ?? defaultAgentService;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Load persisted agents from SQLite into the service cache before we
    // sync dynamic commands — otherwise refresh() registers zero entries
    // and the user appears to lose their agents on every restart.
    try {
      await this.service.init();
    } catch (err) {
      logService.warn(`[agents] service init failed: ${err}`);
    }

    // One-time-per-session backfill: derive titles for any threads created
    // before auto-titling landed (their first user message becomes the title).
    // Runs async; failure is non-fatal — the sidebar falls back to dates.
    void agentsBackfillThreadTitles().catch((err) => {
      logService.warn(`[agents] thread-title backfill failed: ${err}`);
    });

    try {
      await this.refresh();
    } catch (err) {
      logService.warn(`[agents] initial refresh failed: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await replaceDynamicCommandsBuiltin(AGENTS_EXTENSION_ID, []);
  }

  async refresh(): Promise<void> {
    const regs: DynamicCommandRegistration[] = this.service.agents.map((a) => ({
      id: a.id,
      name: a.name,
    }));
    await replaceDynamicCommandsBuiltin(AGENTS_EXTENSION_ID, regs);
  }
}

export const agentsManager = new AgentsManager();
