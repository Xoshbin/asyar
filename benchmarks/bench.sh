#!/usr/bin/env bash
# Asyar vs Raycast (stable + beta/v2) black-box performance benchmark (macOS).
#
# Measures every app the same way, one at a time, from the outside:
#   cold start → usable, hotkey → window visible, memory footprint,
#   post-activity and deep-idle costs, size on disk.
#
# Usage:
#   ./benchmarks/bench.sh [--yes] [--update-readme]
#       [--asyar-app PATH] [--raycast-app PATH] [--raycast-beta-app PATH]
#       [--asyar-hotkey SPEC] [--raycast-hotkey SPEC] [--raycast-beta-hotkey SPEC]
#       [--runs N] [--cpu-seconds N] [--settle-seconds N]
#       [--deep-settle N] [--deep-idle-seconds N]
#
# Raycast Beta is included automatically when installed; each hotkey SPEC
# must match what that app is actually bound to (e.g. opt+space, cmd+space).
#
# Requires: Xcode command-line tools (swiftc), Python 3, and Accessibility
# permission for your terminal (System Settings → Privacy & Security → Accessibility).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
TOOL="$BUILD_DIR/benchtool"
RESULTS_DIR="$SCRIPT_DIR/results"

ASYAR_APP="/Applications/asyar.app"
RAYCAST_APP="/Applications/Raycast.app"
RAYCAST_BETA_APP="/Applications/Raycast Beta.app"
ASYAR_HOTKEY="opt+space"        # Asyar default (Alt+Space)
RAYCAST_HOTKEY="opt+space"      # Raycast factory default (⌥Space)
RAYCAST_BETA_HOTKEY="opt+space"
RUNS=15
CPU_SECONDS=30
SETTLE_SECONDS=20
DEEP_SETTLE_SECONDS=120
DEEP_IDLE_SECONDS=60
ASSUME_YES=0
UPDATE_README=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --asyar-app) ASYAR_APP="$2"; shift 2 ;;
    --raycast-app) RAYCAST_APP="$2"; shift 2 ;;
    --raycast-beta-app) RAYCAST_BETA_APP="$2"; shift 2 ;;
    --asyar-hotkey) ASYAR_HOTKEY="$2"; shift 2 ;;
    --raycast-hotkey) RAYCAST_HOTKEY="$2"; shift 2 ;;
    --raycast-beta-hotkey) RAYCAST_BETA_HOTKEY="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --cpu-seconds) CPU_SECONDS="$2"; shift 2 ;;
    --settle-seconds) SETTLE_SECONDS="$2"; shift 2 ;;
    --deep-settle) DEEP_SETTLE_SECONDS="$2"; shift 2 ;;
    --deep-idle-seconds) DEEP_IDLE_SECONDS="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --update-readme) UPDATE_README=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "macOS only"
[[ -d "$ASYAR_APP" ]] || die "Asyar app not found at $ASYAR_APP (pass --asyar-app)"
[[ -d "$RAYCAST_APP" ]] || die "Raycast app not found at $RAYCAST_APP (pass --raycast-app)"
command -v swiftc >/dev/null || die "swiftc not found — install Xcode command-line tools"
command -v python3 >/dev/null || die "python3 not found — install Python 3"

# A dev build of Asyar would attribute its WebKit helpers to the terminal
# and produce garbage numbers; refuse to run alongside one.
if pgrep -f 'target/(debug|release)/asyar$' >/dev/null; then
  die "a dev build of Asyar is running (target/debug or target/release) — quit it first"
fi

app_name() { basename "$1" .app; }

# The benchmarked apps, as parallel arrays (macOS ships bash 3.2 — no namerefs).
APP_PATHS=()
APP_HOTKEYS=()
APP_LABELS=()
APP_LOGS=()

add_app() { # path hotkey
  local path="$1" hotkey="$2" name ver slug display
  name="$(app_name "$path")"
  ver="$(defaults read "$path/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '?')"
  slug="$(echo "$name" | tr '[:upper:] ' '[:lower:]-')"
  display="$(echo "$name" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')"
  APP_PATHS+=("$path")
  APP_HOTKEYS+=("$hotkey")
  APP_LABELS+=("$display $ver")
  APP_LOGS+=("$RESULTS_DIR/raw-$slug.txt")
}

