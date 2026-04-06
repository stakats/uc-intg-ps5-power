#!/usr/bin/env bash
# Build and package the PS5 Power integration for UC Remote 3 deployment.
# Produces: uc-intg-ps5-power.tar.gz

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACTS="$PROJECT_DIR/artifacts"

echo "==> Building TypeScript..."
npm --prefix "$PROJECT_DIR" run build

echo "==> Assembling artifacts..."
rm -rf "$ARTIFACTS"
mkdir -p "$ARTIFACTS/bin"

# Root-level driver.json (UC integration metadata)
cp "$PROJECT_DIR/dist/src/driver.json" "$ARTIFACTS/driver.json"

# bin/ contains the compiled driver and its dependencies
cp "$PROJECT_DIR/dist/src/driver.js" "$ARTIFACTS/bin/driver.js"
cp "$PROJECT_DIR/dist/src/driver.json" "$ARTIFACTS/bin/driver.json"

# Install production dependencies into bin/
cp "$PROJECT_DIR/package.json" "$ARTIFACTS/bin/package.json"
npm install --production --prefix "$ARTIFACTS/bin" 2>&1 | tail -3

echo "==> Creating archive..."
tar czvf "$PROJECT_DIR/uc-intg-ps5-power.tar.gz" -C "$ARTIFACTS" .

SIZE=$(du -h "$PROJECT_DIR/uc-intg-ps5-power.tar.gz" | cut -f1)
echo "==> Done: uc-intg-ps5-power.tar.gz ($SIZE)"
