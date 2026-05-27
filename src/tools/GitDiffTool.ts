import { z } from 'zod'
import { $ } from '../utils/shell.js'
import { Tool } from './index.js'

export const GitDiffTool: Tool = {
  name: 'GitDiff',
  description: 'Show changes between commits, commit and working tree, etc. Returns git diff output.',
  parameters: z.object({
    file: z.string().optional().describe('Specific file to diff (optional)'),
    cached: z.boolean().optional().describe('Show staged changes (git diff --cached)'),
    path: z.string().optional().describe('Path to the git repository (default: current directory)')
  }),
  async execute(args) {
    try {
      const cwd = args.path || process.cwd()
      const cmd = ['git', '-C', cwd, 'diff']
      if (args.cached) {
        cmd.push('--cached')
      }
      if (args.file) {
        cmd.push('--', args.file)
      }
      const { stdout, stderr, exitCode } = await $(cmd)
      const out = stdout.toString().trim()
      const err = stderr.toString().trim()
      if (exitCode !== 0) {
        return `Error: ${err || 'git diff failed'}`
      }
      return out || 'No differences'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
