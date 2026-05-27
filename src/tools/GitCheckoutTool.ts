import { z } from 'zod'
import { $tag } from '../utils/shell.js'
import { Tool } from './index.js'

export const GitCheckoutTool: Tool = {
  name: 'GitCheckout',
  description: 'Switch branches. Runs git checkout <branch>.',
  parameters: z.object({
    branch: z.string().describe('Branch name to checkout'),
    path: z.string().optional().describe('Path to the git repository (default: current directory)')
  }),
  async execute(args) {
    try {
      const cwd = args.path || process.cwd()
      const { stdout, stderr, exitCode } = await $tag`git -C ${cwd} checkout -- ${args.branch}`
      const out = stdout.toString().trim()
      const err = stderr.toString().trim()
      if (exitCode !== 0) {
        return `Error: ${err || 'git checkout failed'}`
      }
      return out || `Switched to branch '${args.branch}'`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
