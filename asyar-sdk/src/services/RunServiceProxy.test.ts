import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { messageBroker } from '../ipc/MessageBroker';
import { RunServiceProxy } from './RunServiceProxy';

describe('RunServiceProxy', () => {
  let invokeSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    invokeSpy = vi.spyOn(messageBroker, 'invoke').mockResolvedValue(undefined);
    onSpy = vi.spyOn(messageBroker, 'on').mockImplementation(() => {});
  });

  afterEach(() => {
    invokeSpy.mockRestore();
    onSpy.mockRestore();
  });

  it('start_dispatches_runs_start_with_input_envelope', async () => {
    const proxy = new RunServiceProxy();
    await proxy.start({ label: 'My Script', kind: 'shell-script' }).catch(() => {});
    expect(invokeSpy).toHaveBeenCalledWith(
      'runs:start',
      expect.objectContaining({
        id: expect.any(String),
        kind: 'shell-script',
        label: 'My Script',
        cancellable: expect.any(Boolean),
      }),
    );
  });

  it('start_returns_handle_with_id', async () => {
    const proxy = new RunServiceProxy();
    const handle = await proxy.start({ label: 'Job', kind: 'agent' }).catch(() => null);
    // With not-implemented throw, handle will be null — this test fails correctly
    expect(handle).not.toBeNull();
    expect(typeof handle!.id).toBe('string');
    expect(handle!.id.length).toBeGreaterThan(0);
  });

  it('start_returned_handle_id_matches_invoke_payload', async () => {
    const proxy = new RunServiceProxy();
    const handle = await proxy.start({ label: 'Job', kind: 'agent' }).catch(() => null);
    expect(handle).not.toBeNull();
    const [, payload] = invokeSpy.mock.calls[0];
    const sentId = (payload as { id: string }).id;
    expect(handle!.id).toBe(sentId);
  });

  it('start_default_cancellable_is_false', async () => {
    const proxy = new RunServiceProxy();
    await proxy.start({ label: 'Job', kind: 'agent' }).catch(() => {});
    expect(invokeSpy).toHaveBeenCalledWith(
      'runs:start',
      expect.objectContaining({ cancellable: false }),
    );
  });

  it('start_explicit_cancellable_passed_through', async () => {
    const proxy = new RunServiceProxy();
    await proxy.start({ label: 'Chat', kind: 'ai-chat', cancellable: true }).catch(() => {});
    expect(invokeSpy).toHaveBeenCalledWith(
      'runs:start',
      expect.objectContaining({ cancellable: true }),
    );
  });

  describe('handle methods', () => {
    let proxy: RunServiceProxy;
    let capturedOnHandler: ((payload: unknown) => void) | undefined;

    beforeEach(() => {
      proxy = new RunServiceProxy();
      // Capture the handler registered via broker.on so tests can fire events
      onSpy.mockImplementation((_event: string, handler: (payload: unknown) => void) => {
        capturedOnHandler = handler;
      });
    });

    async function getHandle() {
      return proxy.start({ label: 'X', kind: 'custom' });
    }

    it('handle_write_dispatches_runs_write', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      await handle!.write('line one').catch(() => {});
      expect(invokeSpy).toHaveBeenCalledWith(
        'runs:write',
        expect.objectContaining({ id: handle!.id, line: 'line one' }),
      );
    });

    it('handle_done_dispatches_runs_done', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      await handle!.done().catch(() => {});
      expect(invokeSpy).toHaveBeenCalledWith(
        'runs:done',
        expect.objectContaining({ id: handle!.id }),
      );
    });

    it('handle_fail_dispatches_runs_fail_with_error', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      await handle!.fail('boom').catch(() => {});
      expect(invokeSpy).toHaveBeenCalledWith(
        'runs:fail',
        expect.objectContaining({ id: handle!.id, error: 'boom' }),
      );
    });

    it('handle_cancel_dispatches_runs_cancel', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      await handle!.cancel().catch(() => {});
      expect(invokeSpy).toHaveBeenCalledWith(
        'runs:cancel',
        expect.objectContaining({ id: handle!.id }),
      );
    });

    it('handle_cancelled_starts_false', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      expect(handle!.cancelled).toBe(false);
    });

    it('handle_cancelled_becomes_true_when_cancel_event_received', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      expect(capturedOnHandler).toBeDefined();
      capturedOnHandler!({ id: handle!.id });
      expect(handle!.cancelled).toBe(true);
    });

    it('handle_onCancel_callback_fires_on_cancel_event', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      const cb = vi.fn();
      handle!.onCancel(cb);
      expect(capturedOnHandler).toBeDefined();
      capturedOnHandler!({ id: handle!.id });
      expect(cb).toHaveBeenCalledOnce();
    });

    it('handle_onCancel_unsubscribe_stops_callback', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      const cb = vi.fn();
      const unsubscribe = handle!.onCancel(cb);
      unsubscribe();
      expect(capturedOnHandler).toBeDefined();
      capturedOnHandler!({ id: handle!.id });
      expect(cb).not.toHaveBeenCalled();
    });

    it('handle_cancel_event_for_different_id_does_not_fire_callback', async () => {
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      const cb = vi.fn();
      handle!.onCancel(cb);
      expect(capturedOnHandler).toBeDefined();
      capturedOnHandler!({ id: 'some-other-run-id' });
      expect(cb).not.toHaveBeenCalled();
    });

    it('handle_cancel_unsubscribes_handler_even_when_broker_invoke_rejects', async () => {
      // Doc contract: cancel() must release the cancel-event subscription —
      // analogous to done() and fail() — even when the broker call fails
      // (e.g. unknown run id). Without try/finally the handler leaks because
      // the launcher never emits the event the handler was waiting for.
      const handle = await getHandle().catch(() => null);
      expect(handle).not.toBeNull();
      expect(capturedOnHandler).toBeDefined();

      const offSpy = vi.spyOn(messageBroker, 'off').mockImplementation(() => {});
      invokeSpy.mockImplementationOnce(async () => {
        throw new Error('run not found');
      });

      await expect(handle!.cancel()).rejects.toThrow('run not found');

      expect(offSpy).toHaveBeenCalledWith(
        'asyar:event:runs:cancel',
        capturedOnHandler,
      );
      offSpy.mockRestore();
    });
  });
});

