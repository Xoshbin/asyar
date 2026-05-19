// Single source of truth for sidecar (bun + uv) per-platform archive names
// and Rust target triples. CI build matrices in .github/workflows/ MUST stay
// covered by this table — `sidecar-platforms.test.mjs` enforces the link.

export const SIDECAR_PLATFORMS = {
  'darwin-arm64': {
    rustTriple: 'aarch64-apple-darwin',
    bunArchive: 'bun-darwin-aarch64.zip',
    uvArchive:  'uv-aarch64-apple-darwin.tar.gz',
  },
  'darwin-x64': {
    rustTriple: 'x86_64-apple-darwin',
    bunArchive: 'bun-darwin-x64.zip',
    uvArchive:  'uv-x86_64-apple-darwin.tar.gz',
  },
  'linux-x64': {
    rustTriple: 'x86_64-unknown-linux-gnu',
    bunArchive: 'bun-linux-x64.zip',
    uvArchive:  'uv-x86_64-unknown-linux-gnu.tar.gz',
  },
  'linux-arm64': {
    rustTriple: 'aarch64-unknown-linux-gnu',
    bunArchive: 'bun-linux-aarch64.zip',
    uvArchive:  'uv-aarch64-unknown-linux-gnu.tar.gz',
  },
  'win32-x64': {
    rustTriple: 'x86_64-pc-windows-msvc',
    bunArchive: 'bun-windows-x64.zip',
    uvArchive:  'uv-x86_64-pc-windows-msvc.zip',
  },
  'win32-arm64': {
    rustTriple: 'aarch64-pc-windows-msvc',
    bunArchive: 'bun-windows-arm64.zip',
    uvArchive:  'uv-aarch64-pc-windows-msvc.zip',
  },
}

export function resolvePlatform(nodePlatform, nodeArch) {
  const key = `${nodePlatform}-${nodeArch}`
  const entry = SIDECAR_PLATFORMS[key]
  if (!entry) {
    const supported = Object.keys(SIDECAR_PLATFORMS).join(', ')
    throw new Error(`Unsupported platform: ${key}. Supported: ${supported}`)
  }
  return { platformKey: key, ...entry }
}
