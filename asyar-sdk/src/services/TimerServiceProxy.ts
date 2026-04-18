import type {
  ITimerService,
  ScheduleTimerOptions,
  TimerDescriptor,
} from './ITimerService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the one-shot persistent timer service.
 *
 * The host's IPC router injects the calling extension's id into every call
 * (timers is in `INJECTS_EXTENSION_ID`), so extensions can only address
 * their own timers.
 */
export class TimerServiceProxy extends BaseServiceProxy implements ITimerService {
  async schedule(opts: ScheduleTimerOptions): Promise<string> {
    return this.broker.invoke<string>('timers:schedule', { opts });
  }

  async cancel(timerId: string): Promise<void> {
    return this.broker.invoke<void>('timers:cancel', { timerId });
  }

  async list(): Promise<TimerDescriptor[]> {
    return this.broker.invoke<TimerDescriptor[]>('timers:list', {});
  }
}
