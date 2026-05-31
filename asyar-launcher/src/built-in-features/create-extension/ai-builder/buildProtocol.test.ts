import { describe, it, expect } from 'vitest';
import { parseSidecarEvent, serializeBuilderCommand, type SidecarEvent } from './buildProtocol';

describe('parseSidecarEvent', () => {
  it('parses a verdict event', () => {
    const line = JSON.stringify({ kind: 'verdict', possible: true, reason: 'ok' });
    expect(parseSidecarEvent(line)).toEqual({ kind: 'verdict', possible: true, reason: 'ok' });
  });

  it('parses an ask event', () => {
    const line = JSON.stringify({ kind: 'ask', questionId: 'q1', prompt: 'Which DB?', inputKind: 'text' });
    const ev = parseSidecarEvent(line) as Extract<SidecarEvent, { kind: 'ask' }>;
    expect(ev.questionId).toBe('q1');
    expect(ev.inputKind).toBe('text');
  });

  it('returns null for malformed JSON', () => {
    expect(parseSidecarEvent('not json')).toBeNull();
  });

  it('returns null for a non-object JSON value', () => {
    expect(parseSidecarEvent('42')).toBeNull();
    expect(parseSidecarEvent('true')).toBeNull();
    expect(parseSidecarEvent('null')).toBeNull();
  });

  it('returns null for an unknown kind', () => {
    expect(parseSidecarEvent(JSON.stringify({ kind: 'wat' }))).toBeNull();
  });

  it('returns null for an ask event missing questionId', () => {
    const line = JSON.stringify({ kind: 'ask', prompt: 'Which DB?', inputKind: 'text' });
    expect(parseSidecarEvent(line)).toBeNull();
  });

  it('returns null for a verdict event missing possible', () => {
    const line = JSON.stringify({ kind: 'verdict', reason: 'ok' });
    expect(parseSidecarEvent(line)).toBeNull();
  });

  it('returns null for a verdict event with wrong-typed possible', () => {
    const line = JSON.stringify({ kind: 'verdict', possible: 'yes', reason: 'ok' });
    expect(parseSidecarEvent(line)).toBeNull();
  });

  it('parses a valid verdict event with an extra unknown field (passthrough)', () => {
    const line = JSON.stringify({ kind: 'verdict', possible: true, reason: 'ok', extra: 123 });
    expect(parseSidecarEvent(line)).toEqual({ kind: 'verdict', possible: true, reason: 'ok', extra: 123 });
  });
});

describe('serializeBuilderCommand', () => {
  it('serializes an answer command to a single line', () => {
    const line = serializeBuilderCommand({ kind: 'answer', questionId: 'q1', value: 'main' });
    expect(line).toBe('{"kind":"answer","questionId":"q1","value":"main"}');
    expect(line).not.toContain('\n');
  });

  it('serializes a cancel command', () => {
    expect(serializeBuilderCommand({ kind: 'cancel' })).toBe('{"kind":"cancel"}');
  });
});
