import type { IEntitlementService } from './IEntitlementService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class EntitlementServiceProxy extends BaseServiceProxy implements IEntitlementService {
  async check(entitlement: string): Promise<boolean> {
    return this.broker.invoke<boolean>('entitlements:check', { entitlement });
  }

  async getAll(): Promise<string[]> {
    return this.broker.invoke<string[]>('entitlements:getAll');
  }
}
