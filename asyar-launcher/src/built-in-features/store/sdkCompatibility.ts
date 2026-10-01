/**
 * Lightweight, zero-dependency semver comparator and validator.
 *
 * Checks whether the host's supported SDK version satisfies the extension's
 * declared `asyarSdk` version requirement or semver range.
 *
 * Decoupled from third-party CommonJS libraries (e.g. `semver`) to eliminate
 * Vite pre-bundling invalidation and 504 (Outdated Optimize Dep) errors on
 * cold boot in the Tauri webview.
 *
 * - Returns `true` if no range is declared (unconstrained).
 * - Returns `true` if the range is malformed/unparseable (treated as Unknown/non-blocking,
 *   matching Rust `discovery::validate_compatibility`).
 * - Returns `true` if `supportedVersion` satisfies `requiredRange`.
 * - Returns `false` if `supportedVersion` does not satisfy `requiredRange`.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
}

const FULL_SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseFullSemver(version: string): SemVer | null {
  const match = FULL_SEMVER_REGEX.exec(version.trim());
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split('.') : undefined,
  };
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;

  const aPre = a.prerelease!;
  const bPre = b.prerelease!;
  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    if (aPre[i] === undefined) return -1;
    if (bPre[i] === undefined) return 1;
    const pA = aPre[i];
    const pB = bPre[i];
    const isNumA = /^\d+$/.test(pA);
    const isNumB = /^\d+$/.test(pB);
    if (isNumA && isNumB) {
      const nA = parseInt(pA, 10);
      const nB = parseInt(pB, 10);
      if (nA !== nB) return nA > nB ? 1 : -1;
    } else if (isNumA && !isNumB) {
      return -1;
    } else if (!isNumA && isNumB) {
      return 1;
    } else {
      if (pA !== pB) return pA > pB ? 1 : -1;
    }
  }
  return 0;
}

type ComparatorFn = (v: SemVer) => boolean;

const PARTIAL_SEMVER_REGEX =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function parsePartialSemver(
  str: string,
): { semver: SemVer; hasMinor: boolean; hasPatch: boolean } | null {
  const match = PARTIAL_SEMVER_REGEX.exec(str);
  if (!match) return null;
  const hasMinor = match[2] !== undefined;
  const hasPatch = match[3] !== undefined;
  return {
    semver: {
      major: parseInt(match[1], 10),
      minor: hasMinor ? parseInt(match[2], 10) : 0,
      patch: hasPatch ? parseInt(match[3], 10) : 0,
      prerelease: match[4] ? match[4].split('.') : undefined,
    },
    hasMinor,
    hasPatch,
  };
}

function parseComparator(token: string): ComparatorFn[] | null {
  if (token === '*' || token === '' || token.toLowerCase() === 'x') {
    return [() => true];
  }

  // Caret ^
  if (token.startsWith('^')) {
    const parsed = parsePartialSemver(token.slice(1));
    if (!parsed) return null;
    const { semver: min, hasMinor, hasPatch } = parsed;
    let max: SemVer;
    if (min.major > 0) {
      max = { major: min.major + 1, minor: 0, patch: 0 };
    } else if (hasMinor && min.minor > 0) {
      max = { major: 0, minor: min.minor + 1, patch: 0 };
    } else if (hasPatch) {
      max = { major: 0, minor: 0, patch: min.patch + 1 };
    } else {
      max = { major: 1, minor: 0, patch: 0 };
    }
    return [(v) => compareSemver(v, min) >= 0, (v) => compareSemver(v, max) < 0];
  }

  // Tilde ~
  if (token.startsWith('~')) {
    const parsed = parsePartialSemver(token.slice(1));
    if (!parsed) return null;
    const { semver: min, hasMinor } = parsed;
    let max: SemVer;
    if (hasMinor) {
      max = { major: min.major, minor: min.minor + 1, patch: 0 };
    } else {
      max = { major: min.major + 1, minor: 0, patch: 0 };
    }
    return [(v) => compareSemver(v, min) >= 0, (v) => compareSemver(v, max) < 0];
  }

  // Comparison operators
  const opMatch = /^(>=|<=|>|<|=)(.*)$/.exec(token);
  if (opMatch) {
    const op = opMatch[1];
    const parsed = parsePartialSemver(opMatch[2]);
    if (!parsed) return null;
    const target = parsed.semver;
    switch (op) {
      case '>=':
        return [(v) => compareSemver(v, target) >= 0];
      case '<=':
        return [(v) => compareSemver(v, target) <= 0];
      case '>':
        return [(v) => compareSemver(v, target) > 0];
      case '<':
        return [(v) => compareSemver(v, target) < 0];
      case '=':
        return [(v) => compareSemver(v, target) === 0];
    }
  }

  // Plain version (e.g. "4.13.0", "4.13", "4")
  const parsed = parsePartialSemver(token);
  if (!parsed) return null;
  const { semver: target, hasMinor, hasPatch } = parsed;
  if (!hasMinor) {
    return [
      (v) => compareSemver(v, target) >= 0,
      (v) => compareSemver(v, { major: target.major + 1, minor: 0, patch: 0 }) < 0,
    ];
  }
  if (!hasPatch) {
    return [
      (v) => compareSemver(v, target) >= 0,
      (v) => compareSemver(v, { major: target.major, minor: target.minor + 1, patch: 0 }) < 0,
    ];
  }
  return [(v) => compareSemver(v, target) === 0];
}

function parseRange(rangeStr: string): ((v: SemVer) => boolean) | null {
  // Normalize whitespace around operators (e.g. ">= 4.12.0" -> ">=4.12.0")
  let normalized = rangeStr.trim().replace(/([><=~^])\s+/g, '$1');

  // Handle hyphen ranges "1.0.0 - 2.0.0" -> ">=1.0.0 <=2.0.0"
  normalized = normalized.replace(
    /(v?\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\s+-\s+(v?\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/g,
    '>=$1 <=$2',
  );

  const orBranches = normalized.split(/\s*\|\|\s*/);
  const parsedBranches: ComparatorFn[][] = [];

  for (const branch of orBranches) {
    const trimmed = branch.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const branchComparators: ComparatorFn[] = [];
    for (const token of tokens) {
      const comparators = parseComparator(token);
      if (!comparators) {
        return null; // Invalid/unparseable range token
      }
      branchComparators.push(...comparators);
    }
    parsedBranches.push(branchComparators);
  }

  if (parsedBranches.length === 0) {
    return () => true;
  }

  return (v: SemVer) => parsedBranches.some((branch) => branch.every((cmp) => cmp(v)));
}

export function isSdkCompatible(
  requiredRange: string | null | undefined,
  supportedVersion: string,
): boolean {
  if (!requiredRange || !requiredRange.trim()) {
    return true;
  }

  const validVersion = parseFullSemver(supportedVersion);
  if (!validVersion) {
    return true;
  }

  const rangeChecker = parseRange(requiredRange);
  if (!rangeChecker) {
    // Treated as Unknown/non-blocking, matching Rust discovery::validate_compatibility
    return true;
  }

  return rangeChecker(validVersion);
}
