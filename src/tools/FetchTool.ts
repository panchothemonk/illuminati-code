import { z } from 'zod'
import { Tool } from './index.js'

export const FetchTool: Tool = {
  name: 'Fetch',
  description: 'Make an HTTP request to a URL. Returns the response body as text.',
  parameters: z.object({
    url: z.string().describe('The URL to fetch'),
    method: z.string().optional().describe('HTTP method (default: GET)'),
    headers: z.record(z.string()).optional().describe('HTTP headers as key-value pairs'),
    body: z.string().optional().describe('Request body (for POST, PUT, etc.)'),
    timeout: z.number().optional().describe('Timeout in seconds (default: 30)')
  }),
  async execute(args) {
    try {
      const method = args.method || 'GET'
      const timeout = (args.timeout || 30) * 1000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      let response: Response
      try {
        response = await fetch(args.url, {
          method,
          headers: args.headers || {},
          body: args.body,
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

      const status = `${response.status} ${response.statusText}`

      let body: string
      try {
        body = await response.text()
      } catch (textErr: any) {
        return `Error: Failed to read response body: ${textErr.message}`
      }

      // Limit response size to 10MB to prevent OOM
      const MAX_RESPONSE_SIZE = 10 * 1024 * 1024
      if (body.length > MAX_RESPONSE_SIZE) {
        body = body.slice(0, MAX_RESPONSE_SIZE) + '\n\n[Response truncated: exceeded 10MB limit]'
      }

      if (!response.ok) {
        return `HTTP ${status}\n${body}`
      }

      return body
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
