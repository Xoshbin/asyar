// asyar-launcher/src/lib/ipc/authCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface AuthStateResponse {
  isLoggedIn: boolean;
  user?: AuthUser;
  entitlements: string[];
  entitlementsCachedAt?: number;
}

export interface AuthInitResponse {
  sessionCode: string;
  authUrl: string;
}

export interface PollResponse {
  status: 'pending' | 'complete' | 'expired';
  token?: string;
  user?: AuthUser;
  entitlements?: string[];
}

export async function authInitiate(provider: string): Promise<AuthInitResponse | null> {
  return invokeSafe<AuthInitResponse>('auth_initiate', { provider });
}

export async function authPoll(sessionCode: string): Promise<PollResponse | null> {
  return invokeSafe<PollResponse>('auth_poll', { sessionCode });
}

export async function authLoadCached(): Promise<AuthStateResponse | null> {
  return invokeSafe<AuthStateResponse | null>('auth_load_cached');
}

export async function authGetState(): Promise<AuthStateResponse | null> {
  return invokeSafe<AuthStateResponse>('auth_get_state');
}

export async function authRefreshEntitlements(): Promise<string[] | null> {
  return invokeSafe<string[]>('auth_refresh_entitlements');
}

export async function authLogout(): Promise<void> {
  await invokeSafe('auth_logout');
}

export type Ability =
  | 'cloud-sync-egress'
  | 'ai-cloud-models'
  | 'ai-conversation-sync'
  | 'telemetry-crash-report'
  | 'telemetry-usage-share';

export async function gateCheck(
  ability: Ability,
  opts?: {
    syncEnabled?: boolean;
    crashReportMode?: string;
    usageShareMode?: string;
  },
): Promise<boolean | null> {
  return invokeSafe<boolean>('gate_check', {
    ability,
    syncEnabled: opts?.syncEnabled,
    crashReportMode: opts?.crashReportMode,
    usageShareMode: opts?.usageShareMode,
  });
}

// ── OAuth PKCE for Extensions ─────────────────────────────────────────────────

export interface OAuthStartResponse {
  state: string;
  authUrl: string;
}

export interface OAuthTokenPayload {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  /** Unix timestamp seconds. Undefined = no expiry. */
  expiresAt?: number;
}

export interface OAuthExchangeResponse {
  extensionId: string;
  flowId: string;
  token: OAuthTokenPayload;
}

export async function oauthStartFlow(
  extensionId: string,
  providerId: string,
  clientId: string,
  authorizationUrl: string,
  tokenUrl: string,
  scopes: string[],
  flowId: string,
): Promise<OAuthStartResponse | null> {
  return invokeSafe<OAuthStartResponse>('oauth_start_flow', {
    extensionId,
    providerId,
    clientId,
    authorizationUrl,
    tokenUrl,
    scopes,
    flowId,
  });
}

export async function oauthExchangeCode(
  stateParam: string,
  code: string,
): Promise<OAuthExchangeResponse | null> {
  return invokeSafe<OAuthExchangeResponse>('oauth_exchange_code', { stateParam, code });
}

export async function oauthGetStoredToken(
  extensionId: string,
  providerId: string,
): Promise<OAuthTokenPayload | null> {
  return invokeSafe<OAuthTokenPayload | null>('oauth_get_stored_token', {
    extensionId,
    providerId,
  });
}

export async function oauthRevokeExtensionToken(
  extensionId: string,
  providerId: string,
): Promise<void> {
  await invokeSafe('oauth_revoke_extension_token', { extensionId, providerId });
}
