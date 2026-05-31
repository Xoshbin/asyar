/**
 * Returns the path to the Claude Code executable if set via env, or undefined
 * to let the SDK fall back to its own built-in resolution.
 */
export function claudeExecutablePath(): string | undefined {
  const p = process.env.CLAUDE_CODE_EXECUTABLE_PATH;
  return p && p.trim() ? p : undefined;
}

/** Error shape thrown by the builder, carrying the failing step + accumulated log. */
export interface BuilderError {
  step: string;
  message: string;
  log: string;
}

/** Type guard for a BuilderError-shaped thrown value. */
export function isBuilderError(e: unknown): e is BuilderError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'step' in e &&
    'message' in e &&
    'log' in e
  );
}

/** Best-effort message extraction from any thrown value. */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Tokens that are never acceptable anywhere in a command — networking,
 * fetch-and-exec, privilege escalation, destructive root deletes, fork bombs,
 * and piping into a shell. Belt-and-suspenders on top of the allowlist.
 */
const DENY_TOKEN_PATTERNS: RegExp[] = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bnc\b/i,
  /\bsudo\b/i,
  /chmod\s+\+x/i,
  /rm\s+-rf\s+\//i,
  /:\(\)\s*\{/, // fork bomb :(){
  /\|\s*(sh|bash|zsh)\b/i, // pipe into a shell
  /`/, // backtick command substitution
  /\$\(/, // $(...) command substitution
];

/**
 * Splits a command into the segments the shell would run independently. We
 * treat `&&`, `||`, `;`, single `|` (pipelines), and newlines / carriage
 * returns as separators so EVERY segment's program is allowlist-checked.
 * Order matters: `\|\|` must be matched before single `\|`.
 */
function splitSegments(cmd: string): string[] {
  return cmd.split(/&&|\|\||;|\n|\r|\|/);
}

/**
 * Flags that are safe to pass to `pnpm/npm install|i|ci`. They only influence
 * how an install runs (lockfile mode, script execution, output) — none of them
 * fetch or execute an arbitrary package. A `--reporter=<x>` value is allowed.
 */
const SAFE_INSTALL_FLAGS = new Set([
  '--frozen-lockfile',
  '--no-frozen-lockfile',
  '--prod',
  '--production',
  '--offline',
  '--prefer-offline',
  '--ignore-scripts',
  '--silent',
]);

/** Substrings that mark a token as a remote/local package spec (never allowed in install). */
const PACKAGE_SPEC_MARKERS = ['://', 'git+', 'file:', 'http', '.tgz', '.tar'];

function isSafeInstallFlag(token: string): boolean {
  if (token.startsWith('--reporter=')) return true;
  return SAFE_INSTALL_FLAGS.has(token);
}

function tokenLooksLikePackageSpec(token: string): boolean {
  return PACKAGE_SPEC_MARKERS.some((m) => token.includes(m));
}

/**
 * Returns the tokens of a segment with any leading `VAR=value` env-assignment
 * prefixes stripped, so the first returned token is the program itself.
 */
function programTokens(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).filter((t) => t !== '');
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  return tokens.slice(i);
}

/**
 * Subcommand-aware gate for a single pnpm/npm invocation. Fails CLOSED: only a
 * small set of install/run/script-shorthand forms pass; everything else (dlx,
 * exec, x, create, add, publish, store, …) is denied. `tokens[0]` is the
 * program (`pnpm`/`npm`); `tokens[1...]` are its arguments.
 */
function isAllowedPackageManager(tokens: string[]): boolean {
  // First non-flag token after the program is the subcommand.
  const args = tokens.slice(1);
  const subIdx = args.findIndex((t) => !t.startsWith('-'));
  if (subIdx === -1) return false; // bare `pnpm` with only flags / nothing.
  const sub = args[subIdx];
  const rest = args.slice(subIdx + 1);

  switch (sub) {
    case 'install':
    case 'i':
    case 'ci': {
      // Every remaining token must be a known-safe flag — no positionals
      // (a positional would be a package spec / URL / tarball / git ref).
      for (const t of rest) {
        if (!t.startsWith('-')) return false; // positional package spec
        if (tokenLooksLikePackageSpec(t)) return false;
        if (!isSafeInstallFlag(t)) return false; // unknown/foreign flag
      }
      return true;
    }
    case 'run': {
      // Only `pnpm run build` / `pnpm run test`.
      return rest[0] === 'build' || rest[0] === 'test';
    }
    case 'build':
    case 'test':
      // pnpm script shorthand (`pnpm build` / `pnpm test`).
      return true;
    default:
      // dlx, exec, x, create, add, remove, import, link, patch, publish,
      // config, store, and anything unrecognized → DENY.
      return false;
  }
}

/**
 * Classifies a single command segment (already split on shell operators) as
 * allowed or denied. Fails CLOSED. Allowed: `mkdir …`, `ls …`, bare `cd <dir>`,
 * and the safe pnpm/npm subcommand forms (see isAllowedPackageManager).
 */
function isAllowedSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true; // tolerate empty segments from a trailing operator
  // A bare `cd <dir>` segment (no following program) is benign.
  if (/^cd\s+\S+$/.test(trimmed)) return true;

  const tokens = programTokens(trimmed);
  if (tokens.length === 0) return false;
  const prog = tokens[0];

  if (prog === 'mkdir' || prog === 'ls') return true;
  if (prog === 'pnpm' || prog === 'npm') return isAllowedPackageManager(tokens);

  // Any other program (node, npx, curl, …) → DENY.
  return false;
}

/**
 * Pure classifier gating Bash commands for the builder agent. Fails CLOSED:
 * any uncertainty → DENY. A defense against prompt-injection (e.g. malicious
 * instructions embedded in fetched API docs) turning the build into RCE.
 */
export function isAllowedBashCommand(command: string): boolean {
  if (typeof command !== 'string') return false;
  const cmd = command.trim();
  if (!cmd) return false;

  // 1. Hard deny on any dangerous token (networking / exec / escalation /
  //    command substitution / pipe-to-shell). Belt-and-suspenders.
  for (const re of DENY_TOKEN_PATTERNS) {
    if (re.test(cmd)) return false;
  }

  // 2. Allowlist: EVERY segment must pass the subcommand-aware classifier.
  //    Segments are split on &&, ||, ;, single |, and newlines so nothing slips
  //    through inside a pipeline or a multi-line command. For pnpm/npm only a
  //    small set of safe subcommand forms pass (no dlx/exec/x/create/add/…).
  const segments = splitSegments(cmd);
  for (const seg of segments) {
    if (!isAllowedSegment(seg)) return false;
  }
  return true;
}
