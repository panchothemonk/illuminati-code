#!/bin/bash
set -e

REPO_URL="https://github.com/yourname/illuminati-code"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="illuminati-code"

echo "Installing Illuminati Code..."

# Check for bun
if ! command -v bun &> /dev/null; then
  echo "Bun not found. Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Create temp dir
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

# Download source
echo "Downloading source..."
if command -v git &> /dev/null; then
  git clone --depth 1 "$REPO_URL" . 2>/dev/null || {
    echo "Git clone failed. Falling back to curl download..."
    curl -fsSL "${REPO_URL}/archive/refs/heads/main.tar.gz" | tar -xz --strip-components=1
  }
else
  curl -fsSL "${REPO_URL}/archive/refs/heads/main.tar.gz" | tar -xz --strip-components=1
fi

# Build
echo "Building..."
bun install
bun build --compile --outfile="$BIN_NAME" src/main.ts

# Install
mkdir -p "$INSTALL_DIR"
cp "$BIN_NAME" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/$BIN_NAME"

# Cleanup
cd -
rm -rf "$TMP_DIR"

# Check PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo ""
  echo "Add $INSTALL_DIR to your PATH:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  echo ""
  echo "Add that to your ~/.zshrc or ~/.bashrc"
fi

echo ""
echo "Installed to $INSTALL_DIR/$BIN_NAME"
echo "Run: illuminati-code"
