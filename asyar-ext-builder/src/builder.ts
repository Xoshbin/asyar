import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';
import { emit } from './protocol';
import { knowledgePromptSection } from './knowledge';
import { runSmoke, type SmokeResult } from './smokeTest';
import { type BuilderError, isBuilderError, errMessage, isAllowedBashCommand, claudeExecutablePath } from './utils';

export type { BuilderError } from './utils';

/** Maximum number of `pnpm run build` repair iterations the agent may spend. */
export const MAX_BUILD_ATTEMPTS = 4;

export interface BuilderInput {
  prompt: string;
  baseDir: string; // ~/AsyarExtensions
  capabilitySpecDir: string;
  authoringGuide: string; // contents of asyar-authoring.md
  askUser: (prompt: string, inputKind: 'text' | 'confirm' | 'secret') => Promise<string>;
  abortController?: AbortController;
}

export interface BuilderOutput {
  extensionId: string;
  path: string;
  smoke: SmokeResult;
}

/**
 * Validates that an extension id is a safe, single-path-segment slug. Rejects
 * traversal (`..`), absolute/separated paths, and empty dot-segments so that
 * `join(baseDir, id)` can never escape baseDir.
 */
export function isSafeExtensionId(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0) return false;
  // Overall shape: alnum-bounded, dot/dash/underscore inside.
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i.test(id)) return false;
  if (id.includes('/') || id.includes('\\')) return false;
  // Every dot-segment must be non-empty and not a traversal marker.
  for (const part of id.split('.')) {
    if (part === '' || part === '..') return false;
  }
  return true;
}

/**
 * Throws a BuilderError unless `id` is a safe slug AND `join(baseDir, id)` stays
 * inside baseDir after resolution. Returns the id on success.
 */
function assertSafeExtensionId(id: string, baseDir: string): string {
  const fail = () => {
    throw { step: 'build', message: 'invalid or unsafe extension id', log: id } as BuilderError;
  };
  if (!isSafeExtensionId(id)) fail();
  const baseResolved = resolve(baseDir);
  const full = resolve(join(baseDir, id));
  if (full !== baseResolved && !full.startsWith(baseResolved + sep)) fail();
  return id;
}

/**
 * Tries to read `EXTENSION_ID=<id>` from the agent's final result text.
 * Falls back to the single newest directory under baseDir. Whatever id is
 * chosen is validated against path traversal before being returned.
 */
export function resolveExtensionId(resultText: string, baseDir: string, before: Set<string>): string {
  const m = resultText.match(/EXTENSION_ID=([A-Za-z0-9._-]+)/);
  if (m) return assertSafeExtensionId(m[1], baseDir);
  // Fall back: the single directory that appeared under baseDir during the build.
  let dirs: string[] = [];
  try {
    dirs = readdirSync(baseDir).filter((name) => {
      const full = join(baseDir, name);
      try {
        return statSync(full).isDirectory() && !before.has(name);
      } catch {
        return false;
      }
    });
  } catch {
    dirs = [];
  }
  if (dirs.length === 1) return assertSafeExtensionId(dirs[0], baseDir);
  if (dirs.length > 1) {
    // Most recently modified wins.
    dirs.sort((a, b) => statSync(join(baseDir, b)).mtimeMs - statSync(join(baseDir, a)).mtimeMs);
    return assertSafeExtensionId(dirs[0], baseDir);
  }
  throw { step: 'build', message: 'Could not determine the generated extension id.', log: resultText } as BuilderError;
}

/** Ensures baseDir exists before the agent build spawns a subprocess with it as cwd. */
export function ensureBaseDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Snapshot of immediate child directory names under baseDir (best-effort). */
function snapshotDirs(baseDir: string): Set<string> {
  try {
    return new Set(
      readdirSync(baseDir).filter((name) => {
        try {
          return statSync(join(baseDir, name)).isDirectory();
        } catch {
          return false;
        }
      }),
    );
  } catch {
    return new Set();
  }
}

