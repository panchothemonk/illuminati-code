import { VectorStore, CodeSnippet, generateHashVector } from './store.js'

export interface SearchResult {
  snippet: CodeSnippet
  score: number
}

export interface SearchOptions {
  topK?: number
  threshold?: number
  language?: string
  filePath?: string
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function searchVectors(store: VectorStore, query: string, options: SearchOptions = {}): SearchResult[] {
  const { topK = 5, threshold = 0.3, language, filePath } = options
  const queryVector = generateHashVector(query)

  const candidates: SearchResult[] = []

  for (const snippet of store.snippets) {
    if (language && snippet.language !== language) continue
    if (filePath && !snippet.filePath.includes(filePath)) continue

    const score = cosineSimilarity(queryVector, snippet.vector)
    if (score >= threshold) {
      candidates.push({ snippet, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, topK)
}

export function searchByContent(store: VectorStore, query: string, options: SearchOptions = {}): SearchResult[] {
  const { topK = 5, threshold = 0.1, language, filePath } = options
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2)

  const candidates: SearchResult[] = []

  for (const snippet of store.snippets) {
    if (language && snippet.language !== language) continue
    if (filePath && !snippet.filePath.includes(filePath)) continue

    const contentLower = snippet.content.toLowerCase()
    let matches = 0
    for (const term of queryTerms) {
      if (contentLower.includes(term)) matches++
    }

    const score = queryTerms.length > 0 ? matches / queryTerms.length : 0
    if (score >= threshold) {
      candidates.push({ snippet, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, topK)
}

export function hybridSearch(store: VectorStore, query: string, options: SearchOptions = {}): SearchResult[] {
  const { topK = 5, threshold = 0.2, language, filePath } = options

  const vectorResults = searchVectors(store, query, { topK: topK * 2, threshold: 0, language, filePath })
  const contentResults = searchByContent(store, query, { topK: topK * 2, threshold: 0, language, filePath })

  const combined = new Map<string, SearchResult>()

  for (const r of vectorResults) {
    combined.set(r.snippet.id, { snippet: r.snippet, score: r.score * 0.6 })
  }

  for (const r of contentResults) {
    const existing = combined.get(r.snippet.id)
    if (existing) {
      existing.score += r.score * 0.4
    } else {
      combined.set(r.snippet.id, { snippet: r.snippet, score: r.score * 0.4 })
    }
  }

  const results = Array.from(combined.values())
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)

  return results.slice(0, topK)
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.'

  const lines: string[] = [`Found ${results.length} result(s):\n`]
  for (const r of results) {
    const s = r.snippet
    lines.push(`[${(r.score * 100).toFixed(1)}%] ${s.filePath}:${s.startLine}-${s.endLine} (${s.language})`)
    lines.push('```' + s.language)
    lines.push(s.content.slice(0, 800))
    if (s.content.length > 800) lines.push('...')
    lines.push('```\n')
  }
  return lines.join('\n')
}
