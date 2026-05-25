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

export const GitHubCreatePRTool: Tool = {
  name: 'GitHubCreatePR',
  description: 'Create a GitHub pull request. Uses gh CLI if available, otherwise falls back to REST API.',
  parameters: z.object({
    title: z.string().describe('Pull request title'),
    body: z.string().optional().describe('Pull request description/body'),
    head: z.string().describe('Branch containing changes'),
    base: z.string().optional().describe('Branch to merge into (default: main)'),
    draft: z.boolean().optional().describe('Create as draft PR'),
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
        const cmd = ['gh', 'pr', 'create', '--repo', repo, '--title', args.title, '--head', args.head]
        if (args.base) { cmd.push('--base', args.base) }
        if (args.body) { cmd.push('--body', args.body) }
        if (args.draft) { cmd.push('--draft') }
        const { stdout, stderr, exitCode } = await $`gh pr create --repo ${repo} --title ${args.title} --head ${args.head} ${args.base ? ['--base', args.base] : []} ${args.body ? ['--body', args.body] : []} ${args.draft ? '--draft' : []}`.nothrow().quiet()
        const out = stdout.toString().trim()
        const err = stderr.toString().trim()
        if (exitCode !== 0) {
          return `Error: ${err || 'gh pr create failed'}`
        }
        return out || 'Pull request created successfully'
      }

      // Fallback to REST API
      const base = args.base || 'main'
      const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          title: args.title,
          body: args.body || '',
          head: args.head,
          base,
          draft: args.draft || false
        })
      })

      const data = await response.json()
      if (!response.ok) {
        return `Error: ${data.message || 'GitHub API error'} (${response.status})`
      }
      return `Pull request created: ${data.html_url}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
