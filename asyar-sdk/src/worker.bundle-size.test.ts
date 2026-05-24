/**
 * @vitest-environment node
 *
 * Worker entry-point bundle-size cap.
 *
 * The worker iframe must stay headless. Accidentally pulling a DOM helper
 * into the worker transitive import graph is a correctness regression
 * as much as a size regression — the worker must not touch the document.
 *
 * Approximation: walk the TS import graph starting from src/worker.ts,
 * concatenate transitive source files, gzip the result. The cap is a
 * ceiling; the real signal is whether DOM-shaped modules slip into the
 * graph.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const MAX_GZIPPED_BYTES = 50 * 1024;
const ENTRY = resolve(__dirname, 'worker.ts');

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const baseDir = dirname(fromFile);
  const noExt = resolve(baseDir, spec);
  const candidates = [
    noExt + '.ts',
    join(noExt, 'index.ts'),
    noExt,
  ];
  for (const c of candidates) {
    if (existsSync(c) && !c.endsWith('.test.ts')) return c;
  }
  return null;
}

function extractImports(source: string): string[] {
  // Strip type-only import/export lines — they are erased at compile time
  // and must not count against the runtime bundle's import graph.
  const cleaned = source
    .split('\n')
    .filter((line) => !/^\s*(?:import|export)\s+type\s/.test(line))
    .join('\n');

  const specs: string[] = [];
  const re = /(?:^|\s)(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

function walkGraph(entry: string): Map<string, string> {
  const visited = new Map<string, string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    const src = readFileSync(file, 'utf8');
    visited.set(file, src);
    for (const spec of extractImports(src)) {
      const resolved = resolveImport(file, spec);
      if (resolved) stack.push(resolved);
    }
  }
  return visited;
}

describe('asyar-sdk/worker — bundle size cap', () => {
  it(`worker entry transitive source gzips to <= ${MAX_GZIPPED_BYTES} bytes`, () => {
    const graph = walkGraph(ENTRY);
    const concatenated = Array.from(graph.values()).join('\n');
    const gzipped = gzipSync(Buffer.from(concatenated, 'utf8'));
    const size = gzipped.byteLength;
    console.log(
      `[worker.bundle-size] files=${graph.size} uncompressed=${concatenated.length} gzipped=${size}`,
    );
    expect(size).toBeLessThanOrEqual(MAX_GZIPPED_BYTES);
  });

  it('worker graph does not include view-only DOM helpers', () => {
    const graph = walkGraph(ENTRY);
    const files = Array.from(graph.keys()).map((p) => p.replace(/\\/g, '/'));
    const forbidden = [
      '/services/FeedbackServiceProxy.ts',
      '/services/SelectionServiceProxy.ts',
      '/services/ClipboardHistoryServiceProxy.ts',
      '/services/InteropServiceProxy.ts',
      '/icons/AsyarIconElement.ts',
      '/lib/focusTracker.ts',
      '/lib/themeInjector.ts',
    ];
    for (const f of forbidden) {
      const hit = files.find((p) => p.endsWith(f));
      expect(hit, `worker bundle transitively imports ${f}`).toBeUndefined();
    }
  });
});
