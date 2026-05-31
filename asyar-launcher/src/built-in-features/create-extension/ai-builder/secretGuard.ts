export interface ScannedFile {
  path: string;
  content: string;
}

export type SecretScanResult = { leaked: false } | { leaked: true; path: string };

export function scanForSecret(files: ScannedFile[], secret: string): SecretScanResult {
  const needle = secret.trim();
  if (needle.length === 0) return { leaked: false };
  for (const f of files) {
    if (f.content.includes(needle)) {
      return { leaked: true, path: f.path };
    }
  }
  return { leaked: false };
}
