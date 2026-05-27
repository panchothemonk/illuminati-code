import { z } from 'zod'
import { Tool } from './index.js'

export const WebSearchTool: Tool = {
  name: 'WebSearch',
  description: 'Search the web using DuckDuckGo. Returns search results with title, URL, and snippet.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    num_results: z.number().optional().describe('Number of results to return (default: 5, max: 10)')
  }),
  async execute(args) {
    try {
      const numResults = Math.min(args.num_results || 5, 10)
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)

      let response: Response
      try {
        response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: controller.signal
        })
      } catch (fetchErr: any) {
        clearTimeout(timer)
        if (fetchErr.name === 'AbortError') {
          return 'Error: Search timed out after 15s'
        }
        return `Error: ${fetchErr.message}`
      }

      clearTimeout(timer)

      if (!response.ok) {
        return `Error: DuckDuckGo returned HTTP ${response.status}`
      }

      let html: string
      try {
        html = await response.text()
      } catch (textErr: any) {
        return `Error: Failed to read response body: ${textErr.message}`
      }
      const results: string[] = []

      // Parse DuckDuckGo HTML results
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g

      const titles: { url: string; title: string }[] = []
      let match
      while ((match = resultRegex.exec(html)) !== null) {
        let resultUrl = match[1]
        // DuckDuckGo sometimes uses redirect URLs
        if (resultUrl.startsWith('//')) {
          resultUrl = 'https:' + resultUrl
        } else if (resultUrl.startsWith('/l/?')) {
          const uddgMatch = resultUrl.match(/uddg=([^&]+)/)
          if (uddgMatch) {
            resultUrl = decodeURIComponent(uddgMatch[1])
          }
        }
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        if (title && resultUrl) {
          titles.push({ url: resultUrl, title })
        }
      }

      const snippets: string[] = []
      while ((match = snippetRegex.exec(html)) !== null) {
        const snippet = match[1].replace(/<[^>]+>/g, '').trim()
        if (snippet) {
          snippets.push(snippet)
        }
      }

      for (let i = 0; i < Math.min(titles.length, numResults); i++) {
        const title = titles[i]
        const snippet = snippets[i] || ''
        results.push(`${i + 1}. ${title.title}\n   URL: ${title.url}\n   ${snippet}`)
      }

      if (results.length === 0) {
        return 'No results found.'
      }

      return results.join('\n\n')
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return 'Error: Search timed out after 15s'
      }
      return `Error: ${err.message}`
    }
  }
}
