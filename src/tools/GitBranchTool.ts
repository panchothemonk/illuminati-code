import { z } from 'zod'
import { $tag } from '../utils/shell.js'
import { Tool } from './index.js'

export const GitBranchTool: Tool = {
  name: 'GitBranch',
  description: 'List all branches. Returns git branch -a output.',
  parameters: z.object({
    path: z.string().optional().describe('Path to the git repository (default: current directory)')
  }),
  async execute(args) {
    try {
      const cwd = args.path || process.cwd()
      const { stdout, stderr, exitCode } = await $tag`git -C ${cwd} branch -a`
      const out = stdout.toString().trim()
      const err = stderr.toString().trim()
      if (exitCode !== 0) {
        return `Error: ${err || 'git branch failed'}`
      }
      return out || 'No branches found'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