add_app "$ASYAR_APP" "$ASYAR_HOTKEY"
add_app "$RAYCAST_APP" "$RAYCAST_HOTKEY"
if [[ -d "$RAYCAST_BETA_APP" ]]; then
  add_app "$RAYCAST_BETA_APP" "$RAYCAST_BETA_HOTKEY"
else
  echo "note: Raycast Beta not found at $RAYCAST_BETA_APP — benchmarking without it."
fi

quit_app() {
  local app="$1" name
  name="$(app_name "$app")"
  pgrep -f "$app/Contents/MacOS" >/dev/null || return 0
  echo "  quitting $name..."
  osascript -e "quit app \"$name\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$app/Contents/MacOS" >/dev/null || return 0
    sleep 0.5
  done
  pkill -f "$app/Contents/MacOS" || true
  sleep 1
}

quit_all() {
  local p
  for p in "${APP_PATHS[@]}"; do quit_app "$p"; done
}

echo
echo "Apps and the hotkeys that will be pressed:"
for i in "${!APP_PATHS[@]}"; do
  printf '  %-26s %s\n' "${APP_LABELS[$i]}" "${APP_HOTKEYS[$i]}"
done

if [[ "$ASSUME_YES" -ne 1 ]]; then
  cat <<EOF

ATTENTION: open each app's settings and confirm the hotkey shown above is
really registered in that app. An app with NO hotkey registered — or a
different one — will fail its runs. (Hotkeys can silently disappear after
app updates or when another launcher takes the key. Launchers cannot share
one hotkey: give each app its own, then pass the matching
--asyar-hotkey / --raycast-hotkey / --raycast-beta-hotkey.)

This benchmark will QUIT and RELAUNCH: ${APP_LABELS[*]}.
It presses each app's global hotkey (~$((RUNS + 3)) times) using synthetic
keyboard events. Do not touch mouse/keyboard while it runs
(~4-6 minutes per app).

For fair numbers: close other heavy apps, plug in power, use a release build.

EOF
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || exit 0
fi

# Compile the measurement tool (cached until the source changes).
mkdir -p "$BUILD_DIR" "$RESULTS_DIR"
if [[ ! -x "$TOOL" || "$SCRIPT_DIR/benchtool.swift" -nt "$TOOL" ]]; then
  echo "Compiling benchtool..."
  swiftc -O "$SCRIPT_DIR/benchtool.swift" -o "$TOOL"
fi

extract() {
  awk -F= -v k="$2" '$1 == k { value = $2; found = 1 } END { print found ? value : "n/a" }' "$1"
}

parse_powermetrics() { # raw-file pid...
  python3 - "$@" <<'PY'
import re
import sys

path = sys.argv[1]
pids = set(sys.argv[2:])
number = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)"
pid_pattern = "|".join(re.escape(pid) for pid in sorted(pids, key=len, reverse=True))
row = re.compile(r"^(.+?)\s+(" + pid_pattern + r")\s+(" + number + r"(?:\s+" + number + r"){5,})\s*$")
sample_header = re.compile(r"^\*+\s*Sampled system activity")
samples = []
current = None
matched = False

with open(path, encoding="utf-8", errors="replace") as raw:
    for line in raw:
        line = line.strip()
        if sample_header.match(line):
            if current is not None:
                samples.append(current)
            current = [0.0, 0.0]
            continue
        match = row.match(line)
        if not match:
            continue
        values = [float(value) for value in match.group(3).split()]
        if current is None:
            current = [0.0, 0.0]
        current[0] += values[0]
        current[1] += values[4]
        matched = True

if current is not None:
    samples.append(current)
if not matched or not samples:
    raise SystemExit(1)

print(f"pm_cpu_ms_s={sum(sample[0] for sample in samples) / len(samples):.2f}")
print(f"pm_wakeups_s={sum(sample[1] for sample in samples) / len(samples):.2f}")
PY
}

parse_fs_usage() { # raw-file
  python3 - "$1" <<'PY'
import re
import sys

write_call = re.compile(r"^\s*\S+\s+(?:write|pwrite|WrData|WrMeta)(?:\[[^]]*\])?(?:\s|$)")
path_field = re.compile(r"(/.*?)\s+\d+\.\d+(?:\s+W)?\s+.+$")
writes = 0
paths = set()

with open(sys.argv[1], encoding="utf-8", errors="replace") as raw:
    for line in raw:
        if not write_call.search(line):
            continue
        writes += 1
        match = path_field.search(line)
        if match:
            paths.add(match.group(1).strip())

print(f"disk_write_ops={writes}")
print(f"disk_files_touched={len(paths)}")
PY
}

