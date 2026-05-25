import { z } from 'zod'
import { Tool } from './index.js'

export const LSTool: Tool = {
  name: 'LS',
  description: 'List directory contents. Returns files and directories with details.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the directory'),
    showHidden: z.boolean().optional().describe('Include hidden files (default: false)')
  }),
  async execute(args) {
    try {
      const { readdirSync, statSync } = await import('fs')
      const { resolve } = await import('path')
      const fullPath = resolve(args.path || '.')
      const showHidden = args.showHidden || false

      const entries = readdirSync(fullPath)
      const lines: string[] = []

      for (const entry of entries) {
        if (!showHidden && entry.startsWith('.')) continue
        const entryPath = resolve(fullPath, entry)
        const stats = statSync(entryPath)
        const type = stats.isDirectory() ? 'd' : stats.isFile() ? 'f' : stats.isSymbolicLink() ? 'l' : '?'
        const size = stats.isFile() ? String(stats.size).padStart(10) : '-'.padStart(10)
        const mtime = stats.mtime.toISOString().slice(0, 19).replace('T', ' ')
        lines.push(`${type} ${size} ${mtime}  ${entry}`)
      }

      if (lines.length === 0) {
        return '(empty directory)'
      }

      return lines.join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
