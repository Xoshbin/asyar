import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  scriptsRescan,
  scriptsSetInlineScripts,
  replaceDynamicCommandsBuiltin,
  type InlineScriptSpec,
  type InlineTickPayload,
} from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { commandService } from '../../services/extension/commandService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import type { ScannedScript } from './types';
import type { DynamicCommandRegistration } from 'asyar-sdk/contracts';

const SCRIPTS_EXTENSION_ID = 'scripts';

/** Dynamic-command object_id prefix for built-in scripts. See CLAUDE.md
 *  "subjectId is the run-to-item join key". The same id is the launcher
 *  list row's `object_id` AND the `liveSubtitles` map key. */
const SCRIPT_COMMAND_OBJECT_PREFIX = 'cmd_scripts_dyn_';

export class ScriptsManager {
  scripts = $state<ScannedScript[]>([]);
  private unlistenScriptsChanged: UnlistenFn | null = null;
  private unlistenInlineTick: UnlistenFn | null = null;
  /** Dynamic ids we've already surfaced a clamp diagnostic for. */
  private clampWarned = new Set<string>();
  /** Dynamic ids we've already surfaced a cap-overflow diagnostic for. */
  private cappedWarned = new Set<string>();

  async start(): Promise<void> {
    if (this.unlistenScriptsChanged) return;

    this.unlistenScriptsChanged = await listen('scripts:changed', () => {
      void this.refresh().catch((err) => {
        logService.warn(`[scripts] refresh on event failed: ${err}`);
      });
    });
    this.unlistenInlineTick = await listen<InlineTickPayload>(
      'scripts:inline:tick',
      (event) => {
        this.applyInlineTick(event.payload);
      },
    );
    try {
      await this.refresh();
    } catch (err) {
      logService.warn(`[scripts] initial refresh failed: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.unlistenScriptsChanged) {
      this.unlistenScriptsChanged();
      this.unlistenScriptsChanged = null;
    }
    if (this.unlistenInlineTick) {
      this.unlistenInlineTick();
      this.unlistenInlineTick = null;
    }
    // Abort every active inline timer + clear subtitles before unregistering
    // commands. Sending [] to the Rust scheduler will return all current ids
    // in `dropped`, which we then use to wipe liveSubtitles.
    const outcome = await scriptsSetInlineScripts([]);
    if (outcome === null) {
      logService.warn('[scripts] inline shutdown failed');
    } else {
      for (const id of outcome.dropped) {
        this.clearLiveSubtitle(id);
      }
    }
    await replaceDynamicCommandsBuiltin(SCRIPTS_EXTENSION_ID, []);
    this.scripts = [];
    this.clampWarned.clear();
    this.cappedWarned.clear();
  }

  getScriptByDynamicId(id: string): ScannedScript | undefined {
    return this.scripts.find((s) => s.dynamicId === id);
  }

  reset(): void {
    this.scripts = [];
    this.unlistenScriptsChanged = null;
    this.unlistenInlineTick = null;
    this.clampWarned.clear();
    this.cappedWarned.clear();
  }

  private async refresh(): Promise<void> {
    const fresh = await scriptsRescan();
    if (fresh === null) {
      throw new Error('Failed to rescan scripts');
    }
    const regs: DynamicCommandRegistration[] = fresh.map((s) => ({
      id: s.dynamicId,
      name: s.header.title ?? deriveFilenameTitle(s.absolutePath),
      icon: s.header.icon ?? 'icon:terminal',
      arguments: s.header.arguments,
    }));
    await replaceDynamicCommandsBuiltin(SCRIPTS_EXTENSION_ID, regs);
    this.scripts = fresh;

    // Inline-mode plumbing: collect specs, surface clamp diagnostics once
    // per script, push to Rust scheduler, surface cap-overflow diagnostics,
    // clear subtitles for dropped ids.
    await this.syncInlineScripts(fresh);
  }

  private async syncInlineScripts(scripts: ScannedScript[]): Promise<void> {
    const inlineScripts = scripts.filter(
      (s) =>
        s.header.mode === 'inline' &&
        s.header.refreshTimeSeconds !== null &&
        s.header.refreshTimeSeconds > 0,
    );

    // One-time clamp diagnostic per script that had its refreshTime raised.
    for (const s of inlineScripts) {
      if (s.header.refreshTimeClamped && !this.clampWarned.has(s.dynamicId)) {
        this.clampWarned.add(s.dynamicId);
        const name = s.header.title ?? deriveFilenameTitle(s.absolutePath);
        await diagnosticsService.report({
          source: 'frontend',
          kind: 'inline_script_clamped',
          severity: 'warning',
          retryable: false,
          context: {
            script: name,
            path: s.absolutePath,
            message: `Inline script ${name} requested a refreshTime below 10s. Raised to 10s (Asyar minimum).`,
          },
        });
      }
    }

    const specs: InlineScriptSpec[] = inlineScripts.map((s) => ({
      dynamicId: s.dynamicId,
      absolutePath: s.absolutePath,
      // Non-null asserted by the filter above.
      refreshTimeSeconds: s.header.refreshTimeSeconds!,
    }));

    const outcome = await scriptsSetInlineScripts(specs);
    if (outcome === null) {
      logService.warn('[scripts] scriptsSetInlineScripts failed');
      return;
    }

    // Cap-overflow: 11th+ inline scripts. Diagnose once per dynamic id.
    const newlyCapped = outcome.capped.filter((id) => !this.cappedWarned.has(id));
    if (newlyCapped.length > 0) {
      for (const id of newlyCapped) {
        this.cappedWarned.add(id);
      }
      const cappedScripts = newlyCapped.map((id) => {
        const s = inlineScripts.find((x) => x.dynamicId === id);
        return s?.header.title ?? (s ? deriveFilenameTitle(s.absolutePath) : id);
      });
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'inline_script_capped',
        severity: 'warning',
        retryable: false,
        context: {
          message: `Inline scripts cap reached (10 max). These scripts will not auto-refresh: ${cappedScripts.join(', ')}. They can still be run manually by selecting them.`,
          scripts: cappedScripts.join(', '),
        },
      });
    }

    // Drop diagnostics from `cappedWarned` for scripts no longer capped
    // so the user gets a fresh warning if a script returns to the overflow.
    for (const id of [...this.cappedWarned]) {
      if (!outcome.capped.includes(id)) {
        this.cappedWarned.delete(id);
      }
    }

    // Aborted tasks must clear their liveSubtitle so the row falls back
    // to its description.
    for (const id of outcome.dropped) {
      this.clearLiveSubtitle(id);
      this.clampWarned.delete(id);
    }
  }

  /** Pure helper: route a tick payload into commandService.liveSubtitles. */
  private applyInlineTick(payload: InlineTickPayload): void {
    const objectId = SCRIPT_COMMAND_OBJECT_PREFIX + payload.dynamicId;
    const subtitle = payload.error
      ? `error: ${payload.error}`
      : (payload.subtitle ?? null);
    commandService.liveSubtitles = {
      ...commandService.liveSubtitles,
      [objectId]: subtitle,
    };
  }

  private clearLiveSubtitle(dynamicId: string): void {
    const objectId = SCRIPT_COMMAND_OBJECT_PREFIX + dynamicId;
    const next = { ...commandService.liveSubtitles };
    delete next[objectId];
    commandService.liveSubtitles = next;
  }
}

function deriveFilenameTitle(absolutePath: string): string {
  const base = absolutePath.split(/[\\/]/).pop() ?? absolutePath;
  return base.replace(/\.[^.]+$/, '') || base;
}

export const scriptsManager = new ScriptsManager();
