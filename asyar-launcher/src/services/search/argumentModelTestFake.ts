import type { ArgumentSeed, CommandArgument } from 'asyar-sdk/contracts';
import type {
  ArgumentModelResolution,
  ResolveArgumentModelRequest,
} from '../../lib/ipc/argumentModelCommands';

/**
 * Faithful JS port of `extensions::argument_model::resolve` in the Rust
 * crate (src-tauri/src/extensions/argument_model.rs) — the seeding,
 * provenance, and gate logic moved there after PR #584 was flagged as a
 * `rust-first` violation. Test-only: production code never imports this
 * file, it exists purely to stand in for the real IPC call in `vitest`,
 * which has no Tauri runtime to invoke against.
 *
 * The Rust module's own inline `#[cfg(test)]` suite is the source of truth
 * for the algorithm itself — keep this port in sync if that module's logic
 * changes.
 */
export function fakeResolveCommandArguments(
  req: ResolveArgumentModelRequest,
): Promise<ArgumentModelResolution> {
  const hasDeclaredDefault = (arg: CommandArgument) =>
    arg.default !== undefined && arg.default !== null;
  const effectiveSeed = (arg: CommandArgument): ArgumentSeed =>
    arg.type === 'password' ? 'none' : (arg.seed ?? 'lastUsed');
  const defaultAsString = (arg: CommandArgument) =>
    hasDeclaredDefault(arg) ? String(arg.default) : '';
  const persisted = req.persisted ?? {};

  const seeds: Record<string, string> = {};
  const seededFromUser: string[] = [];
  const lastUsedFields: string[] = [];
  for (const arg of req.args) {
    const seed = effectiveSeed(arg);
    if (seed === 'lastUsed') lastUsedFields.push(arg.name);
    if (seed === 'none') {
      seeds[arg.name] = '';
      continue;
    }
    const declared = defaultAsString(arg);
    seeds[arg.name] = seed === 'lastUsed' ? (persisted[arg.name] ?? declared) : declared;
    if (seed === 'lastUsed' && (persisted[arg.name] ?? '').trim() !== '') {
      seededFromUser.push(arg.name);
    }
  }

  const effectiveValues: Record<string, string> = { ...seeds, ...(req.values ?? {}) };
  const edited = new Set(req.edited ?? []);
  const confirmed = new Set(req.confirmed ?? []);
  const seededFromUserSet = new Set(seededFromUser);

  const userSupplied: Record<string, string> = {};
  for (const arg of req.args) {
    const raw = (effectiveValues[arg.name] ?? '').trim();
    if (!raw) continue;
    if (edited.has(arg.name) || seededFromUserSet.has(arg.name)) userSupplied[arg.name] = raw;
  }

  const acknowledged: Record<string, string> = { ...userSupplied };
  for (const arg of req.args) {
    if (acknowledged[arg.name] !== undefined) continue;
    const raw = (effectiveValues[arg.name] ?? '').trim();
    if (raw && confirmed.has(arg.name)) acknowledged[arg.name] = raw;
  }

  const unfilledAgainst = (valueMap: Record<string, string>) =>
    req.args
      .filter((arg) => arg.required && (valueMap[arg.name] ?? '').trim() === '')
      .map((arg) => arg.name);

  const group = req.requireAnyOf;
  const requireAnyOfUnsatisfied = Boolean(
    group?.length && !group.some((name) => (userSupplied[name] ?? '').trim() !== ''),
  );

  const payload: Record<string, string | number> = {};
  for (const arg of req.args) {
    const raw = (effectiveValues[arg.name] ?? '').trim();
    if (!raw) {
      if (hasDeclaredDefault(arg)) {
        payload[arg.name] = arg.type === 'number' ? Number(arg.default) : String(arg.default);
      }
      continue;
    }
    payload[arg.name] = arg.type === 'number' ? Number(raw) : raw;
  }

  return Promise.resolve({
    seeds,
    seededFromUser,
    lastUsedFields,
    userSupplied,
    acknowledged,
    unfilledRequiredVisible: unfilledAgainst(effectiveValues),
    unfilledRequired: unfilledAgainst(userSupplied),
    unfilledRequiredAcknowledged: unfilledAgainst(acknowledged),
    requireAnyOfUnsatisfied,
    payload,
  });
}
