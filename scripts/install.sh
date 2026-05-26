#!/bin/sh
set -e

REPO="panchothemonk/illuminati-code"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

# Detect OS/architecture (for display only - we ship a universal binary)
detect_target() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  echo "$OS-$ARCH"
}

TARGET=$(detect_target)
echo "Detected platform: $TARGET"

# Get latest release download URL for the raw binary
echo "Finding latest release..."
DOWNLOAD_URL=$(curl -fsSL "$API_URL" | grep '"browser_download_url"' | grep 'illuminati-code"' | head -1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find release binary" >&2
  exit 1
fi

# Install dir
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

# Download
echo "Downloading from GitHub..."
TMP_DIR=$(mktemp -d)
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_DIR/illuminati-code"

# Install
mv "$TMP_DIR/illuminati-code" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/illuminati-code"
rm -rf "$TMP_DIR"

# Check PATH
if ! command -v illuminati-code >/dev/null 2>&1; then
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo ""
      echo "Add this to your shell config (~/.zshrc, ~/.bashrc, etc.):"
      echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac
fi

echo ""
echo "Installed: $INSTALL_DIR/illuminati-code"
echo "Run: illuminati-code"