parse_nettop() { # before-file after-file pid...
  python3 - "$@" <<'PY'
import csv
import re
import sys

pids = set(sys.argv[3:])

def snapshot(path):
    totals = [0, 0]
    with open(path, encoding="utf-8", errors="replace", newline="") as raw:
        lines = raw.readlines()

    csv_header = None
    for record in csv.reader(lines):
        names = [field.strip().lower() for field in record]
        if "bytes_in" in names and "bytes_out" in names:
            csv_header = (names.index("bytes_in"), names.index("bytes_out"))
            continue
        if csv_header is None or max(csv_header) >= len(record):
            continue
        if not any(re.search(r"\." + re.escape(pid) + r"$", field.strip()) for pid in pids for field in record):
            continue
        try:
            totals[0] += int(float(record[csv_header[0]].strip()))
            totals[1] += int(float(record[csv_header[1]].strip()))
        except ValueError:
            continue
    if csv_header is not None:
        return totals

    fixed_header = None
    for line in lines:
        if "bytes_in" not in line.lower() or "bytes_out" not in line.lower():
            continue
        columns = [(match.start(), match.group().lower()) for match in re.finditer(r"\S+", line)]
        positions = {name: position for position, name in columns}
        if "bytes_in" not in positions or "bytes_out" not in positions:
            continue
        starts = [position for position, _ in columns]
        in_start = positions["bytes_in"]
        out_start = positions["bytes_out"]
        in_end = next((position for position in starts if position > in_start), None)
        out_end = next((position for position in starts if position > out_start), None)
        fixed_header = (in_start, in_end, out_start, out_end)
        continue
    if fixed_header is None:
        raise ValueError("nettop byte columns not found")

    for line in lines:
        if not any(re.search(r"\." + re.escape(pid) + r"(?:\s|$)", line) for pid in pids):
            continue
        in_start, in_end, out_start, out_end = fixed_header
        fields = (line[in_start:in_end].strip(), line[out_start:out_end].strip())
        try:
            totals[0] += int(float(fields[0] or 0))
            totals[1] += int(float(fields[1] or 0))
        except ValueError:
            continue
    return totals

try:
    before = snapshot(sys.argv[1])
    after = snapshot(sys.argv[2])
except (OSError, ValueError):
    raise SystemExit(1)

print(f"net_bytes_in={max(0, after[0] - before[0])}")
print(f"net_bytes_out={max(0, after[1] - before[1])}")
PY
}

