import { getActiveContext } from './context';
import type { IClipboardHistoryService } from 'asyar-sdk/contracts';
import { ClipboardItemType } from 'asyar-sdk/contracts';

export namespace Clipboard {
  export type Content = {
    text?: string;
    html?: string;
    file?: string;
  };

  export type CopyOptions = {
    concealed?: boolean;
  };

  function getService(): IClipboardHistoryService {
    return getActiveContext().getService<IClipboardHistoryService>('clipboard');
  }

  function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  export async function copy(
    content: string | number | Content,
    _options?: CopyOptions,
  ): Promise<void> {
    const service = getService();
    const id = generateId();
    const createdAt = Date.now();

    if (typeof content === 'string' || typeof content === 'number') {
      await service.writeToClipboard({
        id,
        type: ClipboardItemType.Text,
        content: String(content),
        createdAt,
        favorite: false,
      });
      return;
    }

    if (content.file) {
      await service.writeToClipboard({
        id,
        type: ClipboardItemType.Files,
        content: JSON.stringify([content.file]),
        createdAt,
        favorite: false,
      });
      return;
    }

    if (content.html) {
      await service.writeToClipboard({
        id,
        type: ClipboardItemType.Html,
        content: content.html,
        createdAt,
        favorite: false,
      });
      return;
    }

    if (content.text !== undefined) {
      await service.writeToClipboard({
        id,
        type: ClipboardItemType.Text,
        content: content.text,
        createdAt,
        favorite: false,
      });
    }
  }

  export async function readText(): Promise<string | undefined> {
    const service = getService();
    const text = await service.readCurrentText();
    return text && text.length > 0 ? text : undefined;
  }

  export async function read(): Promise<Content> {
    const service = getService();
    const current = await service.readCurrentClipboard();
    if (!current || !current.content) {
      return {};
    }

    if (current.type === ClipboardItemType.Html) {
      return { html: current.content };
    }
    if (current.type === ClipboardItemType.Files) {
      try {
        const files = JSON.parse(current.content);
        return { file: files[0] };
      } catch {
        return { text: current.content };
      }
    }
    return { text: current.content };
  }

  export async function clear(): Promise<void> {
    const service = getService();
    await service.writeToClipboard({
      id: generateId(),
      type: ClipboardItemType.Text,
      content: '',
      createdAt: Date.now(),
      favorite: false,
    });
  }

  export async function paste(content: string | number | Content): Promise<void> {
    await copy(content);
    const service = getService();
    await service.simulatePaste();
  }
}