/** Builds the natural-language build instructions handed to the agent. */
export function buildInstructions(input: BuilderInput): string {
  return [
    'You are scaffolding and building a real, working Asyar Tier-2 extension that satisfies this user request:',
    `"""${input.prompt}"""`,
    '',
    'Follow the Asyar authoring guide (provided in your system prompt) and the capability spec in:',
    input.capabilitySpecDir,
    'Read capabilities.json there to know which permissions and preference types are allowed.',
    '',
    knowledgePromptSection(),
    '',
    'Steps:',
    '1. Choose a dot-notation extension id (e.g. "org.author.weather"). Use a lowercase, stable id.',
    `2. Create the extension directory at ${input.baseDir}/<id>/ and work inside it.`,
    '3. Scaffold a valid Asyar extension: manifest.json (honoring the authoring guide + capabilities.json),',
    '   package.json, and a src/ with real TypeScript integration code.',
    '4. If the integration calls a third-party API, fetch its live documentation with your web tools',
    '   and write real request/response code against the current endpoints.',
    '5. Declare any required API key / secret as a `password` preference in the manifest. NEVER hardcode secrets.',
    '6. Run `pnpm install --ignore-scripts` (no dependency lifecycle scripts) then `pnpm run build` inside the',
    `   extension directory. If the build fails, read the errors and fix them. You get at most ${MAX_BUILD_ATTEMPTS} build attempts — do not loop forever.`,
    '7. If you need any decision or input from the user (a choice, a confirmation, or a secret like an API key),',
    '   call the `ask_user` tool. Use inputKind "secret" for API keys / tokens, "confirm" for yes/no, "text" otherwise.',
    '8. When the build succeeds, STOP. As the very last line of your final message, print exactly:',
    '   EXTENSION_ID=<the id you chose>',
    '   and also state, on its own line, whether the integration requires an API key to make a live GET request',
    '   for verification, and if so the exact GET URL and the header name the key goes in.',
  ].join('\n');
}

/**
 * Runs the Agent-SDK-driven build. Scaffolds + builds a real extension under
 * baseDir, bridges agent `ask_user` calls to the host via input.askUser, then
 * (optionally) runs one authenticated smoke call.
 */
export async function runBuilder(input: BuilderInput): Promise<BuilderOutput> {
  ensureBaseDir(input.baseDir);

  const before = snapshotDirs(input.baseDir);

  // In-process custom tool the agent can call to ask the user a question.
  const askUserTool = tool(
    'ask_user',
    'Ask the human operator a question and block until they answer. Use for choices, confirmations, or secrets (API keys).',
    {
      prompt: z.string().describe('The question to show the user.'),
      inputKind: z
        .enum(['text', 'confirm', 'secret'])
        .describe('"secret" for API keys/tokens, "confirm" for yes/no, "text" otherwise.'),
    },
    async (args) => {
      const answer = await input.askUser(args.prompt, args.inputKind);
      return { content: [{ type: 'text' as const, text: answer }] };
    },
  );

  const askServer = createSdkMcpServer({
    name: 'asyar-builder',
    version: '1.0.0',
    tools: [askUserTool],
  });

  // Fully-qualified name an SDK-MCP tool is exposed under: mcp__<server>__<tool>.
  const askToolName = 'mcp__asyar-builder__ask_user';

  const options: Options = {
    cwd: input.baseDir,
    // acceptEdits auto-approves Write/Edit so the build stays autonomous, but
    // does NOT auto-approve Bash — that still routes through canUseTool below.
    permissionMode: 'acceptEdits',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: input.authoringGuide },
    mcpServers: { 'asyar-builder': askServer },
    // NOTE: `Bash` is deliberately NOT in allowedTools. Tools in allowedTools
    // are auto-approved and skip canUseTool, so listing Bash here would defeat
    // the command gate. Leaving it out makes every Bash call hit canUseTool.
    allowedTools: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      askToolName,
    ],
    // Command gate: prompt-injection (e.g. from fetched API docs) must not be
    // able to run arbitrary host commands. Bash is allowlist-gated; every other
    // tool is permitted (Write/Edit are also covered by acceptEdits).
    canUseTool: async (toolName, toolInput) => {
      if (toolName === 'Bash') {
        const command = typeof toolInput.command === 'string' ? toolInput.command : '';
        if (isAllowedBashCommand(command)) {
          return { behavior: 'allow', updatedInput: toolInput };
        }
        return {
          behavior: 'deny',
          message: 'Blocked by Asyar: only build commands (pnpm/npm/node) are permitted.',
        };
      }
      return { behavior: 'allow', updatedInput: toolInput };
    },
    additionalDirectories: [input.capabilitySpecDir],
    ...(input.abortController ? { abortController: input.abortController } : {}),
    ...(claudeExecutablePath() !== undefined ? { pathToClaudeCodeExecutable: claudeExecutablePath() } : {}),
  };

  let log = '';
  let finalText = '';

  try {
    const q = query({ prompt: buildInstructions(input), options });
    for await (const message of q) {
      if (message.type === 'assistant') {
        const blocks = message.message.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'text' && typeof block.text === 'string') {
              finalText = block.text; // last assistant text wins
              log = appendLog(log, block.text);
            } else if (block.type === 'tool_use') {
              const label = describeToolUse(block.name, block.input);
              if (label) emit({ kind: 'step', label });
            }
          }
        }
      } else if (message.type === 'user') {
        // Tool results (e.g. Bash stdout/stderr) arrive as user messages whose
        // content carries tool_result blocks. Capture their text into the log.
        log = appendLog(log, extractToolResultText(message.message?.content));
      } else if (message.type === 'system' && message.subtype === 'local_command_output') {
        // Raw local command output, when the SDK surfaces it directly.
        if (typeof message.content === 'string') log = appendLog(log, message.content);
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          if (typeof message.result === 'string' && message.result.length > 0) {
            finalText = message.result;
            log = appendLog(log, message.result);
          }
        } else {
          // error result subtypes (max turns, error during execution, etc.)
          throw {
            step: 'build',
            message: `Agent ended without success (${message.subtype}).`,
            log,
          } as BuilderError;
        }
      }
    }
  } catch (e) {
    if (isBuilderError(e)) throw e;
    throw { step: 'build', message: errMessage(e), log } as BuilderError;
  }

  const extensionId = resolveExtensionId(finalText, input.baseDir, before);
  const path = join(input.baseDir, extensionId);

  // Decide whether a live authenticated smoke call is determinable.
  const smokeReq = parseSmokeHint(finalText);
  let smoke: SmokeResult;
  if (smokeReq) {
    const key = await input.askUser(
      `Paste a ${smokeReq.service} API key to verify the integration`,
      'secret',
    );
    if (!key) {
      smoke = { ok: true, summary: 'no smoke (no key provided)' };
    } else {
      try {
        smoke = await runSmoke({
          url: smokeReq.url,
          method: 'GET',
          headers: { [smokeReq.headerName]: key },
        });
      } catch (e) {
        throw { step: 'smoke', message: errMessage(e), log } as BuilderError;
      }
      if (!smoke.ok) {
        throw { step: 'smoke', message: smoke.summary, log } as BuilderError;
      }
    }
  } else {
    smoke = { ok: true, summary: 'no smoke (no external auth needed)' };
  }

  return { extensionId, path, smoke };
}

