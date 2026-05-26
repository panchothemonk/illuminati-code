#!/bin/sh
set -e

REPO="panchothemonk/illuminati-code"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

# Detect OS/architecture
detect_target() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    darwin)
      case "$ARCH" in
        arm64|aarch64) echo "darwin-arm64" ;;
        x86_64)        echo "darwin-x64" ;;
        *) echo "Unsupported macOS arch: $ARCH" >&2; exit 1 ;;
      esac
      ;;
    linux)
      case "$ARCH" in
        x86_64|amd64)  echo "linux-x64" ;;
        aarch64|arm64) echo "linux-arm64" ;;
        *) echo "Unsupported Linux arch: $ARCH" >&2; exit 1 ;;
      esac
      ;;
    *)
      echo "Unsupported OS: $OS" >&2
      exit 1
      ;;
  esac
}

TARGET=$(detect_target)
echo "Detected platform: $TARGET"

# Get latest release download URL
echo "Finding latest release..."
DOWNLOAD_URL=$(curl -fsSL "$API_URL" | grep "browser_download_url.*${TARGET}" | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find release for $TARGET" >&2
  exit 1
fi

# Install dir
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

# Download and extract
echo "Downloading from GitHub..."
TMP_DIR=$(mktemp -d)
curl -fsSL "$DOWNLOAD_URL" | tar xzf - -C "$TMP_DIR"

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
