export type TextIntent = 'natural' | 'exact' | 'verbatim';

export function getTextIntentAttributes(textIntent: TextIntent): Record<string, string> {
  if (textIntent === 'natural') return {};

  return {
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: textIntent === 'verbatim' ? 'true' : 'false',
  };
}
