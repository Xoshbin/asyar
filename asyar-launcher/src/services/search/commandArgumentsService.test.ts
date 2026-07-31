import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const commandArgDefaultsGet =
  vi.fn<(ext: string, cmd: string) => Promise<Record<string, string>>>();
const commandArgDefaultsSet =
  vi.fn<(ext: string, cmd: string, v: Record<string, string>) => Promise<void>>();
vi.mock('../../lib/ipc/commandArgDefaultsCommands', () => ({
  commandArgDefaultsGet: (ext: string, cmd: string) => commandArgDefaultsGet(ext, cmd),
  commandArgDefaultsSet: (ext: string, cmd: string, v: Record<string, string>) =>
    commandArgDefaultsSet(ext, cmd, v),
}));

import {
  CommandArgumentsService,
  fieldNeedsValue,
  seedArgumentValues,
} from './commandArgumentsService.svelte';
import type { CommandArgument } from 'asyar-sdk/contracts';

function makeDeps(opts: {
  args: CommandArgument[];
  extensionId?: string;
  commandId?: string;
  commandName?: string;
  icon?: string;
  isBuiltIn?: boolean;
  mode?: 'view' | 'background';
}) {
  const extensionId = opts.extensionId ?? 'org.asyar.demo';
  const commandId = opts.commandId ?? 'do-thing';
  const commandObjectId = `cmd_${extensionId}_${commandId}`;
  const executeBuiltInCommand =
    vi.fn<(id: string, args?: Record<string, unknown>) => Promise<unknown>>();
  const dispatchTier2Argument =
    vi.fn<
      (req: {
        extensionId: string;
        commandId: string;
        args: Record<string, string | number>;
        mode: 'view' | 'background';
      }) => Promise<void>
    >();
  const getManifestByCommandObjectId = vi.fn((id: string) => {
    if (id !== commandObjectId) return null;
    return {
      extensionId,
      commandId,
      commandName: opts.commandName ?? 'Do Thing',
      isBuiltIn: opts.isBuiltIn ?? false,
      icon: opts.icon,
      args: opts.args,
      mode: opts.mode,
    };
  });
  return {
    executeBuiltInCommand,
    dispatchTier2Argument,
    getManifestByCommandObjectId,
    extensionId,
    commandId,
    commandObjectId,
  };
}

