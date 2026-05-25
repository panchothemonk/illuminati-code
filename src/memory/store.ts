import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, relative, resolve } from 'path'

export interface CodeSnippet {
  id: string
  filePath: string
  content: string
  startLine: number
  endLine: number
  language: string
  vector: number[]
  timestamp: number
}

export interface VectorStore {
  snippets: CodeSnippet[]
  index: Map<string, number>
}

const VECTOR_DIM = 128

function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h
}

export function generateHashVector(text: string): number[] {
  const vec = new Array(VECTOR_DIM).fill(0)
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const chunkSize = Math.max(1, Math.floor(normalized.length / VECTOR_DIM))

  for (let i = 0; i < VECTOR_DIM; i++) {
    const start = i * chunkSize
    const end = start + chunkSize
    const chunk = normalized.slice(start, end)
    vec[i] = hashString(chunk) / 2147483647
  }

  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vec
  return vec.map(v => v / norm)
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
    '.scala': 'scala', '.sh': 'bash', '.json': 'json', '.yaml': 'yaml',
    '.yml': 'yaml', '.toml': 'toml', '.md': 'markdown', '.html': 'html',
    '.css': 'css', '.sql': 'sql', '.dockerfile': 'dockerfile'
  }
  return map[ext] || 'unknown'
}

function shouldIndexFile(filePath: string): boolean {
  const skipPatterns = [
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
    'coverage', '.cache', '.turbo', 'vendor', 'target/debug', 'target/release'
  ]
  if (skipPatterns.some(p => filePath.includes(p))) return false
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const allowed = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
    '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.scala',
    '.sh', '.json', '.yaml', '.yml', '.toml', '.md', '.html', '.css', '.sql']
  return allowed.includes(ext)
}

function chunkContent(content: string, filePath: string, chunkSize = 40, overlap = 10): Omit<CodeSnippet, 'id' | 'vector' | 'timestamp'>[] {
  const lines = content.split('\n')
  const chunks: Omit<CodeSnippet, 'id' | 'vector' | 'timestamp'>[] = []
  let i = 0
  while (i < lines.length) {
    const end = Math.min(i + chunkSize, lines.length)
    const chunkLines = lines.slice(i, end)
    const chunkText = chunkLines.join('\n')
    if (chunkText.trim().length > 0) {
      chunks.push({
        filePath,
        content: chunkText,
        startLine: i + 1,
        endLine: end,
        language: getLanguageFromPath(filePath)
      })
    }
    i += chunkSize - overlap
    if (i >= lines.length) break
  }
  return chunks
}

export function createVectorStore(): VectorStore {
  return { snippets: [], index: new Map() }
}

export function indexFile(store: VectorStore, filePath: string, basePath?: string): number {
  const resolved = resolve(filePath)
  if (!existsSync(resolved)) return 0
  const stat = statSync(resolved)
  if (!stat.isFile()) return 0
  if (!shouldIndexFile(resolved)) return 0

  const relPath = basePath ? relative(resolve(basePath), resolved) : resolved
  const content = readFileSync(resolved, 'utf-8')
  const chunks = chunkContent(content, relPath)

  let added = 0
  for (const chunk of chunks) {
    const id = `${relPath}:${chunk.startLine}-${chunk.endLine}`
    const existingIdx = store.index.get(id)
    if (existingIdx !== undefined) {
      store.snippets[existingIdx] = {
        ...chunk,
        id,
        vector: generateHashVector(chunk.content),
        timestamp: Date.now()
      }
    } else {
      store.snippets.push({
        ...chunk,
        id,
        vector: generateHashVector(chunk.content),
        timestamp: Date.now()
      })
      store.index.set(id, store.snippets.length - 1)
    }
    added++
  }
  return added
}

export function indexDirectory(store: VectorStore, dirPath: string): number {
  const resolved = resolve(dirPath)
  if (!existsSync(resolved)) return 0

  let total = 0
  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (shouldIndexFile(fullPath)) {
          walk(fullPath)
        }
      } else if (entry.isFile() && shouldIndexFile(fullPath)) {
        total += indexFile(store, fullPath, resolved)
      }
    }
  }
  walk(resolved)
  return total
}

export function removeFileFromIndex(store: VectorStore, filePath: string): number {
  const relPath = filePath
  const toRemove: string[] = []
  for (const [id, idx] of store.index) {
    if (id.startsWith(relPath + ':')) {
      toRemove.push(id)
    }
  }
  for (const id of toRemove) {
    const idx = store.index.get(id)
    if (idx !== undefined) {
      store.snippets.splice(idx, 1)
      store.index.delete(id)
    }
  }
  for (let i = 0; i < store.snippets.length; i++) {
    store.index.set(store.snippets[i].id, i)
  }
  return toRemove.length
}

export function clearStore(store: VectorStore): void {
  store.snippets = []
  store.index.clear()
}

export function getStoreStats(store: VectorStore): { totalSnippets: number; files: number } {
  const files = new Set(store.snippets.map(s => s.filePath))
  return { totalSnippets: store.snippets.length, files: files.size }
}
