/**
 * Strip HTML tags, script/style blocks, and decode common entities.
 * Uses regex — no DOM dependency, works in all environments.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Character mapping for Windows-1252 (Standard RTF encoding for 0x80-0x9F)
 */
const CP1252: Record<number, string> = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021',
  0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018',
  0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x98: '\u02DC',
  0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178',
};

const DESTINATIONS_TO_SKIP = new Set([
  'fonttbl', 'colortbl', 'expandedcolortbl', 'stylesheet', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'info', 'filetbl', 'revtbl', 'themedata', 'latentstyles', 'datastore',
  'pict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'bkmkstart', 'bkmkend', 'field', 'object', 'nonesttables', 'mmathPr', 'wgrffmtfilter', 'xmlnstbl'
]);

/**
 * Strip RTF control words, metadata groups (font/color tables), and decode escapes.
 * Uses a brace-aware single-pass scanner to avoid leaking structural text.
 */
export function stripRtf(rtf: string): string {
  if (!rtf) return '';

  let output = '';
  let i = 0;
  let depth = 0;
  const skipUntil: number[] = [];

  while (i < rtf.length) {
    const char = rtf[i];

    if (char === '{') {
      depth++;
      i++;
      // Check if this is a destination group to skip (e.g. {\fonttbl ...} or {\*\expandedcolortbl ...})
      if (rtf[i] === '\\') {
        let j = i + 1;
        let isIgnorable = false;
        if (rtf[j] === '*') {
          isIgnorable = true;
          j++;
          if (rtf[j] === '\\') j++;
        }
        let k = j;
        while (k < rtf.length && ((rtf[k] >= 'a' && rtf[k] <= 'z') || (rtf[k] >= 'A' && rtf[k] <= 'Z'))) {
          k++;
        }
        const keyword = rtf.substring(j, k);
        if (DESTINATIONS_TO_SKIP.has(keyword) || isIgnorable) {
          skipUntil.push(depth);
        }
      }
      continue;
    }

    if (char === '}') {
      if (skipUntil.length > 0 && skipUntil[skipUntil.length - 1] === depth) {
        skipUntil.pop();
      }
      depth--;
      i++;
      continue;
    }

    if (skipUntil.length > 0) {
      i++;
      continue;
    }

    if (char === '\\') {
      i++;
      const next = rtf[i];
      if (!next) break;

      if (next === '{' || next === '}' || next === '\\') {
        output += next;
        i++;
      } else if (next === "'") {
        const hex = rtf.substring(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          const byte = parseInt(hex, 16);
          output += byte < 128 ? String.fromCharCode(byte) : (CP1252[byte] || '');
          i += 3;
        } else {
          i++;
        }
      } else if (next === 'u') {
        let j = i + 1;
        let sign = 1;
        if (rtf[j] === '-') {
          sign = -1;
          j++;
        }
        const start = j;
        while (j < rtf.length && rtf[j] >= '0' && rtf[j] <= '9') {
          j++;
        }
        const numStr = rtf.substring(start, j);
        if (numStr) {
          const code = (parseInt(numStr, 10) * sign) & 0xFFFF;
          output += String.fromCodePoint(code);
          i = j;
          if (rtf[i] === '?') i++;
          if (i < rtf.length) i++; // Skip fallback char
        } else {
          i++;
        }
      } else if (next === '~') {
        output += ' ';
        i++;
      } else if (next === '_') {
        output += '-';
        i++;
      } else if ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z')) {
        let j = i;
        while (j < rtf.length && ((rtf[j] >= 'a' && rtf[j] <= 'z') || (rtf[j] >= 'A' && rtf[j] <= 'Z'))) {
          j++;
        }
        const keyword = rtf.substring(i, j);
        if (keyword === 'par' || keyword === 'line' || keyword === 'sect' || keyword === 'page') {
          output += ' ';
        } else if (keyword === 'tab') {
          output += '\t';
        }
        i = j;
        if (rtf[i] === '-') i++;
        while (i < rtf.length && rtf[i] >= '0' && rtf[i] <= '9') {
          i++;
        }
        if (rtf[i] === ' ') i++;
      } else {
        i++; // Skip non-letter extension
      }
    } else {
      output += char;
      i++;
    }
  }

  return output.replace(/\s+/g, ' ').trim();
}
