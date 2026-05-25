import { z } from 'zod'
import { Tool } from './index.js'

export const GitLogTool: Tool = {
  name: 'GitLog',
  description: 'Show commit logs in one-line format. Returns git log --oneline output.',
  parameters: z.object({
    count: z.number().optional().describe('Number of commits to show (default: 10)'),
    path: z.string().optional().describe('Path to the git repository (default: current directory)')
  }),
  async execute(args) {
    try {
      const { $ } = await import('bun')
      const cwd = args.path || process.cwd()
      const count = args.count || 10
      const { stdout, stderr, exitCode } = await $`git -C ${cwd} log --oneline -n ${count}`.nothrow().quiet()
      const out = stdout.toString().trim()
      const err = stderr.toString().trim()
      if (exitCode !== 0) {
        return `Error: ${err || 'git log failed'}`
      }
      return out || 'No commits found'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
