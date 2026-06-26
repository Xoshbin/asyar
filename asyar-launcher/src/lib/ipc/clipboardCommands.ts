import { invokeSafe } from './invokeSafe';

export async function clipboardStripHtml(content: string): Promise<string> {
  return (await invokeSafe<string>('clipboard_strip_html', { content })) ?? '';
}

export async function clipboardStripRtf(content: string): Promise<string> {
  return (await invokeSafe<string>('clipboard_strip_rtf', { content })) ?? '';
}
