import { describe, it, expect } from 'vitest';
import { NAMESPACES } from 'asyar-sdk/contracts';
import {
  INJECTS_EXTENSION_ID,
  ALWAYS_INJECTS_CALLER_ID,
} from '../ExtensionIpcRouter';

describe('INJECTS_EXTENSION_ID', () => {
  it('contains only valid Namespace values', () => {
    const validNamespaces = new Set<string>(NAMESPACES);
    for (const ns of INJECTS_EXTENSION_ID) {
      expect(validNamespaces.has(ns)).toBe(true);
    }
  });

  it('does not overlap with ALWAYS_INJECTS_CALLER_ID', () => {
    for (const ns of ALWAYS_INJECTS_CALLER_ID) {
      expect(INJECTS_EXTENSION_ID.has(ns)).toBe(false);
    }
  });

  it('includes the timers namespace — schedule/cancel/list are per-extension scoped', () => {
    expect(INJECTS_EXTENSION_ID.has('timers')).toBe(true);
  });
});

describe('ALWAYS_INJECTS_CALLER_ID', () => {
  it('contains only valid Namespace values', () => {
    const validNamespaces = new Set<string>(NAMESPACES);
    for (const ns of ALWAYS_INJECTS_CALLER_ID) {
      expect(validNamespaces.has(ns)).toBe(true);
    }
  });
});
