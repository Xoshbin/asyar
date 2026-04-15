import type { IPreferencesService, PreferenceValue } from './IPreferencesService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class PreferencesServiceProxy extends BaseServiceProxy implements IPreferencesService {
  getAll(): Promise<PreferenceValue> {
    return this.broker.invoke<PreferenceValue>('preferences:getAll');
  }

  set(scope: string, key: string, value: unknown): Promise<void> {
    return this.broker.invoke<void>('preferences:set', { scope, key, value });
  }

  reset(scope: string): Promise<void> {
    return this.broker.invoke<void>('preferences:reset', { scope });
  }
}