describe('RunServiceProxy with setExtensionId', () => {
  it('handle methods use the per-instance broker (not global) after setExtensionId', async () => {
    const globalInvokeSpy = vi.spyOn(messageBroker, 'invoke').mockResolvedValue(undefined);
    vi.spyOn(messageBroker, 'on').mockImplementation(() => {});

    const proxy = new RunServiceProxy();
    proxy.setExtensionId('test.extension');

    // After setExtensionId, this.broker is a clone — spy on the clone instead
    const instanceBroker = (proxy as unknown as { broker: typeof messageBroker }).broker;
    const instanceInvokeSpy = vi.spyOn(instanceBroker, 'invoke').mockResolvedValue(undefined);
    vi.spyOn(instanceBroker, 'on').mockImplementation(() => {});
    vi.spyOn(instanceBroker, 'off').mockImplementation(() => {});

    // Reset global spy AFTER start() (because start() may call invoke; we only care about handle methods)
    globalInvokeSpy.mockClear();

    const handle = await proxy.start({ label: 'X', kind: 'shell-script' });
    instanceInvokeSpy.mockClear();
    globalInvokeSpy.mockClear();

    await handle.write('line');

    expect(instanceInvokeSpy).toHaveBeenCalledWith('runs:write', expect.objectContaining({ id: handle.id, line: 'line' }));
    expect(globalInvokeSpy).not.toHaveBeenCalled();

    instanceInvokeSpy.mockRestore();
    globalInvokeSpy.mockRestore();
  });
});
