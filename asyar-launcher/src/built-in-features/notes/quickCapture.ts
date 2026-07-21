/** Apple Notes-style split of quick-capture text: first line → title (capped
 *  at 120 chars), the remaining lines → body. */
export function splitQuickCapture(text: string): { title: string; body: string } {
  const [firstLine, ...rest] = text.split('\n');
  return { title: (firstLine ?? '').trim().slice(0, 120), body: rest.join('\n') };
}
