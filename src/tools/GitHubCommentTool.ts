import { z } from 'zod'
import { Tool } from './index.js'

async function getGitHubToken(): Promise<string | undefined> {
  const token = process.env['GITHUB_TOKEN']
  if (token) return token
  try {
    const { $ } = await import('bun')
    const { stdout } = await $`gh auth token`.nothrow().quiet()
    const t = stdout.toString().trim()
    if (t) return t
  } catch {}
  return undefined
}

function resolveRepo(repo?: string): string | undefined {
  if (repo) return repo
  try {
    const { execSync } = require('child_process')
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8', timeout: 5000 }).trim()
    const match = remote.match(/github\.com[:\/]([^\/]+)\/([^\/]+?)(?:\.git)?$/)
    if (match) return `${match[1]}/${match[2]}`
  } catch {}
  return undefined
}

export const GitHubCommentTool: Tool = {
  name: 'GitHubComment',
  description: 'Add a comment to a GitHub issue or pull request.',
  parameters: z.object({
    issueNumber: z.number().describe('Issue or PR number to comment on'),
    body: z.string().describe('Comment body'),
    repo: z.string().optional().describe('Repository in owner/repo format (default: inferred from git remote)')
  }),
  async execute(args) {
    const token = await getGitHubToken()
    if (!token) {
      return 'Error: No GitHub token found. Set GITHUB_TOKEN env var or run gh auth login.'
    }

    const repo = resolveRepo(args.repo)
    if (!repo) {
      return 'Error: Could not determine repository. Provide repo as owner/repo or ensure git remote origin is a GitHub URL.'
    }

    try {
      const { $ } = await import('bun')
      const hasGh = await $`which gh`.nothrow().quiet().then(r => r.exitCode === 0)

      if (hasGh) {
        const { stdout, stderr, exitCode } = await $`gh issue comment ${String(args.issueNumber)} --repo ${repo} --body ${args.body}`.nothrow().quiet()
        const out = stdout.toString().trim()
        const err = stderr.toString().trim()
        if (exitCode !== 0) {
          // Try PR comment if issue comment failed
          const prResult = await $`gh pr comment ${String(args.issueNumber)} --repo ${repo} --body ${args.body}`.nothrow().quiet()
          const prOut = prResult.stdout.toString().trim()
          const prErr = prResult.stderr.toString().trim()
          if (prResult.exitCode !== 0) {
            return `Error: ${err || prErr || 'Failed to add comment'}`
          }
          return prOut || `Comment added to PR #${args.issueNumber}`
        }
        return out || `Comment added to issue #${args.issueNumber}`
      }

      // Fallback to REST API
      const response = await fetch(`https://api.github.com/repos/${repo}/issues/${args.issueNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ body: args.body })
      })

      const data = await response.json()
      if (!response.ok) {
        return `Error: ${data.message || 'GitHub API error'} (${response.status})`
      }
      return `Comment added: ${data.html_url}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
