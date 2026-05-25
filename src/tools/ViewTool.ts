import { z } from 'zod'
import { Tool } from './index.js'

export const ViewTool: Tool = {
  name: 'View',
  description: 'View a file with line numbers. Returns file content with line numbers prepended.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file'),
    offset: z.number().optional().describe('Line number to start reading from (default: 1)'),
    limit: z.number().optional().describe('Maximum number of lines to read (default: 500)')
  }),
  async execute(args) {
    try {
      const { readFileSync } = await import('fs')
      const { resolve } = await import('path')
      const fullPath = resolve(args.path)
      let content = readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      const start = (args.offset || 1) - 1
      const end = args.limit ? start + args.limit : lines.length
      const sliced = lines.slice(start, end)
      const maxLineNumWidth = String(end).length
      const numbered = sliced.map((line, idx) => {
        const lineNum = String(start + idx + 1).padStart(maxLineNumWidth, ' ')
        return `${lineNum}|${line}`
      })
      return numbered.join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