describe('CommandArgumentsService', () => {
  beforeEach(() => {
    commandArgDefaultsGet.mockReset();
    commandArgDefaultsSet.mockReset();
    commandArgDefaultsGet.mockResolvedValue({});
    commandArgDefaultsSet.mockResolvedValue(undefined);
  });

  it('starts inactive', () => {
    const { executeBuiltInCommand, dispatchTier2Argument, getManifestByCommandObjectId } = makeDeps(
      { args: [] },
    );
    const svc = new CommandArgumentsService({
      executeBuiltInCommand,
      dispatchTier2Argument,
      getManifestByCommandObjectId,
    });
    expect(svc.active).toBeNull();
  });

  it('enter() loads manifest args, focuses field 0, ignores persisted text values', async () => {
    const args: CommandArgument[] = [
      { name: 'query', type: 'text', placeholder: 'Search' },
      { name: 'max', type: 'number', placeholder: 'Max results' },
    ];
    commandArgDefaultsGet.mockResolvedValueOnce({ query: 'prev-query' });
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);

    const ok = await svc.enter(d.commandObjectId);
    expect(ok).toBe(true);
    expect(svc.active).not.toBeNull();
    expect(svc.active!.extensionId).toBe(d.extensionId);
    expect(svc.active!.commandId).toBe(d.commandId);
    expect(svc.active!.args).toEqual(args);
    expect(svc.active!.values.query).toBe('');
    expect(svc.active!.currentFieldIdx).toBe(0);
    expect(commandArgDefaultsGet).toHaveBeenCalledWith(d.extensionId, d.commandId);
  });

  it('enter() leaves text/number fields empty despite a declared default', async () => {
    const args: CommandArgument[] = [
      { name: 'hours', type: 'number', placeholder: 'Hours', default: 0 },
      { name: 'label', type: 'text', default: 'work' },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values.hours).toBe('');
    expect(svc.active!.values.label).toBe('');
  });

  it('enter() restores a persisted dropdown selection over the default', async () => {
    const args: CommandArgument[] = [
      {
        name: 'lang',
        type: 'dropdown',
        default: 'en',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ];
    commandArgDefaultsGet.mockResolvedValueOnce({ lang: 'es' });
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values.lang).toBe('es');
  });

  it('enter() seeds dropdown default when no persisted value exists', async () => {
    const args: CommandArgument[] = [
      {
        name: 'lang',
        type: 'dropdown',
        default: 'en',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values.lang).toBe('en');
  });

  it('enter() returns false for unknown command id', async () => {
    const d = makeDeps({ args: [] });
    const svc = new CommandArgumentsService(d);
    const ok = await svc.enter('cmd_unknown_x');
    expect(ok).toBe(false);
    expect(svc.active).toBeNull();
  });

  it('enter() returns false when command has no arguments', async () => {
    const d = makeDeps({ args: [] });
    const svc = new CommandArgumentsService(d);
    const ok = await svc.enter(d.commandObjectId);
    expect(ok).toBe(false);
    expect(svc.active).toBeNull();
  });

  it('setValue() updates field state', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    expect(svc.active!.values.q).toBe('hello');
  });

  describe('the seeded state of a dropdown', () => {
    const args: CommandArgument[] = [
      {
        name: 'scope',
        type: 'dropdown',
        default: 'active',
        data: [
          { value: 'active', title: 'Active' },
          { value: 'all', title: 'All' },
        ],
      },
    ];

    it('enter() records what it seeded, separately from the value', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      expect(svc.active!.seeds).toEqual({ scope: 'active' });
      expect(svc.active!.edited.has('scope')).toBe(false);
    });

    it('setValue() promotes a seeded dropdown to a deliberate pick', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      // Same value the chip already showed: picking it is still a choice, and
      // the chip stops rendering it as a suggestion.
      svc.setValue('scope', 'active');
      expect(svc.active!.edited.has('scope')).toBe(true);
    });

    it('resetValue() puts back the seed and forgets the pick', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('scope', 'all');
      svc.resetValue('scope');
      expect(svc.active!.values.scope).toBe('active');
      expect(svc.active!.edited.has('scope')).toBe(false);
      // Nothing of the user's left to resume.
      svc.exit();
      expect(svc.stashFor(d.commandObjectId)).toBeNull();
    });

    it('resetValue() returns to the persisted seed, not a resumed stash', async () => {
      const d = makeDeps({ args });
      commandArgDefaultsGet.mockResolvedValue({ scope: 'all' });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('scope', 'active');
      svc.exit();
      await svc.enter(d.commandObjectId);
      expect(svc.active!.values.scope).toBe('active');
      svc.resetValue('scope');
      expect(svc.active!.values.scope).toBe('all');
    });

    it('resetValue() is a no-op for an untouched field', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      const before = svc.active;
      svc.resetValue('scope');
      expect(svc.active).toBe(before);
    });
  });

  it('focusField / next / prev move the cursor', async () => {
    const args: CommandArgument[] = [
      { name: 'a', type: 'text' },
      { name: 'b', type: 'text' },
      { name: 'c', type: 'text' },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.active!.currentFieldIdx).toBe(0);
    svc.next();
    expect(svc.active!.currentFieldIdx).toBe(1);
    svc.next();
    expect(svc.active!.currentFieldIdx).toBe(2);
    // Neither end wraps: the chip row hands off to the query instead.
    svc.next();
    expect(svc.active!.currentFieldIdx).toBe(2);
    svc.focusField(2);
    svc.prev();
    expect(svc.active!.currentFieldIdx).toBe(1);
    svc.focusField(0);
    expect(svc.active!.currentFieldIdx).toBe(0);
  });

  it('exit() stashes entered values and enter() restores them', async () => {
    const args: CommandArgument[] = [
      { name: 'hours', type: 'number', default: 0 },
      { name: 'minutes', type: 'number', default: 0 },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('hours', '1');
    svc.setValue('minutes', '2');
    svc.exit();
    expect(svc.active).toBeNull();
    expect(svc.stashFor(d.commandObjectId)).toEqual({ hours: '1', minutes: '2' });
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values).toEqual({ hours: '1', minutes: '2' });
  });

  it('exit() with all fields cleared drops any previous stash', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    await svc.enter(d.commandObjectId);
    svc.setValue('q', '');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('exit() carries the fields that were flagged, so the hint chips keep saying so', async () => {
    // Escape hands the caret back to the query the way Tab does, so a field
    // already marked as owing a value should not be let off by leaving.
    const d = makeDeps({ args: [{ name: 'who', type: 'text', required: true }] });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    expect(fieldNeedsValue(svc.active!, 0)).toBe(true);

    svc.exit();
    expect([...svc.flaggedFor(d.commandObjectId)]).toEqual(['who']);
  });

  it('exit() flags nothing when nothing was flagged', async () => {
    // Tab in, Escape straight back out: the field was never walked away from,
    // so there is nothing outstanding to carry.
    const d = makeDeps({ args: [{ name: 'who', type: 'text', required: true }] });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.exit();
    expect(svc.flaggedFor(d.commandObjectId).size).toBe(0);
  });

  it('drops the flags with the row they belong to', async () => {
    const d = makeDeps({ args: [{ name: 'who', type: 'text', required: true }] });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    svc.exit();

    svc.dropStashUnless('cmd_other_thing');
    expect(svc.flaggedFor(d.commandObjectId).size).toBe(0);
  });

  it('exit() leaves no stash when the user never touched a field', async () => {
    const args: CommandArgument[] = [
      { name: 'device', type: 'dropdown', data: [{ value: 'a', title: 'A' }] },
      { name: 'note', type: 'text' },
    ];
    const d = makeDeps({ args });
    commandArgDefaultsGet.mockResolvedValue({ device: 'a' });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    // The dropdown is auto-seeded from the persisted selection, not typed.
    expect(svc.active!.values.device).toBe('a');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('exit() stashes a dropdown the user actually changed', async () => {
    const args: CommandArgument[] = [
      {
        name: 'device',
        type: 'dropdown',
        data: [
          { value: 'a', title: 'A' },
          { value: 'b', title: 'B' },
        ],
      },
    ];
    const d = makeDeps({ args });
    commandArgDefaultsGet.mockResolvedValue({ device: 'a' });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('device', 'b');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).toEqual({ device: 'b' });
  });

  it('exit() after a resumed stash keeps it, with nothing retyped', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    await svc.enter(d.commandObjectId);
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).toEqual({ q: 'hello' });
  });

  it('exit() never stashes password values', async () => {
    const args: CommandArgument[] = [
      { name: 'user', type: 'text' },
      { name: 'secret', type: 'password' },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('user', 'me');
    svc.setValue('secret', 'hunter2');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).toEqual({ user: 'me' });
  });

  it('reset() abandons an open argument session and its stash', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.reset();
    expect(svc.active).toBeNull();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
    // Nothing kept back: re-entering starts from the declared hints.
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values.q).toBe('');
  });

  it('syncQuery() leaves an open session alone while the query is unchanged', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    svc.syncQuery('caffeinate');
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    // Typing in a chip does not touch the query, so this repeats verbatim.
    svc.syncQuery('caffeinate');
    svc.syncQuery('caffeinate');
    expect(svc.active).not.toBeNull();
    expect(svc.active!.values.q).toBe('hello');
  });

  it('syncQuery() abandons an open session when the query changes', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    svc.syncQuery('caffeinate');
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.syncQuery('caffeinat');
    expect(svc.active).toBeNull();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  // Regression: resetLauncherState and launcherController's post-action clear
  // both assign the query directly. Those fire no input event, which used to
  // strand populated chips above an emptied search field.
  it('syncQuery() abandons a session when the query is cleared programmatically', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    svc.syncQuery('caffeinate');
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.syncQuery('');
    expect(svc.active).toBeNull();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('syncQuery() clears a stash left by an Escape', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    svc.syncQuery('caffeinate');
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).not.toBeNull();
    svc.syncQuery('');
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('reset() also clears a stash left by a previous Escape', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).not.toBeNull();
    svc.reset();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('dropStashUnless() keeps the stash while its own row stays highlighted', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    svc.dropStashUnless(d.commandObjectId);
    expect(svc.stashFor(d.commandObjectId)).toEqual({ q: 'hello' });
  });

  it('dropStashUnless() discards the stash once the highlight moves elsewhere', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    svc.dropStashUnless('cmd_org.asyar.other_thing');
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
    // Coming back to the row starts from the declared hints, not the old input.
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values.q).toBe('');
  });

  it('a submitted dropdown selection survives the highlight moving away', async () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text' },
      {
        name: 'lang',
        type: 'dropdown',
        default: 'en',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.setValue('lang', 'es');
    await svc.submit();

    // Dropped stash must not take the persisted dropdown down with it.
    svc.dropStashUnless('cmd_org.asyar.other_thing');
    commandArgDefaultsGet.mockResolvedValueOnce({ lang: 'es' });
    await svc.enter(d.commandObjectId);
    expect(svc.active!.values.lang).toBe('es');
    expect(svc.active!.values.q).toBe('');
  });

  it('dropStashUnless(null) leaves the stash alone (results mid-refresh)', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    svc.dropStashUnless(null);
    expect(svc.stashFor(d.commandObjectId)).toEqual({ q: 'hello' });
  });

  describe('prepareRun', () => {
    const OPTIONS = [
      { value: 'en', title: 'English' },
      { value: 'es', title: 'Spanish' },
    ];

    /** What Enter on a freshly-highlighted command would do, and run with. */
    async function prepare(args: CommandArgument[], svc?: CommandArgumentsService) {
      const d = makeDeps({ args });
      const service = svc ?? new CommandArgumentsService(d);
      return service.prepareRun(
        d.commandObjectId,
        d.getManifestByCommandObjectId(d.commandObjectId)!,
      );
    }

    // Raycast fires a command whose arguments are all optional and lets the
    // extension deal with the blanks; Tab is the way to fill them in.
    it('does not stop a command whose arguments are all optional', async () => {
      const run = await prepare([
        { name: 'input', type: 'text' },
        { name: 'lang', type: 'dropdown', data: OPTIONS },
      ]);
      expect(run.needsEntry).toBe(false);
      // Nothing declared, nothing remembered: the command runs bare.
      expect(run.args).toEqual({});
    });

    it('stops on a required argument with nothing to fall back on', async () => {
      const run = await prepare([{ name: 'text', type: 'text', required: true }]);
      expect(run.needsEntry).toBe(true);
    });

    it('counts a declared default as filled, and sends it', async () => {
      const run = await prepare([{ name: 'text', type: 'text', required: true, default: 'hello' }]);
      expect(run.needsEntry).toBe(false);
      expect(run.args).toEqual({ text: 'hello' });
    });

    // The author declared the fallback, so a command fired without stopping
    // gets it. Running it from the list and running it from the chips send
    // the same payload.
    it('sends the declared defaults of optional arguments', async () => {
      const run = await prepare([
        { name: 'name', type: 'text' },
        { name: 'style', type: 'dropdown', default: 'casual', data: OPTIONS },
        { name: 'volume', type: 'number', default: 1 },
      ]);
      expect(run.needsEntry).toBe(false);
      expect(run.args).toEqual({ style: 'casual', volume: 1 });
    });

    it('counts a persisted dropdown selection as filled, and sends it', async () => {
      commandArgDefaultsGet.mockResolvedValue({ lang: 'es' });
      const run = await prepare([
        { name: 'lang', type: 'dropdown', required: true, data: OPTIONS },
      ]);
      expect(run.needsEntry).toBe(false);
      expect(run.args).toEqual({ lang: 'es' });
    });

    it('stops on a required dropdown that has never been chosen', async () => {
      const run = await prepare([
        { name: 'lang', type: 'dropdown', required: true, data: OPTIONS },
      ]);
      expect(run.needsEntry).toBe(true);
    });

    it('skips the storage read for a command with no dropdown to remember', async () => {
      // Only dropdowns are persisted, so a text-only command is already
      // settled, so Enter should not wait on IPC to say so.
      const run = await prepare([{ name: 'text', type: 'text', required: true }]);
      expect(run.needsEntry).toBe(true);
      expect(commandArgDefaultsGet).not.toHaveBeenCalled();
    });

    it('counts values stashed by an earlier escape as filled, and sends them', async () => {
      const args: CommandArgument[] = [{ name: 'text', type: 'text', required: true }];
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('text', 'hello');
      svc.exit();

      const meta = d.getManifestByCommandObjectId(d.commandObjectId)!;
      const run = await svc.prepareRun(d.commandObjectId, meta);
      expect(run.needsEntry).toBe(false);
      expect(run.args).toEqual({ text: 'hello' });
    });

    it('stops when a required field is the one the stash left empty', async () => {
      const args: CommandArgument[] = [
        { name: 'text', type: 'text', required: true },
        { name: 'note', type: 'text' },
      ];
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('note', 'later');
      svc.exit();

      const meta = d.getManifestByCommandObjectId(d.commandObjectId)!;
      expect((await svc.prepareRun(d.commandObjectId, meta)).needsEntry).toBe(true);
    });

    it('runs a mixed command whose required argument is already satisfied', async () => {
      commandArgDefaultsGet.mockResolvedValue({ lang: 'es' });
      const run = await prepare([
        { name: 'lang', type: 'dropdown', required: true, data: OPTIONS },
        { name: 'note', type: 'text', default: 'n/a' },
      ]);
      expect(run.needsEntry).toBe(false);
      expect(run.args).toEqual({ lang: 'es', note: 'n/a' });
    });
  });

  describe('syncSelection', () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];

    // Regression: arrowing the result list left argument mode running, so the
    // chips (red border and all) stayed up for a command the highlight had
    // long since left, and Enter would have run that one.
    it('ends argument entry once the highlight moves to another row', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('q', 'hello');

      svc.syncSelection('cmd_org.asyar.other_thing');

      expect(svc.active).toBeNull();
      // The move takes the values with it, same as any other move.
      expect(svc.stashFor(d.commandObjectId)).toBeNull();
    });

    it('leaves it running while its own row stays highlighted', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('q', 'hello');

      svc.syncSelection(d.commandObjectId);

      expect(svc.active).not.toBeNull();
      expect(svc.active!.values.q).toBe('hello');
    });

    it('treats a null id as results mid-refresh, not as a move', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('q', 'hello');

      svc.syncSelection(null);

      expect(svc.active).not.toBeNull();
    });

    it('still drops a stash from another row when nothing is being entered', async () => {
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('q', 'hello');
      svc.exit();

      svc.syncSelection('cmd_org.asyar.other_thing');

      expect(svc.stashFor(d.commandObjectId)).toBeNull();
    });
  });

  it('runWithStash() dispatches with the stashed values and clears the stash', async () => {
    const args: CommandArgument[] = [
      { name: 'hours', type: 'number', default: 0 },
      { name: 'minutes', type: 'number', default: 0 },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('minutes', '45');
    svc.exit();
    const ran = await svc.runWithStash(d.commandObjectId);
    expect(ran).toBe(true);
    const payload = d.dispatchTier2Argument.mock.calls[0][0];
    expect(payload.args).toEqual({ hours: 0, minutes: 45 });
    expect(svc.active).toBeNull();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('runWithStash() stays in argument mode when a required field is missing', async () => {
    const args: CommandArgument[] = [
      { name: 'note', type: 'text' },
      { name: 'when', type: 'text', required: true },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('note', 'hi');
    svc.exit();
    const ran = await svc.runWithStash(d.commandObjectId);
    expect(ran).toBe(true);
    expect(d.dispatchTier2Argument).not.toHaveBeenCalled();
    expect(svc.active).not.toBeNull();
    expect(svc.active!.values.note).toBe('hi');
  });

  it('runWithStash() returns false with no stash', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    const ran = await svc.runWithStash(d.commandObjectId);
    expect(ran).toBe(false);
    expect(svc.active).toBeNull();
  });

  it('submit() clears the stash for the command', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.exit();
    expect(svc.stashFor(d.commandObjectId)).not.toBeNull();
    await svc.enter(d.commandObjectId);
    await svc.submit();
    expect(svc.stashFor(d.commandObjectId)).toBeNull();
  });

  it('canSubmit() is false when a required text field is empty', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.canSubmit()).toBe(false);
    svc.setValue('q', 'hi');
    expect(svc.canSubmit()).toBe(true);
  });

  it('canSubmit() is false when a required number field is not a valid number', async () => {
    const args: CommandArgument[] = [{ name: 'n', type: 'number', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('n', 'abc');
    expect(svc.canSubmit()).toBe(false);
    svc.setValue('n', '42');
    expect(svc.canSubmit()).toBe(true);
  });

  it('canSubmit() is true with no required args and empty optional', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.canSubmit()).toBe(true);
  });

  it('canSubmit() is true when a required field is empty but has a default', async () => {
    const args: CommandArgument[] = [{ name: 'n', type: 'number', required: true, default: 0 }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.canSubmit()).toBe(true);
  });

  it('validationError() stays null for a required field that is merely empty', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    // The chip's own border carries this, it is not an error message.
    expect(svc.validationError()).toBeNull();
    expect(svc.canSubmit()).toBe(false);
    svc.setValue('q', 'hi');
    expect(svc.canSubmit()).toBe(true);
  });

  it('validationError() names the offending number field', async () => {
    const args: CommandArgument[] = [{ name: 'n', type: 'number', placeholder: 'Minutes' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('n', 'abc');
    expect(svc.validationError()).toBe('Minutes must be a number');
    expect(svc.canSubmit()).toBe(false);
    svc.setValue('n', '42');
    expect(svc.validationError()).toBeNull();
  });

  it('validationError() falls back to the argument name without a placeholder', async () => {
    const args: CommandArgument[] = [{ name: 'volume', type: 'number' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('volume', 'loud');
    expect(svc.validationError()).toBe('volume must be a number');
  });

  it('says nothing until the user actually tries to run', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    // Entering the mode is not an error: an empty field is just unfilled.
    expect(svc.feedbackMessage()).toBeNull();

    await svc.submit();
    expect(svc.feedbackMessage()).toBe('Value is missing in argument q');
    expect(d.dispatchTier2Argument).not.toHaveBeenCalled();
  });

  it('drops the blocked notice as soon as the user edits a field', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    expect(svc.feedbackMessage()).toBe('Value is missing in argument q');
    svc.setValue('q', 'h');
    expect(svc.feedbackMessage()).toBeNull();
  });

  it('a blocked submit still runs once the field is filled', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    svc.setValue('q', 'hi');
    await svc.submit();
    expect(d.dispatchTier2Argument).toHaveBeenCalledTimes(1);
    expect(svc.feedbackMessage()).toBeNull();
  });

  it('an unparseable value outranks the blocked notice', async () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text', required: true },
      { name: 'n', type: 'number', placeholder: 'Count' },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('n', 'abc');
    await svc.submit();
    expect(svc.feedbackMessage()).toBe('Count must be a number');
  });

  it('leaving argument mode clears the notice', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    svc.exit();
    expect(svc.feedbackMessage()).toBeNull();
  });

  it('validationError() is null outside argument mode', () => {
    const d = makeDeps({ args: [] });
    const svc = new CommandArgumentsService(d);
    expect(svc.validationError()).toBeNull();
    expect(svc.canSubmit()).toBe(false);
  });

  it('submit() fills declared defaults for empty fields in the payload', async () => {
    const args: CommandArgument[] = [
      { name: 'hours', type: 'number', default: 0 },
      { name: 'minutes', type: 'number', default: 0 },
      { name: 'note', type: 'text' },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('minutes', '15');
    await svc.submit();
    const payload = d.dispatchTier2Argument.mock.calls[0][0];
    expect(payload.args).toEqual({ hours: 0, minutes: 15 });
  });

  it('submit() never persists text or number values', async () => {
    const args: CommandArgument[] = [
      { name: 'hours', type: 'number', default: 0 },
      { name: 'note', type: 'text' },
    ];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('hours', '2');
    svc.setValue('note', 'standup');
    await svc.submit();
    const persisted = commandArgDefaultsSet.mock.calls[0][2];
    expect(persisted).toEqual({});
  });

  it('submit() for a Tier 2 command routes through dispatchTier2Argument, never executeBuiltInCommand', async () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text', required: true },
      { name: 'n', type: 'number' },
    ];
    const d = makeDeps({ args, isBuiltIn: false });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.setValue('n', '7');
    await svc.submit();

    expect(d.dispatchTier2Argument).toHaveBeenCalledWith({
      extensionId: d.extensionId,
      commandId: d.commandId,
      commandObjectId: d.commandObjectId,
      args: { q: 'hello', n: 7 },
      mode: 'view',
    });
    expect(d.executeBuiltInCommand).not.toHaveBeenCalled();
    expect(svc.active).toBeNull();
  });

  it('submit() threads manifest mode=background through to dispatchTier2Argument (regression: caffeinate-for was dispatched as view and timed out against the view iframe)', async () => {
    const args: CommandArgument[] = [
      { name: 'hours', type: 'number' },
      { name: 'minutes', type: 'number' },
    ];
    const d = makeDeps({ args, isBuiltIn: false, mode: 'background' });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('hours', '0');
    svc.setValue('minutes', '2');
    await svc.submit();

    expect(d.dispatchTier2Argument).toHaveBeenCalledWith({
      extensionId: d.extensionId,
      commandId: d.commandId,
      commandObjectId: d.commandObjectId,
      args: { hours: 0, minutes: 2 },
      mode: 'background',
    });
  });

  it('submit() for a Tier 1 (built-in) command routes through executeBuiltInCommand', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args, isBuiltIn: true });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hi');
    await svc.submit();

    expect(d.executeBuiltInCommand).toHaveBeenCalledWith(d.commandObjectId, {
      arguments: { q: 'hi' },
    });
    expect(d.dispatchTier2Argument).not.toHaveBeenCalled();
  });

  it('submit() persists only dropdown selections', async () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text', required: true },
      { name: 'apiKey', type: 'password' },
      {
        name: 'lang',
        type: 'dropdown',
        data: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Spanish' },
        ],
      },
    ];
    const d = makeDeps({ args, isBuiltIn: false });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hello');
    svc.setValue('apiKey', 'sk-secret');
    svc.setValue('lang', 'es');
    await svc.submit();

    expect(commandArgDefaultsSet).toHaveBeenCalledWith(d.extensionId, d.commandId, { lang: 'es' });
  });

  it('submit() does nothing when required fields are missing', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text', required: true }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    expect(d.executeBuiltInCommand).not.toHaveBeenCalled();
    expect(d.dispatchTier2Argument).not.toHaveBeenCalled();
    expect(svc.active).not.toBeNull();
  });

  it('submit() preserves argument-mode when dispatch throws', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args, isBuiltIn: false });
    d.dispatchTier2Argument.mockRejectedValueOnce(new Error('boom'));
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('q', 'hi');
    await expect(svc.submit()).rejects.toThrow('boom');
    expect(svc.active).not.toBeNull();
  });

  it('exit() clears state', async () => {
    const args: CommandArgument[] = [{ name: 'q', type: 'text' }];
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.exit();
    expect(svc.active).toBeNull();
  });

  it('submit() drops empty-string values from the arguments payload', async () => {
    const args: CommandArgument[] = [
      { name: 'a', type: 'text', required: true },
      { name: 'b', type: 'text' },
    ];
    const d = makeDeps({ args, isBuiltIn: false });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('a', 'hi');
    // b is left as empty string
    await svc.submit();
    const payload = d.dispatchTier2Argument.mock.calls[0][0];
    expect(payload.args).toEqual({ a: 'hi' });
    expect(payload.args).not.toHaveProperty('b');
  });

  describe('dynamic command persistence keying', () => {
    function makeDynamicDeps() {
      const extensionId = 'org.asyar.shortcuts';
      const dynamicId = 'uuid-1';
      const commandObjectId = `cmd_${extensionId}_dyn_${dynamicId}`;
      const args: CommandArgument[] = [
        {
          name: 'input',
          type: 'dropdown',
          data: [
            { value: '85', title: '85%' },
            { value: 'last value', title: 'Last' },
          ],
        },
      ];
      return {
        extensionId,
        dynamicId,
        commandObjectId,
        args,
        executeBuiltInCommand: vi.fn(),
        dispatchTier2Argument: vi.fn().mockResolvedValue(undefined),
        getManifestByCommandObjectId: vi.fn(async (id: string) => {
          if (id !== commandObjectId) return null;
          return {
            extensionId,
            commandId: dynamicId,
            commandName: 'Run Lights',
            isBuiltIn: false,
            icon: undefined,
            args,
            mode: 'background' as const,
            isDynamic: true,
          };
        }),
      };
    }

    it('enter() loads defaults using dynamic: prefix in storage key', async () => {
      const d = makeDynamicDeps();
      commandArgDefaultsGet.mockResolvedValueOnce({ input: 'last value' });
      const svc = new CommandArgumentsService(d);

      const ok = await svc.enter(d.commandObjectId);
      expect(ok).toBe(true);
      // Key sent to Rust must namespace the dynamic id.
      expect(commandArgDefaultsGet).toHaveBeenCalledWith(d.extensionId, `dynamic:${d.dynamicId}`);
      // Pre-fill from persisted value still applies.
      expect(svc.active?.values.input).toBe('last value');
    });

    it('submit() persists with the dynamic: storage prefix', async () => {
      const d = makeDynamicDeps();
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('input', '85');
      await svc.submit();
      expect(commandArgDefaultsSet).toHaveBeenCalledWith(d.extensionId, `dynamic:${d.dynamicId}`, {
        input: '85',
      });
    });

    it('submit() dispatches the bare commandId (no dynamic: prefix) so the worker handler matches', async () => {
      const d = makeDynamicDeps();
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('input', '85');
      await svc.submit();
      const dispatched = d.dispatchTier2Argument.mock.calls[0][0];
      expect(dispatched.commandId).toBe(d.dynamicId);
      expect(dispatched.commandId).not.toContain('dynamic:');
    });

    it('manifest commands without isDynamic still use the bare key (regression)', async () => {
      const args: CommandArgument[] = [
        {
          name: 'q',
          type: 'dropdown',
          data: [
            { value: 'a', title: 'A' },
            { value: 'b', title: 'B' },
          ],
        },
      ];
      const d = makeDeps({ args });
      const svc = new CommandArgumentsService(d);
      await svc.enter(d.commandObjectId);
      svc.setValue('q', 'b');
      await svc.submit();
      // Bare commandId, no `dynamic:` prefix
      expect(commandArgDefaultsSet).toHaveBeenCalledWith(d.extensionId, d.commandId, { q: 'b' });
    });
  });
});

