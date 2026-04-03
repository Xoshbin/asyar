// Vite ?url imports give the correct hashed URL in both dev and production
import satoshiUrl from '../resources/fonts/Satoshi-Variable.woff2?url';
import satoshiItalicUrl from '../resources/fonts/Satoshi-VariableItalic.woff2?url';
import jetbrainsRegularUrl from '../resources/fonts/JetBrainsMono-Regular.woff2?url';
import jetbrainsMediumUrl from '../resources/fonts/JetBrainsMono-Medium.woff2?url';

let cachedFontCSS: string | null = null;

async function fetchAndEncodeFont(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export async function buildFontFaceCSS(): Promise<string> {
  if (cachedFontCSS) {
    return cachedFontCSS;
  }

  const [satoshiB64, satoshiItalicB64, jetbrainsRegularB64, jetbrainsMediumB64] = await Promise.all([
    fetchAndEncodeFont(satoshiUrl),
    fetchAndEncodeFont(satoshiItalicUrl),
    fetchAndEncodeFont(jetbrainsRegularUrl),
    fetchAndEncodeFont(jetbrainsMediumUrl)
  ]);

  cachedFontCSS = `
@font-face {
  font-family: "Satoshi";
  src: url("data:font/woff2;base64,${satoshiB64}") format("woff2");
  font-weight: 300 900;
  font-style: normal;
}
@font-face {
  font-family: "Satoshi";
  src: url("data:font/woff2;base64,${satoshiItalicB64}") format("woff2");
  font-weight: 300 900;
  font-style: italic;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("data:font/woff2;base64,${jetbrainsRegularB64}") format("woff2");
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("data:font/woff2;base64,${jetbrainsMediumB64}") format("woff2");
  font-weight: 500;
  font-style: normal;
}
  `.trim();

  return cachedFontCSS;
}
