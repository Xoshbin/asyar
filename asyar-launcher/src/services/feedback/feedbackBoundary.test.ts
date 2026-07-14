import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const srcRoot = resolve(__dirname, '../..');
const repoRoot = resolve(srcRoot, '../..');

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|svelte)$/.test(path) && !path.endsWith('.test.ts') ? [path] : [];
  });
}

function violations(pattern: RegExp, allowed: ReadonlySet<string>): string[] {
  return sourceFiles(srcRoot)
    .filter((path) => !allowed.has(relative(srcRoot, path)))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repoRoot, path));
}

describe('feedback facade boundary', () => {
  it('is the only launcher module allowed to access native feedback children', () => {
    const allowed = new Set(['services/feedback/feedbackService.svelte.ts']);
    const directChildAccess =
      /services\/(?:diagnostics\/diagnosticsService|notification\/notificationService)|\bdiagnosticsService\.|\bcommands\.(?:showHud|hideHud|feedback(?:Publish|GetCurrent|UpdateProgress|FinishProgress|Dismiss|AcceptAnnouncement))\b|\bfeedback(?:Publish|GetCurrent|UpdateProgress|FinishProgress|Dismiss|AcceptAnnouncement)\s*\(/;

    expect(violations(directChildAccess, allowed)).toEqual([]);
  });

  it('keeps feedback presenters behind approved composition hosts', () => {
    const allowed = new Set([
      'components/layout/BottomActionBar.svelte',
      'components/layout/FeedbackBar.svelte',
      'routes/+page.svelte',
    ]);
    const childPresenterImport =
      /(?:ToastHost|FatalErrorDialog|FeedbackDetailsDialog|FeedbackBar)\.svelte/;

    expect(violations(childPresenterImport, allowed)).toEqual([]);
  });

  it('does not expose a notification child service or namespace', () => {
    const namespaces = readFileSync(resolve(repoRoot, 'asyar-sdk/src/ipc/namespaces.ts'), 'utf8');
    const contracts = readFileSync(resolve(repoRoot, 'asyar-sdk/src/contracts.ts'), 'utf8');

    expect(namespaces).not.toMatch(/^\s*'notifications',/m);
    expect(contracts).not.toMatch(/\bINotificationService\b/);
  });
});
