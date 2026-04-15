import { BaseServiceProxy } from './BaseServiceProxy';
import type { ISettingsService } from './ISettingsService';

export class SettingsServiceProxy extends BaseServiceProxy implements ISettingsService {
  async get<T>(section: string, key: string): Promise<T> {
    return this.broker.invoke<T>('settings:get', { section, key });
  }

  async set<T>(section: string, key: string, value: T): Promise<void> {
    return this.broker.invoke<void>('settings:set', { section, key, value });
  }

  onChanged<T>(section: string, callback: (settings: T) => void): () => void {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'asyar:event:settingsChanged' && e.data?.section === section) {
        callback(e.data.payload);
      }
    };

    window.addEventListener('message', handler);

    return () => {
      window.removeEventListener('message', handler);
    };
  }
}
