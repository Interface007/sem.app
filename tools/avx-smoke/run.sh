#!/usr/bin/env bash
# AVX smoke test: runs the server image under QEMU user mode with a CPU model
# without AVX/AVX2 (Denverton = Goldmont, same family as the Celeron J4125 of
# the NAS) and checks that node starts and the server answers /health.
# A negative control first proves that an AVX instruction is really trapped.
#
#   tools/avx-smoke/run.sh <image>
#
# Needs docker and curl. AVX_SMOKE_CPU overrides the CPU model.
set -euo pipefail

image="${1:?usage: run.sh <image>}"
cpu="${AVX_SMOKE_CPU:-Denverton}"
port="${AVX_SMOKE_PORT:-18099}"
here="$(cd "$(dirname "$0")" && pwd)"
tag="sem-avx-smoke:local"
name="sem-avx-smoke-$$"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  echo "AVX smoke: FAILED - $*" >&2
  exit 1
}

# --init: QEMU ends itself with the guest's fatal signal, which PID 1 ignores.
emulate() {
  local model="$1"
  shift
  docker run --rm --init "$tag" -cpu "$model" "$@"
}

echo "== Building test image from $image"
docker build --quiet --build-arg IMAGE="$image" --tag "$tag" "$here" >/dev/null

echo "== Negative control: one AVX instruction"
emulate max /opt/avx-smoke/avx-probe || fail "probe does not run even with -cpu max"
status=0
emulate "$cpu" /opt/avx-smoke/avx-probe 2>/dev/null || status=$?
[[ "$status" -eq 132 ]] ||
  fail "expected SIGILL (exit 132) under -cpu $cpu, got exit $status; the check is blind"
echo "   ok: trapped with SIGILL under -cpu $cpu"

echo "== Startup check: node under -cpu $cpu"
emulate "$cpu" /usr/local/bin/node -e \
  'console.log(process.version, require("node:crypto").randomUUID())' ||
  fail "node does not start without AVX"

echo "== Server: /health under -cpu $cpu"
docker run -d --init --name "$name" -p "127.0.0.1:$port:8080" "$tag" \
  -cpu "$cpu" /usr/local/bin/node dist/main.js >/dev/null

body=""
for _ in $(seq 1 120); do
  [[ "$(docker inspect -f '{{.State.Running}}' "$name")" == "true" ]] || {
    docker logs "$name" >&2 || true
    fail "server exited during startup"
  }
  if body="$(curl -sf "http://127.0.0.1:$port/health")"; then break; fi
  sleep 1
done
[[ "$body" == *'"status":"ok"'* ]] || {
  docker logs "$name" >&2 || true
  fail "no ok from /health (got: '$body')"
}
echo "   ok: $body"

echo "AVX smoke: PASSED"