describe('a `default` of null (the shape Rust actually sends)', () => {
  // Manifests round-trip through Rust, where an omitted `default` comes back
  // as JSON null. Treating that as "has a default" skipped every required
  // check and put the string "null" into dispatch payloads.
  const NULL_DEFAULT = [
    { name: 'who', type: 'text', required: true, default: null },
    { name: 'style', type: 'dropdown', default: null, data: [{ value: 'a', title: 'A' }] },
  ] as unknown as CommandArgument[];

  it('still enforces the required field', async () => {
    const d = makeDeps({ args: NULL_DEFAULT });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    expect(svc.canSubmit()).toBe(false);
    svc.setValue('who', 'Lucas');
    expect(svc.canSubmit()).toBe(true);
  });

  it('refuses the submit and says which argument is missing', async () => {
    const d = makeDeps({ args: NULL_DEFAULT });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    await svc.submit();
    expect(d.dispatchTier2Argument).not.toHaveBeenCalled();
    expect(svc.feedbackMessage()).toBe('Value is missing in argument who');
  });

  it('never puts the string "null" in the payload', async () => {
    const d = makeDeps({ args: NULL_DEFAULT });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    svc.setValue('who', 'Lucas');
    await svc.submit();
    const payload = d.dispatchTier2Argument.mock.calls[0][0].args;
    expect(payload).toEqual({ who: 'Lucas' });
    expect(Object.values(payload)).not.toContain('null');
  });

  it('seeds a null-default dropdown empty rather than to "null"', () => {
    expect(seedArgumentValues(NULL_DEFAULT, {})).toEqual({ who: '', style: '' });
  });
});