measure_app() { # index into the APP_* arrays
  local i="$1"
  local app="${APP_PATHS[$i]}" hotkey="${APP_HOTKEYS[$i]}" log="${APP_LOGS[$i]}"
  local raw_prefix="${log%.txt}"
  local deep_cpu_raw="${raw_prefix}-deep-cpu.txt"
  local pm_raw="${raw_prefix}-powermetrics.txt"
  local fs_raw="${raw_prefix}-fs-usage.txt"
  local net_before_raw="${raw_prefix}-nettop-before.txt"
  local net_after_raw="${raw_prefix}-nettop-after.txt"
  local group_output deep_cpu_job pm_job fs_job
  local group_pids=()
  : > "$log"

  echo "== ${APP_LABELS[$i]} =="
  quit_all
  sleep 2

  echo "  cold start (launch → usable)..."
  "$TOOL" coldstart "$app" "$hotkey" | tee -a "$log" \
    || die "'$hotkey' does not summon ${APP_LABELS[$i]} — open that app's settings and check:
the hotkey may not be registered at all (updates can clear it), set to a
different key, or owned by another launcher. Register one, then pass the
matching --asyar-hotkey / --raycast-hotkey / --raycast-beta-hotkey flag."

  echo "  settling ${SETTLE_SECONDS}s (startup indexing etc.)..."
  sleep "$SETTLE_SECONDS"

  echo "  hotkey → window visible, $RUNS runs..."
  "$TOOL" hotkey "$app" "$hotkey" "$RUNS" | tee -a "$log" \
    || die "hotkey runs failed for ${APP_LABELS[$i]} — see the message above; pass the
matching --asyar-hotkey / --raycast-hotkey / --raycast-beta-hotkey flag."
  sleep 5

  echo "  memory footprint..."
  "$TOOL" mem "$app" | tee -a "$log"

  echo "  idle CPU over ${CPU_SECONDS}s..."
  "$TOOL" cpu "$app" "$CPU_SECONDS" | tee -a "$log"

  echo "  settling ${DEEP_SETTLE_SECONDS}s for deep idle..."
  sleep "$DEEP_SETTLE_SECONDS"

  group_output="$("$TOOL" group "$app")"
  while IFS= read -r pid; do
    group_pids+=("$pid")
  done < <(printf '%s\n' "$group_output" | awk -F'[ =]' '$1 == "pid" { print $2 }')
  [[ "${#group_pids[@]}" -gt 0 ]] || die "could not resolve the process group for ${APP_LABELS[$i]}"

  echo "  deep idle over ${DEEP_IDLE_SECONDS}s..."
  if ! nettop -P -x -l 1 > "$net_before_raw" 2>/dev/null; then
    : > "$net_before_raw"
  fi

  "$TOOL" cpu "$app" "$DEEP_IDLE_SECONDS" > "$deep_cpu_raw" &
  deep_cpu_job=$!
  pm_job=""
  fs_job=""
  if command -v sudo >/dev/null && sudo -n /usr/bin/powermetrics --samplers cpu_power -i 100 -n 1 >/dev/null 2>&1; then
    sudo -n powermetrics --samplers tasks --show-process-energy -i 1000 -n "$DEEP_IDLE_SECONDS" > "$pm_raw" 2>&1 &
    pm_job=$!
    sudo -n fs_usage -w -f filesys -t "$DEEP_IDLE_SECONDS" "${group_pids[@]}" > "$fs_raw" 2>&1 &
    fs_job=$!
  else
    : > "$pm_raw"
    : > "$fs_raw"
  fi

  if wait "$deep_cpu_job"; then
    sed 's/^cpu_pct=/cpu_pct_deep=/' "$deep_cpu_raw" | tee -a "$log"
  else
    die "deep-idle CPU measurement failed for ${APP_LABELS[$i]}"
  fi

  if ! nettop -P -x -l 1 > "$net_after_raw" 2>/dev/null; then
    : > "$net_after_raw"
  fi
  if parse_nettop "$net_before_raw" "$net_after_raw" "${group_pids[@]}" >> "$log"; then
    :
  else
    printf 'net_bytes_in=n/a\nnet_bytes_out=n/a\n' >> "$log"
  fi

  if [[ -n "$pm_job" ]]; then
    if wait "$pm_job" && parse_powermetrics "$pm_raw" "${group_pids[@]}" >> "$log"; then
      :
    else
      printf 'pm_cpu_ms_s=n/a\npm_wakeups_s=n/a\n' >> "$log"
    fi
  else
    printf 'pm_cpu_ms_s=n/a\npm_wakeups_s=n/a\n' >> "$log"
  fi

  if [[ -n "$fs_job" ]]; then
    if wait "$fs_job" && parse_fs_usage "$fs_raw" >> "$log"; then
      :
    else
      printf 'disk_write_ops=n/a\ndisk_files_touched=n/a\n' >> "$log"
    fi
  else
    printf 'disk_write_ops=n/a\ndisk_files_touched=n/a\n' >> "$log"
  fi

  echo "  keystroke → results painted (panel growth), 10 runs..."
  if ! "$TOOL" typelatency "$app" "$hotkey" a 10 | tee -a "$log"; then
    echo "  (launcher does not resize on results — reporting n/a)"
    printf 'type_p50_ms=n/a\ntype_p95_ms=n/a\ntype_p99_ms=n/a\n' >> "$log"
  fi

  echo "  memory footprint at deep idle..."
  "$TOOL" mem "$app" | sed 's/^total_mb=/total_mb_deep=/' | tee -a "$log"

  du -sm "$app" | awk '{ print "size_mb=" $1 }' | tee -a "$log"
  quit_app "$app"
}

for i in "${!APP_PATHS[@]}"; do
  measure_app "$i"
done

CHIP="$(sysctl -n machdep.cpu.brand_string)"
RAM_GB="$(( $(sysctl -n hw.memsize) / 1073741824 ))"
MACOS_VER="$(sw_vers -productVersion)"
DATE_UTC="$(date -u +%Y-%m-%d)"

