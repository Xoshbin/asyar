import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const PRIVACY_SECTION_FILES = [
  'EncryptionStatusSection.svelte',
  'CrashReportSection.svelte',
  'UsageShareSection.svelte',
  'ClipboardPrivacySection.svelte',
  'SecretRedactionSection.svelte',
  'ShellTrustManager.svelte',
];

function readComponent(fileName: string): string {
  return readFileSync(resolve(here, fileName), 'utf8');
}

describe('privacy settings section layout', () => {
  it('uses migrated SettingsCard sections instead of the legacy SettingsSection wrapper', () => {
    for (const fileName of PRIVACY_SECTION_FILES) {
      const source = readComponent(fileName);
      expect(source, `${fileName} should use SettingsCard`).toContain('SettingsCard');
      expect(source, `${fileName} should not render legacy SettingsSection`).not.toContain(
        'SettingsSection',
      );
    }
  });
});
