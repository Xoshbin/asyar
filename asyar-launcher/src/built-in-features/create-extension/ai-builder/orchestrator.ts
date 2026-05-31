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

const CALLER_EXT_ID = 'create-extension';

export async function handleEvent(ev: SidecarEvent): Promise<void> {
  switch (ev.kind) {
    case 'verdict': {
      if (!ev.possible) {
        buildJobStore.finishFailed({ step: 'feasibility', error: ev.reason, log: ev.reason });
        await notificationService.send(CALLER_EXT_ID, { title: "Asyar can't build that", body: ev.reason });
        return;
      }
      buildJobStore.appendStep({ label: 'Feasible — starting build', detail: ev.degradedNote });
      return;
    }
    case 'step':
      buildJobStore.appendStep({ label: ev.label, detail: ev.detail });
      return;
    case 'ask':
      await presentQuestion({ questionId: ev.questionId, prompt: ev.prompt, inputKind: ev.inputKind, placeholder: ev.placeholder });
      return;
    case 'done': {
      try {
        const scan = await finalizeBuild(ev.path, ev.extensionId);
        if (scan.leaked) {
          buildJobStore.finishFailed({ step: 'secret-guard', error: `Refused: hardcoded secret found in ${scan.path}`, log: `Secret found at ${scan.path}` });
          await notificationService.send(CALLER_EXT_ID, { title: 'Build blocked', body: 'A secret was hardcoded; refusing to ship.' });
          return;
        }
        buildJobStore.finishDone({ extensionId: ev.extensionId, path: ev.path, smokeSummary: ev.smokeSummary });
        await notificationService.send(CALLER_EXT_ID, {
          title: '✅ Extension ready',
          body: `${ev.extensionId} built and verified (${ev.smokeSummary}).`,
          actions: [{ id: 'open', title: 'Open in editor', commandId: 'build-with-ai', args: { buildId: 'current' } }],
        });
      } catch (err) {
        buildJobStore.finishFailed({ step: 'finalize', error: String(err), log: String(err) });
        await notificationService.send(CALLER_EXT_ID, { title: 'Build failed', body: `finalize: ${String(err)}` });
      }
      return;
    }
    case 'fail':
      buildJobStore.finishFailed({ step: ev.step, error: ev.error, log: ev.log });
      await notificationService.send(CALLER_EXT_ID, { title: 'Build failed', body: `${ev.step}: ${ev.error}` });
      return;
  }
}

export interface StartResult { ok: boolean; reason?: string }

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
  if (unlisten) { unlisten(); unlisten = null; }
}

export async function startBuild(prompt: string, opts: { anthropicKey: string }): Promise<StartResult> {
  const key = opts.anthropicKey?.trim();
  if (!key) {
    return { ok: false, reason: 'This feature needs an Anthropic API key. Add one in Settings → AI → Anthropic.' };
  }
  await ensureListening();
  const baseDir = await join(await homeDir(), 'AsyarExtensions');
  const capabilitySpecDir = await resolveCapabilitySpecDir();
  buildJobStore.start(prompt, baseDir);
  await sidecarClient.start({ prompt, targetDir: baseDir, capabilitySpecDir, anthropicKey: key });
  return { ok: true };
}
