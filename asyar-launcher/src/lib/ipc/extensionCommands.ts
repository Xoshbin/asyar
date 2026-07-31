// asyar-launcher/src/lib/ipc/extensionCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import { bumpArgumentHintVersion } from '../launcher/argumentHintVersion.svelte';
import type { ExtensionRecord } from '../../types/ExtensionRecord';
import type { AvailableUpdate } from '../../types/ExtensionUpdate';

// ── Extensions ────────────────────────────────────────────────────────────────

export async function getExtensionsDir(): Promise<string | null> {
  return invokeSafe<string>('get_extensions_dir');
}

export async function listInstalledExtensions(): Promise<string[] | null> {
  return invokeSafe<string[]>('list_installed_extensions');
}

export async function uninstallExtension(extensionId: string): Promise<void> {
  await invokeSafe('uninstall_extension', { extensionId });
}

export async function installExtensionFromUrl(params: {
  url: string;
  extensionId: string;
  extensionName: string;
  version: string;
  checksum: string | null;
}): Promise<void> {
  const { url, extensionId, extensionName, version, checksum } = params;
  await invokeSafe('install_extension_from_url', {
    downloadUrl: url,
    extensionId,
    extensionName,
    version,
    checksum,
  });
}

export async function getBuiltinFeaturesPath(): Promise<string | null> {
  return invokeSafe<string>('get_builtin_features_path');
}

// `register_dev_extension` is `Result<(), AppError>` on the Rust side —
// use invokeSafeVoid's boolean signal so callers can fall back on failure.
export async function registerDevExtension(extensionId: string, path: string): Promise<boolean> {
  return invokeSafeVoid('register_dev_extension', { extensionId, path });
}

export async function getDevExtensionPaths(): Promise<Record<string, string> | null> {
  return invokeSafe<Record<string, string>>('get_dev_extension_paths');
}

export async function spawnHeadlessExtension(
  extensionId: string,
  scriptPath: string,
): Promise<void> {
  await invokeSafe('spawn_headless_extension', { id: extensionId, path: scriptPath });
}

export async function killExtension(extensionId: string): Promise<void> {
  await invokeSafe('kill_extension', { id: extensionId });
}

export async function discoverExtensions(): Promise<ExtensionRecord[] | null> {
  return invokeSafe<ExtensionRecord[]>('discover_extensions');
}

export async function setExtensionEnabled(extensionId: string, enabled: boolean): Promise<boolean> {
  // invokeSafeVoid, not invokeSafe: the Rust command returns Result<(), _>,
  // whose Ok(()) is indistinguishable from invokeSafe's null failure
  // sentinel — callers must know whether the toggle actually landed.
  return invokeSafeVoid('set_extension_enabled', { extensionId, enabled });
}

export async function getExtension(extensionId: string): Promise<ExtensionRecord | null> {
  return invokeSafe<ExtensionRecord>('get_extension', { extensionId });
}

// -- Extension Updates --

export async function checkExtensionUpdates(
  storeApiBaseUrl: string,
): Promise<AvailableUpdate[] | null> {
  return invokeSafe<AvailableUpdate[]>('check_extension_updates', { storeApiBaseUrl });
}

export async function updateExtension(update: AvailableUpdate): Promise<void> {
  await invokeSafe('update_extension', { update });
}

export async function updateAllExtensions(
  updates: AvailableUpdate[],
): Promise<[string, { Ok?: null; Err?: string }][] | null> {
  return invokeSafe('update_all_extensions', { updates });
}

export interface CommandSyncInput {
  id: string;
  name: string;
  extension: string;
  trigger: string;
  type: string;
  icon?: string | null;
}

export interface CommandSyncResult {
  added: number;
  removed: number;
  total: number;
}

export async function syncCommandIndex(
  commands: CommandSyncInput[],
): Promise<CommandSyncResult | null> {
  return invokeSafe<CommandSyncResult>('sync_command_index', { commands });
}

export interface UpdateCommandMetadataInput {
  commandObjectId: string;
  subtitle: string | null;
}

export async function updateCommandMetadata(input: UpdateCommandMetadataInput): Promise<void> {
  await invokeSafe('update_command_metadata', { input });
}

/**
 * Argument schema field for a runtime-registered command. Mirrors the
 * SDK's `CommandArgument` shape so the wire format is the single
 * source of truth maintained in `asyar-sdk/src/types/CommandType.ts`.
 */
export interface DynamicCommandArgumentInput {
  name: string;
  type: 'text' | 'password' | 'dropdown' | 'number';
  placeholder?: string;
  required?: boolean;
  default?: string | number;
  data?: { value: string; title: string }[];
}

export interface DynamicCommandRegistrationInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  arguments?: DynamicCommandArgumentInput[];
}

/**
 * Replace an extension's full dynamic command list. Atomic — Rust
 * validates every registration first; on any validation failure the
 * promise rejects and the previous list remains intact.
 */
export async function replaceDynamicCommands(
  extensionId: string,
  regs: DynamicCommandRegistrationInput[],
): Promise<void> {
  await invokeSafe('replace_dynamic_commands', { extensionId, regs });
  bumpArgumentHintVersion();
}

/**
 * Reply shape for `getDynamicCommandMeta`. Returns null when
 * `objectId` is not a dynamic-format id or has no matching entry.
 */
export interface DynamicCommandMetaReply {
  extensionId: string;
  commandId: string;
  commandName: string;
  icon?: string;
  args: DynamicCommandArgumentInput[];
}

/**
 * Look up dynamic command metadata by full object id
 * (`cmd_<extensionId>_dyn_<dynamicId>`). Returns `null` when the id
 * does not match the dynamic format or when the registry has no
 * matching entry. Used by the argument-mode resolver fallback.
 */
export async function getDynamicCommandMeta(
  objectId: string,
): Promise<DynamicCommandMetaReply | null> {
  return invokeSafe<DynamicCommandMetaReply | null>('get_dynamic_command_meta', { objectId });
}

export interface ScheduledTaskInfo {
  extensionId: string;
  extensionName: string;
  commandId: string;
  commandName: string;
  intervalSeconds: number;
  active: boolean;
}

export async function getScheduledTasks(): Promise<ScheduledTaskInfo[] | null> {
  return invokeSafe<ScheduledTaskInfo[]>('get_scheduled_tasks');
}

// -- Theme types --

export interface ThemeFontEntry {
  family: string;
  weight?: string;
  style?: string;
  src: string;
}

export interface ThemeDefinition {
  variables: Record<string, string>;
  fonts: ThemeFontEntry[];
}

// -- Plugin system commands --

export async function installExtensionFromFile(filePath: string): Promise<void> {
  await invokeSafe('install_extension_from_file', { filePath });
}

export async function showOpenExtensionDialog(): Promise<string | null> {
  return invokeSafe<string | null>('show_open_extension_dialog');
}

export async function getThemeDefinition(extensionId: string): Promise<ThemeDefinition | null> {
  return invokeSafe<ThemeDefinition>('get_theme_definition', { extensionId });
}