/** Appends a chunk to a rolling transcript, capped to the last `cap` chars. */
export function appendLog(log: string, chunk: string, cap = 4000): string {
  if (!chunk) return log;
  const next = log ? `${log}\n${chunk}` : chunk;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Pulls text out of tool_result blocks carried by a user message's content.
 * A tool_result's `content` may itself be a string or an array of text blocks.
 * Returns '' when there's nothing usable.
 */
export function extractToolResultText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as { type?: unknown; content?: unknown };
    if (b.type !== 'tool_result') continue;
    if (typeof b.content === 'string') {
      out.push(b.content);
    } else if (Array.isArray(b.content)) {
      for (const inner of b.content) {
        if (
          typeof inner === 'object' &&
          inner !== null &&
          (inner as { type?: unknown }).type === 'text' &&
          typeof (inner as { text?: unknown }).text === 'string'
        ) {
          out.push((inner as { text: string }).text);
        }
      }
    }
  }
  return out.join('\n');
}

/** Maps an agent tool_use into a concise, user-facing step label (or null to skip). */
export function describeToolUse(name: string, rawInput: unknown): string | null {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      if (/pnpm\s+install/.test(cmd)) return 'Installing dependencies';
      if (/pnpm\s+(run\s+)?build/.test(cmd)) return 'Building the extension';
      return cmd ? `Running: ${truncate(cmd, 60)}` : 'Running a command';
    }
    case 'Write':
    case 'Edit': {
      const fp = typeof input.file_path === 'string' ? input.file_path : '';
      return fp ? `Writing ${basename(fp)}` : 'Writing files';
    }
    case 'WebFetch':
    case 'WebSearch':
      return 'Fetching live API docs';
    case 'mcp__asyar-builder__ask_user':
      return null; // the ask itself emits its own event
    default:
      return null;
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Parses the agent's final-message smoke hint. We look for a GET URL and a
 * header name plus an optional service label. Returns null when no live
 * authenticated call is determinable.
 */
export function parseSmokeHint(text: string): { url: string; headerName: string; service: string } | null {
  const urlMatch = text.match(/https?:\/\/[^\s"'<>)]+/);
  if (!urlMatch) return null;
  // Only smoke when the agent indicated a key/header is required.
  const headerMatch = text.match(/header(?:\s+name)?[:=\s]+["'`]?([A-Za-z][A-Za-z0-9-]*)/i);
  const needsKey = /requires?\s+an?\s+api\s+key|api\s+key.*required|GET\s+request.*verif/i.test(text);
  if (!needsKey || !headerMatch) return null;
  const headerName = headerMatch[1];
  let service = 'service';
  try {
    service = new URL(urlMatch[0]).hostname.replace(/^www\./, '');
  } catch {
    /* keep default */
  }
  return { url: urlMatch[0], headerName, service };
}
