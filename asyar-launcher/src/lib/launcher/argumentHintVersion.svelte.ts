/**
 * Bumped whenever the ghost argument chips could be describing stale data:
 * an extension replaced its dynamic command list, or a submit persisted new
 * argument defaults. Neither changes the command's object id, so an id alone
 * cannot tell a live cache entry from a stale one.
 */
let version = $state(0);

export function argumentHintVersion(): number {
  return version;
}

export function bumpArgumentHintVersion(): void {
  version += 1;
}
