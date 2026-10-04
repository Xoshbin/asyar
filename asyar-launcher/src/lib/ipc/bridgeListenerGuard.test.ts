import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Static guard for a bug class neither tsc nor svelte-check can see.
 *
 * `bridge_emit` (src-tauri/src/event_bridge.rs) hands events to the main
 * window's long-poll queue, which only feeds `appListen()` subscribers. A raw
 * `listen()` from `@tauri-apps/api/event` on such an event silently never
 * fires once the poller has connected. Events that still reach the main
 * window through a plain `app.emit` / `emit_to` elsewhere in Rust are safe.
 */

const launcherRoot = resolve(__dirname, '../../..');
const rustRoot = join(launcherRoot, 'src-tauri');
const frontendRoot = join(launcherRoot, 'src');

function walk(dir: string, exts: string[], skip: string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts, skip));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

export function findBridgeOnlyEvents(rustSources: Array<[string, string]>): Set<string> {
  const bridged = new Set<string>();
  const direct = new Set<string>();
  for (const [file, text] of rustSources) {
    for (const m of text.matchAll(/bridge_emit(?:_to)?\s*\(\s*[^,]+,\s*"([^"]+)"/g))
      bridged.add(m[1]);
    // event_bridge.rs owns the pre-connection fallback `app.emit` and the
    // secondary-window `emit_to`; neither reaches the main window once the
    // poller is connected, so they are not a real path for it.
    if (file.endsWith('event_bridge.rs')) continue;
    for (const m of text.matchAll(/\.emit\s*\(\s*"([^"]+)"/g)) direct.add(m[1]);
    for (const m of text.matchAll(/\.emit_to\s*\(\s*[^,]+,\s*"([^"]+)"/g)) direct.add(m[1]);
  }
  return new Set([...bridged].filter((e) => !direct.has(e)));
}

export function findRawListeners(
  frontendSources: Array<[string, string]>,
  events: Set<string>,
): string[] {
  const offenders: string[] = [];
  for (const [file, text] of frontendSources) {
    const imp = text.match(/import\s*\{([^}]*)\}\s*from\s*'@tauri-apps\/api\/event'/);
    if (!imp) continue;
    const names = imp[1].split(',').map((n) => n.trim().split(/\s+as\s+/));
    // Resolve local aliases of listen/once so `import { listen as l }` is caught.
    const locals = names
      .filter(([orig]) => orig === 'listen' || orig === 'once')
      .map(([orig, alias]) => alias ?? orig);
    for (const local of locals) {
      const re = new RegExp(`(?<![\\w.])${local}\\s*(?:<[^>]*>)?\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
      for (const m of text.matchAll(re)) {
        if (events.has(m[1])) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line}  ${m[1]}`);
        }
      }
    }
  }
  return offenders;
}

describe('bridge listener guard', () => {
  it('detects a raw listen() on a bridge-only event (self-check)', () => {
    const events = findBridgeOnlyEvents([
      [
        'a.rs',
        'bridge_emit(&app, "x:changed", ()); bridge_emit(&app, "y:changed", ()); app.emit("y:changed", 1);',
      ],
    ]);
    expect([...events]).toEqual(['x:changed']);
    const hits = findRawListeners(
      [
        ['ok.ts', `import { listen } from '@tauri-apps/api/event';\nlisten('y:changed', f);`],
        [
          'bad.ts',
          `import { listen as l } from '@tauri-apps/api/event';\n\nl<void>('x:changed', f);`,
        ],
        ['fine.ts', `import { appListen } from './bridgeEvents';\nappListen('x:changed', f);`],
      ],
      events,
    );
    expect(hits).toEqual(['bad.ts:3  x:changed']);
  });

  it('no raw Tauri listen()/once() targets an event that only travels through bridge_emit', () => {
    const rust = walk(rustRoot, ['.rs'], ['target', 'node_modules']).map(
      (f) => [f, readFileSync(f, 'utf8')] as [string, string],
    );
    const front = walk(frontendRoot, ['.ts', '.svelte'])
      .filter((f) => !/\.(test|spec)\.ts$/.test(f))
      .map((f) => [relative(launcherRoot, f), readFileSync(f, 'utf8')] as [string, string]);

    const offenders = findRawListeners(front, findBridgeOnlyEvents(rust));
    expect(
      offenders,
      `Use appListen() from lib/ipc/bridgeEvents instead of raw listen() for:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
