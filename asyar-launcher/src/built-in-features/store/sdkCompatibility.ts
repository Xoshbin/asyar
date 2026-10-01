import semver from 'semver';

/**
 * Checks whether the host's supported SDK version satisfies the extension's
 * declared `asyarSdk` version requirement or semver range.
 *
 * - Returns `true` if no range is declared (unconstrained).
 * - Returns `true` if the range is malformed/unparseable (treated as Unknown/non-blocking,
 *   matching Rust `discovery::validate_compatibility`).
 * - Returns `true` if `supportedVersion` satisfies `requiredRange`.
 * - Returns `false` if `supportedVersion` does not satisfy `requiredRange`.
 */
export function isSdkCompatible(
  requiredRange: string | null | undefined,
  supportedVersion: string,
): boolean {
  if (!requiredRange || !requiredRange.trim()) {
    return true;
  }

  const trimmedRange = requiredRange.trim();
  const validVersion = semver.valid(supportedVersion);
  if (!validVersion) {
    return true;
  }

  const validRange = semver.validRange(trimmedRange);
  if (!validRange) {
    return true;
  }

  return semver.satisfies(validVersion, validRange);
}