row() { # metric key unit
  local out="| $1 |" log value
  for log in "${APP_LOGS[@]}"; do
    value="$(extract "$log" "$2")"
    if [[ "$value" == "n/a" ]]; then
      out+=" n/a |"
    elif [[ -n "$3" ]]; then
      out+=" $value $3 |"
    else
      out+=" $value |"
    fi
  done
  echo "$out"
}

TABLE_FILE="$RESULTS_DIR/table.md"
{
  header="| Metric |"
  sep="| ------ |"
  for label in "${APP_LABELS[@]}"; do
    header+=" $label |"
    sep+=" ---: |"
  done
  echo "$header"
  echo "$sep"
  row "Hotkey → window visible (median of $RUNS)" median_ms "ms"
  row "Hotkey → window visible (p95)" p95_ms "ms"
  row "Hotkey → window visible (p99)" p99_ms "ms"
  row "Keystroke → results painted (p50)" type_p50_ms "ms"
  row "Keystroke → results painted (p95)" type_p95_ms "ms"
  row "Cold start → usable" coldstart_ms "ms"
  row "Memory footprint, idle (all processes)" total_mb "MB"
  row "CPU while idle (${CPU_SECONDS}s average)" cpu_pct "%"
  row "CPU deep idle (${DEEP_IDLE_SECONDS}s, after ${DEEP_SETTLE_SECONDS}s quiet)" cpu_pct_deep "%"
  row "Memory deep idle" total_mb_deep "MB"
  row "CPU ms/s (powermetrics, deep idle)" pm_cpu_ms_s ""
  row "Idle wakeups/s (deep idle)" pm_wakeups_s ""
  row "Idle disk write ops (${DEEP_IDLE_SECONDS}s)" disk_write_ops ""
  row "Idle network bytes in (${DEEP_IDLE_SECONDS}s)" net_bytes_in ""
  row "Idle network bytes out (${DEEP_IDLE_SECONDS}s)" net_bytes_out ""
  row "App size on disk" size_mb "MB"
  echo
  echo "<sub>Measured $DATE_UTC on a $CHIP (${RAM_GB} GB RAM), macOS $MACOS_VER, each app"
  echo "as installed, summoned by its own registered global hotkey, one at a time on a"
  echo "quiet machine. Black-box measurement: synthetic hotkey press → launcher window"
  echo "on screen. Reproduce with [\`benchmarks/bench.sh\`](benchmarks/README.md).</sub>"
} > "$TABLE_FILE"

{
  echo "# Benchmark run $DATE_UTC"
  echo
  echo "- Machine: $CHIP, ${RAM_GB} GB RAM, macOS $MACOS_VER"
  for i in "${!APP_PATHS[@]}"; do
    echo "- ${APP_LABELS[$i]} (\`${APP_PATHS[$i]}\`), hotkey \`${APP_HOTKEYS[$i]}\`"
  done
  echo "- $RUNS hotkey runs, ${CPU_SECONDS}s post-activity CPU window, ${SETTLE_SECONDS}s initial settle"
  echo "- ${DEEP_IDLE_SECONDS}s deep-idle window after ${DEEP_SETTLE_SECONDS}s quiet"
  echo
  cat "$TABLE_FILE"
  for i in "${!APP_PATHS[@]}"; do
    echo
    echo "## Raw output — ${APP_LABELS[$i]}"
    echo '```'
    cat "${APP_LOGS[$i]}"
    echo '```'
  done
} > "$RESULTS_DIR/latest.md"

echo
echo "Results written to $RESULTS_DIR/latest.md"
echo
cat "$TABLE_FILE"

if [[ "$UPDATE_README" -eq 1 ]]; then
  README="$REPO_ROOT/README.md"
  grep -q '<!-- benchmarks:start -->' "$README" || die "README markers not found"
  awk -v table="$TABLE_FILE" '
    /<!-- benchmarks:start -->/ {
      print; print ""
      while ((getline line < table) > 0) print line
      print ""; skip = 1; next
    }
    /<!-- benchmarks:end -->/ { skip = 0 }
    !skip
  ' "$README" > "$README.tmp" && mv "$README.tmp" "$README"
  if command -v pnpm >/dev/null && [[ -f "$REPO_ROOT/package.json" ]]; then
    (cd "$REPO_ROOT" && pnpm exec prettier --write README.md >/dev/null) || true
  fi
  echo "README.md updated between benchmark markers."
fi
