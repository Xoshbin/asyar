export interface SmokeResult { ok: boolean; summary: string }

export function evaluateSmokeResponse(status: number): SmokeResult {
  if (status >= 200 && status < 300) return { ok: true, summary: `${status} OK` };
  if (status === 401 || status === 403) return { ok: false, summary: `${status} — auth failed (check the API key)` };
  return { ok: false, summary: `${status} — service returned an error` };
}

// Performs the live call. Returns the evaluated result. `req` is built by the
// Agent SDK builder from the generated integration's first read endpoint.
export async function runSmoke(req: { url: string; headers: Record<string, string>; method?: string }): Promise<SmokeResult> {
  const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers });
  return evaluateSmokeResponse(res.status);
}
