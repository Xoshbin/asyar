import { describe, it, expect } from 'bun:test';
import { evaluateSmokeResponse } from './smokeTest';

describe('evaluateSmokeResponse', () => {
  it('passes on a 2xx', () => {
    expect(evaluateSmokeResponse(200)).toEqual({ ok: true, summary: '200 OK' });
    expect(evaluateSmokeResponse(204)).toEqual({ ok: true, summary: '204 OK' });
  });
  it('fails on 401 with an auth hint', () => {
    const r = evaluateSmokeResponse(401);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('auth');
  });
  it('fails on 5xx', () => {
    expect(evaluateSmokeResponse(503).ok).toBe(false);
  });
});
