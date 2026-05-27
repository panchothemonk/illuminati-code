import { z } from 'zod'
import { $, $tag } from '../utils/shell.js'
import { Tool } from './index.js'

async function getGitHubToken(): Promise<string | undefined> {
  const token = process.env['GITHUB_TOKEN']
  if (token) return token
  try {
    const { stdout } = await $tag`gh auth token`
    const t = stdout.toString().trim()
    if (t) return t
  } catch {}
  return undefined
}

async function resolveRepo(repo?: string): Promise<string | undefined> {
  if (repo) return repo
  try {
    const { execSync } = await import('child_process')
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8', timeout: 5000 }).trim()
    const match = remote.match(/github\.com[:\/]([^\/]+)\/([^\/]+?)(?:\.git)?$/)
    if (match) return `${match[1]}/${match[2]}`
  } catch {}
  return undefined
}

export const GitHubReviewPRTool: Tool = {
  name: 'GitHubReviewPR',
  description: 'Review a GitHub pull request (approve, request changes, or comment).',
  parameters: z.object({
    prNumber: z.number().describe('Pull request number'),
    reviewType: z.enum(['approve', 'request-changes', 'comment']).describe('Type of review'),
    body: z.string().optional().describe('Review comment/body'),
    repo: z.string().optional().describe('Repository in owner/repo format (default: inferred from git remote)')
  }),
  async execute(args) {
    const token = await getGitHubToken()
    if (!token) {
      return 'Error: No GitHub token found. Set GITHUB_TOKEN env var or run gh auth login.'
    }

    const repo = await resolveRepo(args.repo)
    if (!repo) {
      return 'Error: Could not determine repository. Provide repo as owner/repo or ensure git remote origin is a GitHub URL.'
    }

    try {
      const hasGh = await $tag`which gh`.then(r => r.exitCode === 0)

      if (hasGh) {
        const cmd = ['gh', 'pr', 'review', String(args.prNumber), '--repo', repo]
        cmd.push('--' + args.reviewType)
        if (args.body) { cmd.push('--body'); cmd.push(args.body) }
        const { stdout, stderr, exitCode } = await $(cmd)
        const out = stdout.toString().trim()
        const err = stderr.toString().trim()
        if (exitCode !== 0) {
          return `Error: ${err || 'gh pr review failed'}`
        }
        return out || `Review submitted: ${args.reviewType}`
      }

      // Fallback to REST API
      const eventMap: Record<string, string> = {
        'approve': 'APPROVE',
        'request-changes': 'REQUEST_CHANGES',
        'comment': 'COMMENT'
      }
      const event = eventMap[args.reviewType]
      const payload: any = { event }
      if (args.body) payload.body = args.body

      const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${args.prNumber}/reviews`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      if (!response.ok) {
        return `Error: ${data.message || 'GitHub API error'} (${response.status})`
      }
      return `Review submitted: ${args.reviewType} on PR #${args.prNumber}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
