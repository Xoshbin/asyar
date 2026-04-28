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
  io_failure: () => 'I/O error',
  json_failure: () => 'Data format error',
  unknown: () => 'Unexpected error',

  // Rust-derived (SearchError)
  search_lock_poisoned: () => 'Search index lock corrupted',
  search_json_failure: () => 'Search data format error',
  search_io_failure: () => 'Search I/O error',
  search_not_found: ({ target }) => `Search did not find ${target ?? 'item'}`,
  search_other: ({ detail }) => `Search error${detail ? `: ${detail}` : ''}`,

  // Frontend / extension
  uncaught_exception: () => 'Unexpected error',
  unhandled_rejection: () => 'Unexpected error',
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
});
