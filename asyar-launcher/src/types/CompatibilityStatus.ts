export type CompatibilityStatus =
  | { status: 'compatible' }
  | { status: 'sdkMismatch'; required: string; supported: string }
  | { status: 'appVersionTooOld'; required: string; current: string }
  | { status: 'unknown' };
