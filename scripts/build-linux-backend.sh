#!/usr/bin/env bash
# Builds the Linux PyInstaller sidecar inside Docker.
# Output: ~/network_tools/backend/dist/network-tools-backend  (Linux ELF, x86_64)
#
# Requires Docker Desktop (or any docker daemon) running.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
IMAGE_TAG="myhackingpal-linux-bundler"

if ! docker info > /dev/null 2>&1; then
    echo "error: docker daemon not running. Open Docker Desktop and retry." >&2
    exit 1
fi

echo "==> building bundler image (linux/amd64)"
# --platform forces amd64 even on Apple Silicon so the resulting ELF matches
# the linux.target arch in electron-builder. Slower (Rosetta emulation) but
# matches what most desktop Linux users actually run.
docker build --platform linux/amd64 -t "$IMAGE_TAG" -f "$BACKEND_DIR/Dockerfile.linux" "$BACKEND_DIR"

# Clear out any Mac-built PyInstaller artifacts so they don't interfere.
# (PyInstaller spec writes to backend/build and backend/dist.)
rm -rf "$BACKEND_DIR/build" "$BACKEND_DIR/dist"

echo "==> running pyinstaller in container"
# Mount the backend dir read-write; Linux container writes to backend/dist.
# --platform linux/amd64 forces x86_64 even on Apple Silicon (we don't have
# a Linux arm64 target yet).
docker run --rm \
    --platform linux/amd64 \
    -v "$BACKEND_DIR:/src" \
    -w /src \
    "$IMAGE_TAG"

echo
if [[ -f "$BACKEND_DIR/dist/network-tools-backend" ]]; then
    echo "==> success"
    file "$BACKEND_DIR/dist/network-tools-backend"
    ls -lh "$BACKEND_DIR/dist/network-tools-backend"
else
    echo "==> FAILED — no binary in $BACKEND_DIR/dist/"
    exit 1
fi
