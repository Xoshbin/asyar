import { defineDiagnosticMessages } from './defineDiagnosticMessages';

export const DIAGNOSTIC_MESSAGES = defineDiagnosticMessages({
  // Rust-derived (AppError)
  permission_denied: ({ permission }) => `Access to ${permission ?? 'a resource'} was denied`,
  network_failure: () => 'Network error',
  lock_poisoned: () => 'Internal lock corrupted; please restart Asyar',
  database_failure: () => 'Database error',
  not_found: ({ target }) => `Could not find ${target ?? 'item'}`,
  extension_failure: ({ extension }) => `Extension error: ${extension ?? 'unknown'}`,
  shortcut_failure: ({ shortcut }) => `Shortcut error: ${shortcut ?? 'unknown'}`,
  platform_failure: ({ platform }) => `Platform error: ${platform ?? 'unknown'}`,
  validation_failure: ({ field }) => `Invalid input: ${field ?? 'value'}`,
  encryption_failure: () => 'Encryption error',
  auth_failure: ({ provider }) => `Authentication failed${provider ? ` (${provider})` : ''}`,
  oauth_failure: ({ provider }) => `OAuth error${provider ? ` (${provider})` : ''}`,
  power_failure: () => 'Power management error',
  run_failed: ({ id }) => `Run ${id ?? 'unknown'} failed`,
  io_failure: () => 'I/O error',
  json_failure: () => 'Data format error',
  unknown: ({ message }) => message ?? 'Unexpected error',

  // Rust-derived (SearchError)
  search_lock_poisoned: () => 'Search index lock corrupted',
  search_json_failure: () => 'Search data format error',
  search_io_failure: () => 'Search I/O error',
  search_not_found: ({ target }) => `Search did not find ${target ?? 'item'}`,
  search_other: ({ detail }) => `Search error${detail ? `: ${detail}` : ''}`,

  // Frontend / extension
  uncaught_exception: ({ message }) => message ?? 'Unexpected error',
  unhandled_rejection: ({ message }) => message ?? 'Unexpected error',
  render_error: () => 'A view failed to render',
  invoke_unknown: ({ command }) => `Command failed${command ? `: ${command}` : ''}`,
  extension_proxy_error: ({ method }) => `Extension call failed${method ? ` (${method})` : ''}`,
  extension_crash: ({ extensionId, role }) => `${extensionId ?? 'Extension'} (${role ?? '?'}) stopped responding`,
  iframe_uncaught: ({ extensionId }) => `${extensionId ?? 'Extension'} hit an unexpected error`,
  iframe_unhandled_rejection: ({ extensionId }) => `${extensionId ?? 'Extension'} promise was rejected`,
  rpc_timeout: ({ method }) => `${method ?? 'Operation'} timed out`,
  panic: () => 'Asyar encountered a fatal error',
  manual: ({ message }) => message ?? 'Error',
  action_failed: ({ message }) => message ?? 'Action failed',
  mcp_permission_required: ({ tool }) => `Permission required to use ${tool ?? 'this MCP tool'}`,

  // E2EE cloud sync
  e2ee_enrollment_failed: () => 'Couldn\'t enable encrypted sync. Check your connection and try again.',
  e2ee_passphrase_required: () => 'Encrypted sync needs your passphrase to continue.',
  e2ee_key_derivation_failed: () => 'Couldn\'t derive your sync key. Try closing other apps and retrying.',
  e2ee_decrypt_failed: () => 'An item failed to decrypt — your data may be corrupted, or the passphrase has changed.',
  e2ee_key_version_mismatch: () => 'Your encrypted sync needs to refresh. Pulling latest…',
});
