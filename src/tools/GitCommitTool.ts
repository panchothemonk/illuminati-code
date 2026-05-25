import { z } from 'zod'
import { Tool } from './index.js'

export const GitCommitTool: Tool = {
  name: 'GitCommit',
  description: 'Record changes to the repository. Runs git commit -m <message>.',
  parameters: z.object({
    message: z.string().describe('Commit message'),
    amend: z.boolean().optional().describe('Amend the previous commit (--amend)'),
    path: z.string().optional().describe('Path to the git repository (default: current directory)')
  }),
  async execute(args) {
    try {
      const { $ } = await import('bun')
      const cwd = args.path || process.cwd()
      const cmd = ['git', '-C', cwd, 'commit', '-m', args.message]
      if (args.amend) {
        cmd.push('--amend')
      }
      const { stdout, stderr, exitCode } = await $`git -C ${cwd} commit -m ${args.message} ${args.amend ? '--amend' : undefined}`.nothrow().quiet()
      const out = stdout.toString().trim()
      const err = stderr.toString().trim()
      if (exitCode !== 0) {
        return `Error: ${err || 'git commit failed'}`
      }
      return out || 'Commit created successfully'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
