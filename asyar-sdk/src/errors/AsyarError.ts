export class AsyarError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PermissionDeniedError extends AsyarError {
  constructor(
    message: string,
    public readonly permission?: string,
  ) {
    super(message, 'PERMISSION_DENIED', permission !== undefined ? { permission } : undefined);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PermissionConsentRequiredError extends AsyarError {
  constructor(
    message: string,
    public readonly permission?: string,
  ) {
    super(
      message,
      'PERMISSION_CONSENT_REQUIRED',
      permission !== undefined ? { permission } : undefined,
    );
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class IpcTimeoutError extends AsyarError {
  constructor(
    message: string,
    public readonly command?: string,
    public readonly timeoutMs?: number,
  ) {
    super(
      message,
      'IPC_TIMEOUT',
      command !== undefined || timeoutMs !== undefined ? { command, timeoutMs } : undefined,
    );
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
