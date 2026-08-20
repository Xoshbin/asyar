import { describe, it, expect } from 'vitest';
import {
  AsyarError,
  PermissionDeniedError,
  PermissionConsentRequiredError,
  IpcTimeoutError,
} from './AsyarError';

describe('AsyarError hierarchy', () => {
  it('instantiates AsyarError with message, code, and details', () => {
    const err = new AsyarError('Something failed', 'GENERIC_ERROR', { foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AsyarError);
    expect(err.name).toBe('AsyarError');
    expect(err.message).toBe('Something failed');
    expect(err.code).toBe('GENERIC_ERROR');
    expect(err.details).toEqual({ foo: 'bar' });
  });

  it('instantiates PermissionDeniedError correctly', () => {
    const err = new PermissionDeniedError('Permission denied', 'clipboard:read');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AsyarError);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(err.name).toBe('PermissionDeniedError');
    expect(err.message).toBe('Permission denied');
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.permission).toBe('clipboard:read');
    expect(err.details).toEqual({ permission: 'clipboard:read' });
  });

  it('instantiates PermissionDeniedError without permission', () => {
    const err = new PermissionDeniedError('Permission denied');
    expect(err.permission).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it('instantiates PermissionConsentRequiredError correctly', () => {
    const err = new PermissionConsentRequiredError('Consent required', 'fs:watch');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AsyarError);
    expect(err).toBeInstanceOf(PermissionConsentRequiredError);
    expect(err.name).toBe('PermissionConsentRequiredError');
    expect(err.message).toBe('Consent required');
    expect(err.code).toBe('PERMISSION_CONSENT_REQUIRED');
    expect(err.permission).toBe('fs:watch');
    expect(err.details).toEqual({ permission: 'fs:watch' });
  });

  it('instantiates PermissionConsentRequiredError without permission', () => {
    const err = new PermissionConsentRequiredError('Consent required');
    expect(err.permission).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it('instantiates IpcTimeoutError correctly', () => {
    const err = new IpcTimeoutError('IPC timeout', 'storage:get', 5000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AsyarError);
    expect(err).toBeInstanceOf(IpcTimeoutError);
    expect(err.name).toBe('IpcTimeoutError');
    expect(err.message).toBe('IPC timeout');
    expect(err.code).toBe('IPC_TIMEOUT');
    expect(err.command).toBe('storage:get');
    expect(err.timeoutMs).toBe(5000);
    expect(err.details).toEqual({ command: 'storage:get', timeoutMs: 5000 });
  });
});
