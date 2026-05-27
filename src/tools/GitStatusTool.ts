import { z } from 'zod'
import { $tag } from '../utils/shell.js'
import { Tool } from './index.js'

export const GitStatusTool: Tool = {
  name: 'GitStatus',
  description: 'Show the working tree status in short format. Returns git status --short output.',
  parameters: z.object({
    path: z.string().optional().describe('Path to the git repository (default: current directory)')
  }),
  async execute(args) {
    try {
      const cwd = args.path || process.cwd()
      const { stdout, stderr, exitCode } = await $tag`git -C ${cwd} status --short`
      const out = stdout.toString().trim()
      const err = stderr.toString().trim()
      if (exitCode !== 0) {
        return `Error: ${err || 'git status failed'}`
      }
      return out || 'Nothing to commit, working tree clean'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
