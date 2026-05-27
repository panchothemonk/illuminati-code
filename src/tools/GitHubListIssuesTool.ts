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

export const GitHubListIssuesTool: Tool = {
  name: 'GitHubListIssues',
  description: 'List issues in a GitHub repository.',
  parameters: z.object({
    state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by issue state (default: open)'),
    limit: z.number().optional().describe('Maximum number of issues to return (default: 30)'),
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

    const state = args.state || 'open'
    const limit = args.limit || 30

    try {
      const hasGh = await $tag`which gh`.then(r => r.exitCode === 0)

      if (hasGh) {
        const cmd = ['gh', 'issue', 'list', '--repo', repo, '--limit', String(limit)]
        if (state !== 'all') { cmd.push('--state', state) }
        const { stdout, stderr, exitCode } = await $(cmd)
        const out = stdout.toString().trim()
        const err = stderr.toString().trim()
        if (exitCode !== 0) {
          return `Error: ${err || 'gh issue list failed'}`
        }
        return out || 'No issues found'
      }

      // Fallback to REST API
      const params = new URLSearchParams()
      if (state !== 'all') params.append('state', state)
      params.append('per_page', String(limit))

      const response = await fetch(`https://api.github.com/repos/${repo}/issues?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })

      const data = await response.json()
      if (!response.ok) {
        return `Error: ${data.message || 'GitHub API error'} (${response.status})`
      }

      if (!Array.isArray(data) || data.length === 0) {
        return 'No issues found'
      }

      const lines = data.map((issue: any) => {
        const labels = issue.labels?.map((l: any) => l.name).join(', ') || ''
        return `#${issue.number} [${issue.state}] ${issue.title}${labels ? ` (${labels})` : ''} — ${issue.html_url}`
      })
      return lines.join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
