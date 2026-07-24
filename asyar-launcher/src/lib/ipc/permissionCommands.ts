// asyar-launcher/src/lib/ipc/permissionCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';

// ── Permissions ───────────────────────────────────────────────────────────────

export interface PermissionCheckResult {
  allowed: boolean;
  requiredPermission?: string;
  reason?: string;
}

export interface PermissionRegistrationResult {
  registered: boolean;
  needsConsent: boolean;
}

export interface ExtensionConsentRecord {
  permissions: string[];
  permissionArgs: Record<string, unknown>;
  consentedAt: number;
  grandfathered: boolean;
}

export interface ExtensionConsentStatus {
  needsConsent: boolean;
  declaredPermissions: string[];
  declaredArgs: Record<string, unknown>;
  consented: ExtensionConsentRecord | null;
  declaredRuntimes: string[];
}

export async function registerExtensionPermissions(
  extensionId: string,
  permissions: string[],
  permissionArgs?: Record<string, unknown> | null,
): Promise<PermissionRegistrationResult | null> {
  return invokeSafe<PermissionRegistrationResult>('register_extension_permissions', {
    extensionId,
    permissions,
    permissionArgs: permissionArgs ?? null,
  });
}

export async function checkExtensionConsent(
  extensionId: string,
): Promise<ExtensionConsentStatus | null> {
  return invokeSafe<ExtensionConsentStatus>('check_extension_consent', { extensionId });
}

export async function setExtensionConsent(
  extensionId: string,
  permissions: string[],
  permissionArgs?: Record<string, unknown> | null,
): Promise<void> {
  await invokeSafe('set_extension_consent', {
    extensionId,
    permissions,
    permissionArgs: permissionArgs ?? null,
  });
}

/**
 * Withdraw a previously-granted consent record (Settings → Extensions
 * "Revoke" action). The extension stays installed/enabled; its permissions
 * are unregistered immediately, so gated calls fail closed without a
 * restart. Returns whether the IPC call itself succeeded.
 */
export async function revokeExtensionConsent(extensionId: string): Promise<boolean> {
  return invokeSafeVoid('revoke_extension_consent', { extensionId });
}

export async function checkExtensionPermission(
  extensionId: string,
  callType: string,
): Promise<PermissionCheckResult | null> {
  return invokeSafe<PermissionCheckResult>('check_extension_permission', { extensionId, callType });
}

// ── Shell Trust ──────────────────────────────────────────────────────────────

export interface TrustedBinary {
  binaryPath: string;
  trustedAt: number;
}

// Silent: ShellTrustManager.svelte is the sole caller and reports its own diagnostic.
export async function shellListTrusted(extensionId: string): Promise<TrustedBinary[] | null> {
  return invokeSafe<TrustedBinary[]>('shell_list_trusted', { extensionId }, { silent: true });
}

export async function shellRevokeTrust(extensionId: string, binaryPath: string): Promise<void> {
  await invokeSafe('shell_revoke_trust', { extensionId, binaryPath });
}
