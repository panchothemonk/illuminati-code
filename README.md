# Illuminati Code

Terminal AI coding assistant powered by Kimi API.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/panchothemonk/illuminati-code/main/scripts/install.sh | sh
```

Or download a prebuilt binary from [Releases](https://github.com/panchothemonk/illuminati-code/releases).

## Manual Build

```bash
git clone https://github.com/panchothemonk/illuminati-code.git
cd illuminati-code
bun install
bun build --compile --outfile=illuminati-code src/main.ts
./illuminati-code
```

## Setup

Create `~/.illuminati-code/config.json`:

```json
{
  "apiKey": "your-kimi-api-key",
  "model": "kimi-k2.6"
}
```

## Usage

Type natural language requests. The AI will use tools (Bash, Read, Write, LS, etc.) as needed.

```
> List files in current directory
> Read src/main.ts
> Write a hello world to test.txt
> Search for TODO in the codebase
```

### Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation |
| `/compact` | Compact long conversation |
| `/tokens` | Show token usage |
| `/exit` | Quit |

## Releasing

Push a version tag and GitHub Actions builds + uploads binaries:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds for:
- macOS (Apple Silicon + Intel)
- Linux (x64)

## License

MIT
