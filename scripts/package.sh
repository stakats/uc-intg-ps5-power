#!/usr/bin/env bash
# Build and package the PS5 Power integration for UC Remote 3 deployment.
# Produces: uc-intg-ps5-power.tar.gz

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACTS="$PROJECT_DIR/artifacts"

echo "==> Building TypeScript..."
npm --prefix "$PROJECT_DIR" run build

echo "==> Bundling with esbuild..."
rm -rf "$ARTIFACTS" 2>/dev/null || true
mkdir -p "$ARTIFACTS/bin"

npx esbuild "$PROJECT_DIR/dist/src/driver.js" \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile="$ARTIFACTS/bin/driver.js" \
  --external:bufferutil \
  --external:utf-8-validate \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

# driver.json is loaded at runtime via fs, not imported
cp "$PROJECT_DIR/dist/src/driver.json" "$ARTIFACTS/bin/driver.json"

# Root-level driver.json (UC integration metadata)
cp "$PROJECT_DIR/dist/src/driver.json" "$ARTIFACTS/driver.json"

echo "==> Creating archive..."
tar czvf "$PROJECT_DIR/uc-intg-ps5-power.tar.gz" --exclude='.DS_Store' -C "$ARTIFACTS" .

SIZE=$(du -h "$PROJECT_DIR/uc-intg-ps5-power.tar.gz" | cut -f1)
echo "==> Done: uc-intg-ps5-power.tar.gz ($SIZE)"
