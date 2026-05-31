import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { emit, type BuilderCommand } from './protocol';
import { buildGatePrompt, parseVerdict, type Capabilities } from './feasibilityGate';
import { runBuilder } from './builder';
import { isBuilderError, errMessage, claudeExecutablePath } from './utils';

export interface ParsedArgs {
  prompt: string;
  targetDir: string;
  capabilitySpec: string;
}

/** Parses `--prompt`, `--target-dir`, `--capability-spec` from an argv list. */
export function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string => {
    const i = argv.indexOf(flag);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    return '';
  };
  return {
    prompt: get('--prompt'),
    targetDir: get('--target-dir'),
    capabilitySpec: get('--capability-spec'),
  };
}

/**
 * Tracks pending `ask_user` questions and routes inbound answers back to the
 * awaiting caller. Shared by askUser (registers) and the stdin handler (resolves).
 */
export class QuestionRegistry {
  private waiters = new Map<string, (value: string) => void>();
  private seq = 0;

  /** Registers a new question, returning its id + a promise that settles on answer. */
  register(): { id: string; promise: Promise<string> } {
    const id = `q${++this.seq}_${Date.now().toString(36)}`;
    const promise = new Promise<string>((resolve) => {
      this.waiters.set(id, resolve);
    });
    return { id, promise };
  }

  /** Resolves a pending question. No-ops on unknown ids. Returns true if matched. */
  resolve(id: string, value: string): boolean {
    const w = this.waiters.get(id);
    if (!w) return false;
    this.waiters.delete(id);
    w(value);
    return true;
  }

  /** Number of still-pending questions (for tests / diagnostics). */
  get pending(): number {
    return this.waiters.size;
  }
}

/** Splits a growing buffer into complete lines, returning [lines, remainder]. */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

/**
 * Single-shot model call for the feasibility gate. No tools, no cwd writes.
 * Concatenates the streamed assistant text. ANTHROPIC_API_KEY is read from env
 * by the SDK automatically; we guard for its absence in run().
 */
export async function modelComplete(prompt: string): Promise<string> {
  // `tools: []` fully removes built-in tools from the model's context, so a
  // stray tool_use can't trigger a permission prompt that would corrupt the
  // JSON event stream on stdout. (allowedTools:[] alone keeps them in context.)
  const options: Options = {
    maxTurns: 1,
    tools: [],
    ...(claudeExecutablePath() !== undefined ? { pathToClaudeCodeExecutable: claudeExecutablePath() } : {}),
  };
  let text = '';
  const q = query({ prompt, options });
  for await (const message of q) {
    if (message.type === 'assistant') {
      const blocks = message.message.content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text;
          }
        }
      }
    } else if (message.type === 'result' && message.subtype === 'success') {
      if (typeof message.result === 'string' && message.result.length > 0) {
        text = text.length > 0 ? text : message.result;
      }
    }
  }
  return text;
}

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  // Fail fast & gracefully if the key is missing — never crash.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim().length === 0) {
    emit({ kind: 'fail', step: 'config', error: 'ANTHROPIC_API_KEY missing', log: '' });
    process.exit(1);
  }

  const registry = new QuestionRegistry();
  const abortController = new AbortController();

  // ---- stdin: one JSON BuilderCommand per line ----
  let stdinBuffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    stdinBuffer += chunk;
    const { lines, rest } = takeLines(stdinBuffer);
    stdinBuffer = rest;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let cmd: BuilderCommand;
      try {
        cmd = JSON.parse(trimmed) as BuilderCommand;
      } catch {
        continue; // ignore malformed lines
      }
      if (cmd.kind === 'answer') {
        registry.resolve(cmd.questionId, cmd.value);
      } else if (cmd.kind === 'cancel') {
        try {
          abortController.abort();
        } catch {
          /* ignore */
        }
        // Exit non-zero (130 = SIGINT convention) so the host can distinguish
        // a user cancellation from a successful completion.
        process.exit(130);
      }
    }
  });

  /** Emits an `ask` event and blocks until the host replies on stdin. */
  const askUser = (prompt: string, inputKind: 'text' | 'confirm' | 'secret'): Promise<string> => {
    const { id, promise } = registry.register();
    emit({ kind: 'ask', questionId: id, prompt, inputKind });
    return promise;
  };

  try {
    // ---- read the capability spec ----
    const caps = readCapabilities(args.capabilitySpec);
    const authoringGuide = readAuthoringGuide(args.capabilitySpec);

    // ---- feasibility gate ----
    const gatePrompt = buildGatePrompt(args.prompt, caps);
    const raw = await modelComplete(gatePrompt);
    const verdict = parseVerdict(raw);
    emit({ kind: 'verdict', possible: verdict.possible, reason: verdict.reason, ...(verdict.degradedNote ? { degradedNote: verdict.degradedNote } : {}) });
    if (!verdict.possible) {
      // No files written on an impossible verdict.
      process.exit(0);
    }

    // ---- builder ----
    const out = await runBuilder({
      prompt: args.prompt,
      baseDir: args.targetDir,
      capabilitySpecDir: args.capabilitySpec,
      authoringGuide,
      askUser,
      abortController,
    });

    emit({ kind: 'done', extensionId: out.extensionId, path: out.path, smokeSummary: out.smoke.summary });
    process.exit(0);
  } catch (e) {
    if (isBuilderError(e)) {
      emit({ kind: 'fail', step: e.step, error: e.message, log: e.log });
    } else {
      emit({ kind: 'fail', step: 'run', error: errMessage(e), log: '' });
    }
    process.exit(1);
  }
}

function readCapabilities(specDir: string): Capabilities {
  const raw = readFileSync(join(specDir, 'capabilities.json'), 'utf8');
  const obj = JSON.parse(raw) as { permissions?: string[]; cannot?: string[] };
  return {
    permissions: Array.isArray(obj.permissions) ? obj.permissions : [],
    cannot: Array.isArray(obj.cannot) ? obj.cannot : [],
  };
}

function readAuthoringGuide(specDir: string): string {
  return readFileSync(join(specDir, 'asyar-authoring.md'), 'utf8');
}

// Entry point: run only when invoked directly (not when imported by tests).
if (import.meta.main) {
  run(process.argv.slice(2)).catch((e) => {
    emit({ kind: 'fail', step: 'run', error: errMessage(e), log: '' });
    process.exit(1);
  });
}
