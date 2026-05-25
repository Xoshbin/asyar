import { BaseServiceProxy } from './BaseServiceProxy';
import {
  isValidShortcode,
  type ISnippetsService,
  type ShortcodeMap,
} from '../contracts/snippets';

/** SDK-side proxy for the host snippets contribution service. */
export class SnippetsServiceProxy extends BaseServiceProxy implements ISnippetsService {
  async registerShortcodes(map: ShortcodeMap): Promise<void> {
    for (const [key, value] of Object.entries(map)) {
      if (!isValidShortcode(key)) {
        throw new Error(
          `[asyar-sdk/snippets:contract] invalid shortcode key "${key}" — ` +
          `must match /^:[a-z0-9_+-]{1,32}:$/`,
        );
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(
          `[asyar-sdk/snippets:contract] expansion for "${key}" must be a non-empty string`,
        );
      }
    }
    const broker = this.broker;
    await broker.invoke('snippets:registerShortcodes', { map });
  }

  async unregisterShortcodes(): Promise<void> {
    const broker = this.broker;
    await broker.invoke('snippets:unregisterShortcodes', {});
  }

  async listLearnedShortcodes(): Promise<Array<[string, string]>> {
    return this.broker.invoke<Array<[string, string]>>('snippets:listLearnedShortcodes', {});
  }

  async promoteLearnedShortcode(shortcode: string): Promise<void> {
    await this.broker.invoke('snippets:promoteLearnedShortcode', { shortcode });
  }

  async forgetLearnedShortcode(shortcode: string): Promise<void> {
    await this.broker.invoke('snippets:forgetLearnedShortcode', { shortcode });
  }

  async clearLearnedShortcodes(): Promise<void> {
    await this.broker.invoke('snippets:clearLearnedShortcodes', {});
  }

  async setInlineFallbackEnabled(enabled: boolean): Promise<void> {
    await this.broker.invoke('snippets:setInlineFallbackEnabled', { enabled });
  }
}
