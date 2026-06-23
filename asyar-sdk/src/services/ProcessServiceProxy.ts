import type {
  IProcessService,
  AppGroup,
  KillResult,
  ListProcessesOptions,
  KillProcessesOptions,
} from './IProcessService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the host process service. The IPC router injects the calling
 * extension's id; the host gates `process:read` / `process:kill`.
 */
export class ProcessServiceProxy extends BaseServiceProxy implements IProcessService {
  async list(options: ListProcessesOptions): Promise<AppGroup[]> {
    return this.broker.invoke<AppGroup[]>('process:list', {
      query: options.query,
      sortBy: options.sortBy,
    });
  }

  async kill(options: KillProcessesOptions): Promise<KillResult> {
    return this.broker.invoke<KillResult>('process:kill', {
      pids: options.pids,
      force: options.force,
      confirmedProtected: options.confirmedProtected ?? false,
    });
  }
}
