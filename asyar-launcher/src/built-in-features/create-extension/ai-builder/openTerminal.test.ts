import { describe, it, expect } from 'vitest';
import { buildTerminalCommand } from './openTerminal';

const DIR = '/Users/me/AsyarExtensions/com.user.notion';
const CMD = 'pnpm exec asyar publish';

describe('buildTerminalCommand', () => {
  it('macOS: launches Terminal via allowlisted /bin/sh + osascript', () => {
    const r = buildTerminalCommand('macos', DIR, CMD);
    expect('fallback' in r).toBe(false);
    if ('fallback' in r) return;
    expect(r.program).toBe('/bin/sh');
    expect(r.args[0]).toBe('-c');
    const script = r.args[1];
    expect(script).toContain('osascript');
    expect(script).toContain('Terminal');
    expect(script).toContain('do script');
    expect(script).toContain(DIR);
    expect(script).toContain(CMD);
    expect(script).toContain('activate');
  });

  it('linux: launches a terminal emulator via /bin/sh', () => {
    const r = buildTerminalCommand('linux', DIR, CMD);
    if ('fallback' in r) throw new Error('expected command');
    expect(r.program).toBe('/bin/sh');
    expect(r.args[0]).toBe('-c');
    expect(r.args[1]).toContain('gnome-terminal');
    expect(r.args[1]).toContain('x-terminal-emulator');
    expect(r.args[1]).toContain(DIR);
    expect(r.args[1]).toContain(CMD);
  });

  it('windows: launches a new cmd window', () => {
    const r = buildTerminalCommand('windows', DIR, CMD);
    if ('fallback' in r) throw new Error('expected command');
    expect(r.program).toBe('cmd.exe');
    expect(r.args).toContain('/k');
    expect(r.args.join(' ')).toContain(CMD);
  });

  it('windows: quotes a dir containing spaces', () => {
    const r = buildTerminalCommand('windows', 'C:\\Users\\me\\My Extensions\\com.x.tool', CMD);
    if ('fallback' in r) throw new Error('expected command');
    expect(r.args.join(' ')).toContain('"C:\\Users\\me\\My Extensions\\com.x.tool"');
  });

  it('windows: rejects a dir with cmd metacharacters (fail closed)', () => {
    expect(buildTerminalCommand('windows', 'C:\\x & calc', CMD)).toEqual({ fallback: true });
  });

  it('unknown platform returns a fallback signal', () => {
    expect(buildTerminalCommand('solaris', DIR, CMD)).toEqual({ fallback: true });
  });

  it('escapes a dir containing quotes (no shell/AppleScript breakout)', () => {
    const r = buildTerminalCommand('macos', `/x'"; rm -rf ~ #`, CMD);
    if ('fallback' in r) throw new Error('expected command');
    const s = r.args[1];
    expect(s).toContain('\\"');     // AppleScript-escaped double quote present
    expect(s).toContain(`'\\''`);   // POSIX single-quote escape present
  });
});
