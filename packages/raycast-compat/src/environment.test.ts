import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { environment } from './environment';

describe('environment compat API', () => {
  let originalEnv: any;

  beforeEach(() => {
    originalEnv = (globalThis as any).__ASYAR_ENVIRONMENT__;
  });

  afterEach(() => {
    (globalThis as any).__ASYAR_ENVIRONMENT__ = originalEnv;
  });

  it('exposes default environment metadata', () => {
    expect(typeof environment.isDevelopment).toBe('boolean');
    expect(typeof environment.theme).toBe('string');
    expect(environment.raycastVersion).toBeDefined();
    expect(typeof environment.commandName).toBe('string');
    expect(typeof environment.extensionName).toBe('string');
    expect(typeof environment.assetsPath).toBe('string');
    expect(typeof environment.supportPath).toBe('string');
  });

  it('reflects injected host environment values', () => {
    (globalThis as any).__ASYAR_ENVIRONMENT__ = {
      isDevelopment: true,
      theme: 'light',
      extensionId: 'org.asyar.custom-ext',
      commandId: 'my-command',
    };

    expect(environment.isDevelopment).toBe(true);
    expect(environment.theme).toBe('light');
    expect(environment.extensionName).toBe('org.asyar.custom-ext');
    expect(environment.commandName).toBe('my-command');
  });
});
