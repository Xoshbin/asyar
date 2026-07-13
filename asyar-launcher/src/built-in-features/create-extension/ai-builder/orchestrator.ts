import type { SidecarEvent } from './buildProtocol';
import { parseSidecarEvent } from './buildProtocol';
import { buildJobStore } from './buildJobStore.svelte';
import { presentQuestion } from './questionBridge';
import { notificationService } from '../../../services/notification/notificationService';
import { finalizeBuild } from './finalizeBuild';
import { sidecarClient } from './sidecarClient';
import { resolveCapabilitySpecDir } from './buildPaths';
import { homeDir, join } from '@tauri-apps/api/path';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logService } from '../../../services/log/logService';
import { extBuilderCheckRuntimes } from '../../../lib/ipc/extensionBuilderCommands';
import { extBuilderRuntimeConsentStore } from './runtimeConsentStore.svelte';
import { runtimeService } from '../../../services/runtime/runtimeService.svelte';
import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';

const CALLER_EXT_ID = 'create-extension';

export async function handleEvent(ev: SidecarEvent): Promise<void> {
  switch (ev.kind) {
    case 'verdict': {
      if (!ev.possible) {
        buildJobStore.finishFailed({ step: 'feasibility', error: ev.reason, log: ev.reason });
        await notificationService.send(CALLER_EXT_ID, {
          title: "Asyar can't build that",
          body: ev.reason,
        });
        return;
      }
      buildJobStore.appendStep({ label: 'Feasible — starting build', detail: ev.degradedNote });
      return;
    }
    case 'step':
      buildJobStore.appendStep({ label: ev.label, detail: ev.detail });
      return;
    case 'ask':
      await presentQuestion({
        questionId: ev.questionId,
        prompt: ev.prompt,
        inputKind: ev.inputKind,
        placeholder: ev.placeholder,
      });
      return;
    case 'done': {
      try {
        const scan = await finalizeBuild(ev.path, ev.extensionId);
        if (scan.leaked) {
          buildJobStore.finishFailed({
            step: 'secret-guard',
            error: `Refused: hardcoded secret found in ${scan.path}`,
            log: `Secret found at ${scan.path}`,
          });
          await notificationService.send(CALLER_EXT_ID, {
            title: 'Build blocked',
            body: 'A secret was hardcoded; refusing to ship.',
          });
          return;
        }
        buildJobStore.finishDone({
          extensionId: ev.extensionId,
          path: ev.path,
          smokeSummary: ev.smokeSummary,
        });
        await notificationService.send(CALLER_EXT_ID, {
          title: '✅ Extension ready',
          body: `${ev.extensionId} built and verified (${ev.smokeSummary}).`,
          actions: [
            {
              id: 'open',
              title: 'Open in editor',
              commandId: 'build-with-ai',
              args: { buildId: 'current' },
            },
          ],
        });
      } catch (err) {
        buildJobStore.finishFailed({ step: 'finalize', error: String(err), log: String(err) });
        await notificationService.send(CALLER_EXT_ID, {
          title: 'Build failed',
          body: `finalize: ${String(err)}`,
        });
      }
      return;
    }
    case 'fail':
      buildJobStore.finishFailed({ step: ev.step, error: ev.error, log: ev.log });
      await notificationService.send(CALLER_EXT_ID, {
        title: 'Build failed',
        body: `${ev.step}: ${ev.error}`,
      });
      return;
  }
}

export interface StartResult {
  ok: boolean;
  reason?: string;
}

let unlisten: UnlistenFn | null = null;

export async function ensureListening(): Promise<void> {
  if (unlisten) return;
  unlisten = await listen<string>('asyar:ext-builder:event', (e) => {
    const ev = parseSidecarEvent(e.payload);
    if (!ev) {
      logService.warn(`[ext-builder] dropped unparseable event: ${e.payload}`);
      return;
    }
    void handleEvent(ev);
  });
}

export async function stopListening(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

/** Checks bun/claude, prompts once for combined consent, downloads
 * sequentially (not `Promise.all`) since progress events carry no
 * per-runtime discriminator to track which of N is active. */
async function ensureRuntimesReady(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const missing = await extBuilderCheckRuntimes();
  if (!missing || missing.length === 0) return { ok: true };

  const approved = await extBuilderRuntimeConsentStore.request(missing);
  if (!approved) return { ok: false, reason: 'Download declined.' };

  for (const r of missing) {
    const ok = await runtimeService.download(r.name);
    if (!ok) {
      void diagnosticsService.report({
        source: 'frontend',
        kind: 'ext_builder_runtime_download_failed',
        severity: 'error',
        retryable: true,
        developerDetail: `Failed to download the "${r.name}" runtime needed by the AI Extension Builder.`,
        context: { runtime: r.name },
      });
      return {
        ok: false,
        reason: `Failed to download ${r.name}. Try again from the AI Extension Builder.`,
      };
    }
  }
  return { ok: true };
}

export async function startBuild(
  prompt: string,
  opts: { anthropicKey: string },
): Promise<StartResult> {
  const key = opts.anthropicKey?.trim();
  if (!key) {
    return {
      ok: false,
      reason: 'This feature needs an Anthropic API key. Add one in Settings → AI → Anthropic.',
    };
  }

  const runtimesReady = await ensureRuntimesReady();
  if (!runtimesReady.ok) {
    return { ok: false, reason: runtimesReady.reason };
  }

  await ensureListening();
  const baseDir = await join(await homeDir(), 'AsyarExtensions');
  const capabilitySpecDir = await resolveCapabilitySpecDir();
  buildJobStore.start(prompt, baseDir);
  const result = await sidecarClient.start({
    prompt,
    targetDir: baseDir,
    capabilitySpecDir,
    anthropicKey: key,
  });
  if (result === null) {
    // invokeSafe returns null on a real Rust-side Err — must fail closed,
    // not fall through to `ok: true` and leave the job stuck 'working'.
    buildJobStore.finishFailed({
      step: 'spawn',
      error: 'Failed to start the build. Please try again.',
      log: 'ext_builder_start invoke rejected',
    });
    return { ok: false, reason: 'Failed to start the build. Please try again.' };
  }
  if (result.status === 'needsRuntimes') {
    // Defensive: ensureRuntimesReady() already confirmed both runtimes
    // above; only reachable if one vanished between that check and spawn.
    buildJobStore.finishFailed({
      step: 'runtime-check',
      error: 'A required runtime became unavailable. Please try again.',
      log: JSON.stringify(result.runtimes),
    });
    return { ok: false, reason: 'A required runtime became unavailable. Please try again.' };
  }
  return { ok: true };
}
