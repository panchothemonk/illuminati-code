import { existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'

export interface LspServerConfig {
  name: string
  command: string
  args: string[]
  languageIds: string[]
  extensions: string[]
  rootMarkers: string[]
}

const SERVERS: LspServerConfig[] = [
  {
    name: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    rootMarkers: ['package.json', 'tsconfig.json', 'jsconfig.json', '.git']
  },
  {
    name: 'python',
    command: 'pylsp',
    args: [],
    languageIds: ['python'],
    extensions: ['.py', '.pyi', '.pyw'],
    rootMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', '.git']
  },
  {
    name: 'rust',
    command: 'rust-analyzer',
    args: [],
    languageIds: ['rust'],
    extensions: ['.rs'],
    rootMarkers: ['Cargo.toml', 'rust-toolchain', '.git']
  },
  {
    name: 'go',
    command: 'gopls',
    args: [],
    languageIds: ['go'],
    extensions: ['.go'],
    rootMarkers: ['go.mod', 'go.work', '.git']
  },
  {
    name: 'ruby',
    command: 'solargraph',
    args: ['stdio'],
    languageIds: ['ruby'],
    extensions: ['.rb', '.erb', '.rake', 'Gemfile'],
    rootMarkers: ['Gemfile', '.ruby-version', '.git']
  },
  {
    name: 'php',
    command: 'intelephense',
    args: ['--stdio'],
    languageIds: ['php'],
    extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.phps'],
    rootMarkers: ['composer.json', '.git']
  },
  {
    name: 'java',
    command: 'jdtls',
    args: [],
    languageIds: ['java'],
    extensions: ['.java'],
    rootMarkers: ['pom.xml', 'build.gradle', '.git']
  },
  {
    name: 'cpp',
    command: 'clangd',
    args: [],
    languageIds: ['cpp', 'c', 'objc', 'objcpp'],
    extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh', '.hxx', '.m', '.mm'],
    rootMarkers: ['compile_commands.json', '.clangd', 'CMakeLists.txt', 'Makefile', '.git']
  },
  {
    name: 'csharp',
    command: 'omnisharp',
    args: ['-lsp'],
    languageIds: ['csharp'],
    extensions: ['.cs', '.csx'],
    rootMarkers: ['*.csproj', '*.sln', '.git']
  },
  {
    name: 'swift',
    command: 'sourcekit-lsp',
    args: [],
    languageIds: ['swift'],
    extensions: ['.swift'],
    rootMarkers: ['Package.swift', '.git']
  },
  {
    name: 'kotlin',
    command: 'kotlin-language-server',
    args: [],
    languageIds: ['kotlin'],
    extensions: ['.kt', '.kts'],
    rootMarkers: ['build.gradle', 'pom.xml', '.git']
  },
  {
    name: 'dart',
    command: 'dart',
    args: ['language-server'],
    languageIds: ['dart'],
    extensions: ['.dart'],
    rootMarkers: ['pubspec.yaml', '.git']
  },
  {
    name: 'lua',
    command: 'lua-language-server',
    args: [],
    languageIds: ['lua'],
    extensions: ['.lua'],
    rootMarkers: ['.luarc.json', '.git']
  },
  {
    name: 'json',
    command: 'vscode-json-languageserver',
    args: ['--stdio'],
    languageIds: ['json', 'jsonc'],
    extensions: ['.json', '.jsonc'],
    rootMarkers: ['package.json', '.git']
  },
  {
    name: 'markdown',
    command: 'marksman',
    args: [],
    languageIds: ['markdown'],
    extensions: ['.md', '.markdown', '.mdx'],
    rootMarkers: ['.marksman.toml', '.git']
  }
]

export function getAllServerConfigs(): LspServerConfig[] {
  return SERVERS
}

export function getServerConfigByLanguageId(languageId: string): LspServerConfig | undefined {
  return SERVERS.find(s => s.languageIds.includes(languageId))
}

export function getServerConfigByExtension(ext: string): LspServerConfig | undefined {
  return SERVERS.find(s => s.extensions.includes(ext))
}

export function getServerConfigByName(name: string): LspServerConfig | undefined {
  return SERVERS.find(s => s.name === name)
}

export function detectRootPath(filePath: string, config: LspServerConfig): string {
  let dir = dirname(filePath)
  const visited = new Set<string>()
  while (dir !== '/' && !visited.has(dir)) {
    visited.add(dir)
    for (const marker of config.rootMarkers) {
      if (marker.includes('*')) {
        // Handle glob-like markers (e.g., *.csproj)
        const prefix = marker.replace('.*', '').replace('*', '')
        try {
          // readdirSync is statically imported from fs at top of file
          const files = readdirSync(dir)
          if (files.some((f: string) => f.endsWith(prefix) || f.includes(prefix))) {
            return dir
          }
        } catch {}
      } else {
        const markerPath = join(dir, marker)
        if (existsSync(markerPath)) {
          return dir
        }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dir
}

export function detectLanguageFromPath(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === 0) return 'plaintext'
  const ext = filePath.slice(dotIndex)
  const config = getServerConfigByExtension(ext)
  return config?.languageIds[0] || 'plaintext'
}
