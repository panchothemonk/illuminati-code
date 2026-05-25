import { z, ZodSchema } from 'zod'
import { LSTool } from './LSTool.js'
import { ViewTool } from './ViewTool.js'
import { FetchTool } from './FetchTool.js'
import { WebSearchTool } from './WebSearchTool.js'
import { WebFetchTool } from './WebFetchTool.js'
import { GitStatusTool } from './GitStatusTool.js'
import { GitDiffTool } from './GitDiffTool.js'
import { GitLogTool } from './GitLogTool.js'
import { GitBranchTool } from './GitBranchTool.js'
import { GitCheckoutTool } from './GitCheckoutTool.js'
import { GitCommitTool } from './GitCommitTool.js'
import { GitHubCreatePRTool } from './GitHubCreatePRTool.js'
import { GitHubReviewPRTool } from './GitHubReviewPRTool.js'
import { GitHubCommentTool } from './GitHubCommentTool.js'
import { GitHubListIssuesTool } from './GitHubListIssuesTool.js'
import { ScreenshotTool } from './ScreenshotTool.js'
import { ImageTool } from './ImageTool.js'
import {
  GoToDefinitionTool,
  FindReferencesTool,
  HoverTool,
  GetDiagnosticsTool,
  RenameSymbolTool
} from '../lsp/features.js'

export interface Tool {
  name: string
  description: string
  parameters: ZodSchema
  execute: (args: any) => Promise<string>
}

export { LSTool, ViewTool, FetchTool, WebSearchTool, WebFetchTool, GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCheckoutTool, GitCommitTool, GitHubCreatePRTool, GitHubReviewPRTool, GitHubCommentTool, GitHubListIssuesTool, ScreenshotTool, ImageTool }
export { GoToDefinitionTool, FindReferencesTool, HoverTool, GetDiagnosticsTool, RenameSymbolTool }

export let ALL_TOOLS: Tool[] = []

export function setTools(tools: Tool[]): void {
  ALL_TOOLS = tools
}

export const BashTool: Tool = {
  name: 'Bash',
  description: 'Execute a bash command in the terminal. Use for file operations, git, builds, etc.',
  parameters: z.object({
    command: z.string().describe('The bash command to execute'),
    timeout: z.number().optional().describe('Timeout in seconds (default 60)')
  }),
  async execute(args) {
    try {
      const { stdout, stderr, exitCode } = await Bun.$`bash -c ${args.command}`.nothrow().quiet()
      const out = stdout.toString()
      const err = stderr.toString()
      if (exitCode !== 0) {
        return `Exit code ${exitCode}\nstdout: ${out}\nstderr: ${err}`
      }
      return out || err || '(no output)'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

import { saveSnapshot } from '../utils/history.js'

export const ReadTool: Tool = {
  name: 'Read',
  description: 'Read the contents of a file. Returns file content as string.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file'),
    offset: z.number().optional().describe('Line number to start reading from'),
    limit: z.number().optional().describe('Maximum number of lines to read')
  }),
  async execute(args) {
    try {
      const { readFileSync } = await import('fs')
      const { resolve } = await import('path')
      const fullPath = resolve(args.path)
      let content = readFileSync(fullPath, 'utf-8')
      if (args.offset || args.limit) {
        const lines = content.split('\n')
        const start = (args.offset || 1) - 1
        const end = args.limit ? start + args.limit : lines.length
        content = lines.slice(start, end).join('\n')
      }
      return content
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const WriteTool: Tool = {
  name: 'Write',
  description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file'),
    content: z.string().describe('Content to write to the file')
  }),
  async execute(args) {
    try {
      const { writeFileSync, mkdirSync, existsSync, readFileSync } = await import('fs')
      const { dirname, resolve } = await import('path')
      const fullPath = resolve(args.path)
      mkdirSync(dirname(fullPath), { recursive: true })
      if (existsSync(fullPath)) {
        const existing = readFileSync(fullPath, 'utf-8')
        saveSnapshot(fullPath, existing)
      }
      writeFileSync(fullPath, args.content, 'utf-8')
      return `Wrote ${args.content.length} bytes to ${fullPath}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const EditTool: Tool = {
  name: 'Edit',
  description: 'Replace a unique string in a file with another string. Use for targeted edits.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file'),
    old_string: z.string().describe('Exact text to find and replace'),
    new_string: z.string().describe('Replacement text')
  }),
  async execute(args) {
    try {
      const { readFileSync, writeFileSync } = await import('fs')
      const { resolve } = await import('path')
      const fullPath = resolve(args.path)
      let content = readFileSync(fullPath, 'utf-8')
      if (!content.includes(args.old_string)) {
        return `Error: old_string not found in file`
      }
      saveSnapshot(fullPath, content)
      content = content.replace(args.old_string, args.new_string)
      writeFileSync(fullPath, content, 'utf-8')
      return `Edited ${fullPath}`
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const GrepTool: Tool = {
  name: 'Grep',
  description: 'Search file contents using regex. Returns matching lines with line numbers.',
  parameters: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('Directory or file to search in (default: current directory)'),
    file_glob: z.string().optional().describe('Filter files by pattern, e.g. *.ts')
  }),
  async execute(args) {
    try {
      const { $ } = await import('bun')
      const path = args.path || '.'
      const glob = args.file_glob || '*'
      const { stdout, stderr, exitCode } = await $`grep -rn ${args.pattern} ${path} --include=${glob}`.nothrow().quiet()
      const out = stdout.toString()
      const err = stderr.toString()
      if (exitCode !== 0 && !out) {
        return err || 'No matches found'
      }
      return out
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const GlobTool: Tool = {
  name: 'Glob',
  description: 'Find files by glob pattern. Returns list of matching file paths.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern, e.g. src/**/*.ts'),
    path: z.string().optional().describe('Directory to search in (default: current directory)')
  }),
  async execute(args) {
    try {
      const { $ } = await import('bun')
      const path = args.path || '.'
      const { stdout, stderr, exitCode } = await $`find ${path} -type f -name ${args.pattern}`.nothrow().quiet()
      const out = stdout.toString()
      if (exitCode !== 0 && !out) {
        return stderr.toString() || 'No matches found'
      }
      return out
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const ALL_BUILTIN_TOOLS: Tool[] = [BashTool, ReadTool, WriteTool, EditTool, GrepTool, GlobTool, LSTool, ViewTool, FetchTool, WebSearchTool, WebFetchTool, GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool, GitCheckoutTool, GitCommitTool, GitHubCreatePRTool, GitHubReviewPRTool, GitHubCommentTool, GitHubListIssuesTool, GoToDefinitionTool, FindReferencesTool, HoverTool, GetDiagnosticsTool, RenameSymbolTool, ScreenshotTool, ImageTool]

// Initialize ALL_TOOLS with builtins
ALL_TOOLS = [...ALL_BUILTIN_TOOLS]