describe('fieldNeedsValue', () => {
  const REQUIRED: CommandArgument[] = [
    { name: 'who', type: 'text', required: true },
    { name: 'note', type: 'text' },
  ];

  async function enterWith(args: CommandArgument[]) {
    const d = makeDeps({ args });
    const svc = new CommandArgumentsService(d);
    await svc.enter(d.commandObjectId);
    return { svc, d };
  }

  it('stays quiet while the field is still focused', async () => {
    const { svc } = await enterWith(REQUIRED);
    expect(fieldNeedsValue(svc.active!, 0)).toBe(false);
  });

  it('flags a required field once focus leaves it empty', async () => {
    const { svc } = await enterWith(REQUIRED);
    svc.next();
    expect(fieldNeedsValue(svc.active!, 0)).toBe(true);
  });

  it('clears once the field has a value', async () => {
    const { svc } = await enterWith(REQUIRED);
    svc.setValue('who', 'Lucas');
    svc.next();
    expect(fieldNeedsValue(svc.active!, 0)).toBe(false);
  });

  it('flags a required field once focus goes back to the query', async () => {
    // Nothing to step to on a one-field command, so leaving for the query is
    // the only way to walk away from it.
    const { svc } = await enterWith([{ name: 'who', type: 'text', required: true }]);
    expect(fieldNeedsValue(svc.active!, 0)).toBe(false);
    svc.blurFields();
    expect(fieldNeedsValue(svc.active!, 0)).toBe(true);
  });

  it('flags the field being edited once Enter has been refused over it', async () => {
    // Standing in it is not yet failing to fill it, but asking for the command
    // to run is: with one field there is nowhere else for the blame to land.
    const { svc } = await enterWith([{ name: 'who', type: 'text', required: true }]);
    await svc.submit();
    expect(svc.active!.currentFieldIdx).toBe(0);
    expect(fieldNeedsValue(svc.active!, 0)).toBe(true);
  });

  it('stops flagging the edited field as soon as it is typed into', async () => {
    const { svc } = await enterWith([
      { name: 'who', type: 'text', required: true },
      { name: 'note', type: 'text' },
    ]);
    await svc.submit();
    expect(fieldNeedsValue(svc.active!, 0)).toBe(true);
    svc.setValue('note', 'anything');
    expect(fieldNeedsValue(svc.active!, 0)).toBe(false);
  });

  it('never flags an optional field', async () => {
    const { svc } = await enterWith(REQUIRED);
    svc.next();
    expect(fieldNeedsValue(svc.active!, 1)).toBe(false);
  });

  it('never flags a required field carrying a declared default', async () => {
    const { svc } = await enterWith([
      { name: 'a', type: 'text', required: true, default: 'x' },
      { name: 'b', type: 'text' },
    ]);
    svc.next();
    expect(fieldNeedsValue(svc.active!, 0)).toBe(false);
  });

  it('leaves a field the user never reached alone until a submit is refused', async () => {
    const { svc } = await enterWith([
      { name: 'first', type: 'text' },
      { name: 'second', type: 'text', required: true },
    ]);
    // Never focused, so nothing to answer for yet.
    expect(fieldNeedsValue(svc.active!, 1)).toBe(false);
    await svc.submit();
    expect(fieldNeedsValue(svc.active!, 1)).toBe(true);
  });
});

