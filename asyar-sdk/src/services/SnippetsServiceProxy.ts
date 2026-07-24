import { BaseServiceProxy } from './BaseServiceProxy';
import { isValidShortcode, type ISnippetsService, type ShortcodeMap } from '../contracts/snippets';

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
    await this.invoke('snippets:registerShortcodes', { map });
  }

  async unregisterShortcodes(): Promise<void> {
    await this.invoke('snippets:unregisterShortcodes', {});
  }
}
