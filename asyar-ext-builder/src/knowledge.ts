import rawSources from '../knowledgeSources.json';

export interface KnowledgeSources {
  examples: string[];
  docs: string[];
}

// Inlined into sidecar.js by `bun build`. Exported typed; validateSources() is a
// build/test-time guard (NOT called at module load — a guard-tested registry never
// throws at runtime).
export const knowledgeSources = rawSources as KnowledgeSources;

const HTTPS_URL = /^https:\/\/[^\s]+$/;

function checkUrlArray(obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new Error(`knowledgeSources: '${key}' must be an array`);
  }
  for (const u of v) {
    if (typeof u !== 'string' || !HTTPS_URL.test(u) || u.includes('..')) {
      throw new Error(`knowledgeSources: '${key}' has an invalid url: ${String(u)}`);
    }
  }
}

export function validateSources(s: unknown): void {
  if (typeof s !== 'object' || s === null) {
    throw new Error('knowledgeSources: must be an object');
  }
  const obj = s as Record<string, unknown>;
  checkUrlArray(obj, 'examples');
  checkUrlArray(obj, 'docs');
}

export function knowledgePromptSection(): string {
  const urls = [...knowledgeSources.examples, ...knowledgeSources.docs];
  if (urls.length === 0) return '';
  return [
    'Canonical example extensions and docs — fetch with WebFetch when you need real',
    'patterns; read the ACTUAL manifest + source, do not assume. These are current and',
    'authoritative. If a URL is unreachable, proceed using the authoring rules above.',
    ...urls.map((u) => `  • ${u}`),
  ].join('\n');
}
