#!/usr/bin/env bash
# ldd shim used during AppImage bundling on Linux CI.
#
# Tauri's AppImage bundler invokes linuxdeploy, which walks every ELF in
# AppDir/usr/bin/ and runs `ldd <file>` to discover shared-library deps.
# linuxdeploy throws std::runtime_error and aborts the bundle when ldd
# exits non-zero.
#
# Our `bun` sidecar (declared as Tauri externalBin) triggers this: bun is
# dynamically linked (per `file`), but its Zig runtime mis-behaves when ldd
# sets LD_TRACE_LOADED_OBJECTS=1, so the dynamic loader exits 1 instead of
# printing the dep list. The `uv` sidecar, also dynamically linked, works
# fine — bun is the lone offender today.
#
# Both sidecars only need standard glibc libs (libc, libdl, libpthread,
# libm, libgcc_s, librt). linuxdeploy already blacklists those (the CI log
# shows "Skipping deployment of blacklisted library …" for every uv dep),
# so even when ldd succeeds for bun-equivalent binaries linuxdeploy bundles
# nothing for them. Emitting an empty dep list is therefore functionally
# equivalent to the success path for these binaries.
#
# Behavior:
#   real ldd succeeds → forward stdout, exit 0.
#   real ldd fails    → log on stderr, emit nothing on stdout, exit 0.
#
# The shim calls /usr/bin/ldd by absolute path so it never recurses into
# itself.

set -u

REAL_LDD=/usr/bin/ldd

stderr_log=$(mktemp)
trap 'rm -f "$stderr_log"' EXIT

stdout=$("$REAL_LDD" "$@" 2>"$stderr_log")
code=$?

if [[ $code -eq 0 ]]; then
  printf '%s\n' "$stdout"
  cat "$stderr_log" >&2
  exit 0
fi

{
  printf '[ldd-shim] %s exited %d for args: %s\n' "$REAL_LDD" "$code" "$*"
  printf '[ldd-shim] original ldd stderr:\n'
  cat "$stderr_log"
  printf '[ldd-shim] emitting empty dep list so linuxdeploy continues bundling\n'
} >&2
exit 0
