import { z } from 'zod'
import { Tool } from './index.js'

export const WebFetchTool: Tool = {
  name: 'WebFetch',
  description: 'Fetch a webpage and extract the main text content. Returns cleaned text without HTML tags, scripts, or styles.',
  parameters: z.object({
    url: z.string().describe('The URL of the webpage to fetch'),
    timeout: z.number().optional().describe('Timeout in seconds (default: 30)')
  }),
  async execute(args) {
    try {
      const timeout = (args.timeout || 30) * 1000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      let response: Response
      try {
        response = await fetch(args.url, {
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
          return `Error: Request timed out after ${args.timeout || 30}s`
        }
        return `Error: ${fetchErr.message}`
      }

      clearTimeout(timer)

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`
      }

      let html: string
      try {
        html = await response.text()
      } catch (textErr: any) {
        return `Error: Failed to read response body: ${textErr.message}`
      }

      // Extract text content from HTML
      let text = html
        // Remove scripts
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        // Remove styles
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        // Remove noscript
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
        // Remove nav, header, footer, aside elements
        .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
        // Convert common block elements to newlines
        .replace(/<(\/div|p|h[1-6]|li|tr|pre|blockquote)[^>]*>/gi, '\n')
        .replace(/<(br)[^>]*>/gi, '\n')
        // Remove all remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Decode common HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x2F;/g, '/')
        .replace(/&#x27;/g, "'")
        .replace(/&#x60;/g, '`')

      // Collapse multiple newlines and spaces
      text = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n')

      // Limit output to reasonable size
      const maxLength = 50000
      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + '\n\n[Content truncated...]'
      }

      if (!text.trim()) {
        return 'No text content could be extracted from the page.'
      }

      return text
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return `Error: Request timed out after ${args.timeout || 30}s`
      }
      return `Error: ${err.message}`
    }
  }
}