describe('seedArgumentValues', () => {
  const OPTIONS = [
    { value: 'a', title: 'A' },
    { value: 'b', title: 'B' },
  ];

  it('prefers a persisted dropdown selection over the declared default', () => {
    const args: CommandArgument[] = [
      { name: 'device', type: 'dropdown', data: OPTIONS, default: 'a' },
    ];
    expect(seedArgumentValues(args, { device: 'b' })).toEqual({ device: 'b' });
  });

  it('falls back to the declared default, then the empty string', () => {
    const args: CommandArgument[] = [
      { name: 'withDefault', type: 'dropdown', data: OPTIONS, default: 'a' },
      { name: 'bare', type: 'dropdown', data: OPTIONS },
    ];
    expect(seedArgumentValues(args, {})).toEqual({ withDefault: 'a', bare: '' });
  });

  it('leaves every non-dropdown type empty so its placeholder shows', () => {
    const args: CommandArgument[] = [
      { name: 'q', type: 'text', default: 'stale' },
      { name: 'n', type: 'number', default: 7 },
      { name: 'p', type: 'password' },
    ];
    expect(seedArgumentValues(args, { q: 'persisted', n: '3', p: 'hunter2' })).toEqual({
      q: '',
      n: '',
      p: '',
    });
  });
});
