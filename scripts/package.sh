#!/usr/bin/env bash
# Package the Intro Skipper Chrome extension into a .zip ready for upload
# to the Chrome Web Store Developer Dashboard.
#
# Usage:
#   ./scripts/package.sh
#
# Output:
#   dist/intro-skipper-v<version>.zip

set -euo pipefail

cd "$(dirname "$0")/.."

MANIFEST="manifest.json"

if [ ! -f "$MANIFEST" ]; then
  echo "Error: $MANIFEST not found. Run this script from the extension repo." >&2
  exit 1
fi

# Validate manifest.json is well-formed JSON before packaging
if command -v python3 >/dev/null 2>&1; then
  python3 -c "import json,sys; json.load(open('$MANIFEST'))" \
    || { echo "Error: $MANIFEST is not valid JSON." >&2; exit 1; }
fi

VERSION=$(sed -nE 's/.*"version" *: *"([^"]+)".*/\1/p' "$MANIFEST" | head -n1)
if [ -z "$VERSION" ]; then
  echo "Error: could not read \"version\" from $MANIFEST." >&2
  exit 1
fi

OUT_DIR="dist"
ZIP_NAME="intro-skipper-v${VERSION}.zip"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# Only the files the extension actually needs at runtime get packaged.
# Add/remove entries here if the extension's file layout changes.
FILES=(
  manifest.json
  content.js
  popup.html
  popup.css
  popup.js
)

# Optional assets: included automatically if present
OPTIONAL_FILES=(
  icons
  _locales
)

echo "Packaging Intro Skipper v${VERSION}..."

for f in "${FILES[@]}"; do
  if [ ! -e "$f" ]; then
    echo "Error: required file \"$f\" is missing." >&2
    exit 1
  fi
  cp -R "$f" "$STAGE_DIR/"
done

for f in "${OPTIONAL_FILES[@]}"; do
  if [ -e "$f" ]; then
    cp -R "$f" "$STAGE_DIR/"
  fi
done

# Strip OS junk files that may have been copied along with folders
find "$STAGE_DIR" -name ".DS_Store" -delete

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$ZIP_NAME"

(
  cd "$STAGE_DIR"
  zip -r -q -X "$OLDPWD/$OUT_DIR/$ZIP_NAME" .
)

echo "Created ${OUT_DIR}/${ZIP_NAME}"
echo "Upload it at https://chrome.google.com/webstore/devconsole"
