/**
 * Node.js-compatible shell execution wrapper.
 * Replaces Bun.$ template literals with child_process.execFile.
 */
import { execFile, exec } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

export interface ShellResult {
  stdout: Buffer | string
  stderr: Buffer | string
  exitCode: number
}

/**
 * Execute a command with arguments (safe, no shell injection).
 * Usage: $(['ls', '-la', '/path'])
 */
export async function $(args: string[]): Promise<ShellResult> {
  if (!args.length) {
    return { stdout: '', stderr: '', exitCode: 1 }
  }
  const [cmd, ...cmdArgs] = args
  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 60000,
      killSignal: 'SIGTERM'
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.code || 1
    }
  }
}

/**
 * Execute a raw shell command (less safe, use sparingly).
 */
export async function $exec(command: string): Promise<ShellResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.code || 1
    }
  }
}

/**
 * Tag function that converts template literal to command array.
 * Usage: $`ls -la ${path}`
 */
export function $tag(strings: TemplateStringsArray, ...values: any[]): Promise<ShellResult> {
  const parts: string[] = []
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i])
    if (i < values.length) {
      const v = values[i]
      if (v === undefined || v === null) {
        // Skip undefined/null values
      } else if (Array.isArray(v)) {
        parts.push(...v.map(String))
      } else {
        parts.push(String(v))
      }
    }
  }
  // Split the combined string into args
  const combined = parts.join('')
  const args = combined.trim().split(/\s+/).filter(Boolean)
  return $(args)
}
