import { resolve } from 'path'

export enum PermissionMode {
  auto = 'auto',
  ask = 'ask',
  deny = 'deny'
}

export interface PermissionRule {
  pattern: string
  mode: PermissionMode
  tool?: string
}

export interface PermissionConfig {
  defaultMode: PermissionMode
  rules: PermissionRule[]
}

const DESTRUCTIVE_TOOLS = new Set([
  'Write', 'Edit', 'Bash', 'GitCommit', 'GitCheckout',
  'RenameSymbol', 'Screenshot'
])

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\b/i,
  /\brm -rf?\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bformat\b/i,
  />\s*\/dev\//i,
  /\bcurl.*\|.*sh\b/i,
  /\bwget.*\|.*sh\b/i,
  /\bsudo\b/i,
  /\bsu\s+-\b/i
]

const SENSITIVE_PATH_PATTERNS = [
  /\/etc\/\w+/i,
  /\/usr\/\w+/i,
  /\/bin\/\w+/i,
  /\/sbin\/\w+/i,
  /\/lib\/\w+/i,
  /\/sys\/\w+/i,
  /\/proc\/\w+/i,
  /\/dev\/\w+/i,
  /\.ssh\b/i,
  /\.gnupg\b/i,
  /\.aws\b/i,
  /\.kube\b/i,
  /\.docker\b/i,
  /\.env\b/i,
  /\.git\b/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i
]

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some(p => p.test(command))
}

function isSensitivePath(path: string): boolean {
  const resolved = resolve(path)
  return SENSITIVE_PATH_PATTERNS.some(p => p.test(resolved))
}

function matchRule(path: string, tool: string, rules: PermissionRule[]): PermissionRule | undefined {
  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, 'i')
    const matchesPath = regex.test(path)
    const matchesTool = !rule.tool || rule.tool === tool
    if (matchesPath && matchesTool) {
      return rule
    }
  }
  return undefined
}

export interface ToolPermissionContext {
  toolName: string
  args: Record<string, any>
  config: PermissionConfig
  onPromptStart?: () => void
  onPromptEnd?: () => void
}

export async function checkPermission(ctx: ToolPermissionContext): Promise<{ allowed: boolean; reason?: string }> {
  const { toolName, args, config, onPromptStart, onPromptEnd } = ctx

  const isDestructive = DESTRUCTIVE_TOOLS.has(toolName)
  if (!isDestructive) {
    return { allowed: true }
  }

  let targetPath = ''
  let command = ''

  if (args.path) targetPath = String(args.path)
  if (args.filePath) targetPath = String(args.filePath)
  if (args.command) command = String(args.command)
  if (args.url) targetPath = String(args.url)
  if (args.imagePath) targetPath = String(args.imagePath)

  const effectivePath = targetPath || command || toolName

  const rule = matchRule(effectivePath, toolName, config.rules)
  const mode = rule?.mode ?? config.defaultMode

  if (mode === PermissionMode.deny) {
    return { allowed: false, reason: `Permission denied by rule: ${rule?.pattern || 'default deny'}` }
  }

  if (mode === PermissionMode.auto) {
    if (command && isDestructiveCommand(command)) {
      return { allowed: false, reason: 'Destructive command blocked in auto mode' }
    }
    if (targetPath && isSensitivePath(targetPath)) {
      return { allowed: false, reason: 'Sensitive path blocked in auto mode' }
    }
    return { allowed: true }
  }

  if (mode === PermissionMode.ask) {
    let question = `Allow ${toolName}`
    if (targetPath) question += ` on "${targetPath}"`
    if (command) question += ` with command "${command}"`
    question += '?'

    if (command && isDestructiveCommand(command)) {
      question += ' \x1b[31mWARNING: This command looks destructive!\x1b[0m'
    }
    if (targetPath && isSensitivePath(targetPath)) {
      question += ' \x1b[31mWARNING: This path looks sensitive!\x1b[0m'
    }

    onPromptStart?.()
    const answer = await new Promise<string>((resolve) => {
      process.stdout.write(`${question} (y/n): `)
      process.stdin.once('data', (data: Buffer) => {
        const text = data.toString().trim().toLowerCase()
        resolve(text)
      })
    })
    onPromptEnd?.()

    if (answer === 'y' || answer === 'yes') {
      return { allowed: true }
    }
    return { allowed: false, reason: 'User denied permission' }
  }

  return { allowed: true }
}

export function createDefaultPermissionConfig(): PermissionConfig {
  return {
    defaultMode: PermissionMode.ask,
    rules: [
      { pattern: '^/tmp/', mode: PermissionMode.auto },
      { pattern: '^/var/tmp/', mode: PermissionMode.auto },
      { pattern: 'node_modules', mode: PermissionMode.ask },
      { pattern: 'package\.json$', mode: PermissionMode.ask },
      { pattern: '\.env', mode: PermissionMode.deny },
      { pattern: '\.ssh', mode: PermissionMode.deny },
      { pattern: '\.git/', mode: PermissionMode.ask },
      { pattern: 'rm -rf', mode: PermissionMode.deny, tool: 'Bash' }
    ]
  }
}

export function loadPermissionConfigFromEnv(): PermissionConfig {
  const envMode = process.env['ILLUMINATI_PERMISSION_MODE'] as PermissionMode | undefined
  const defaultMode = envMode && Object.values(PermissionMode).includes(envMode)
    ? envMode
    : PermissionMode.ask

  const rules: PermissionRule[] = []
  const envRules = process.env['ILLUMINATI_PERMISSION_RULES']
  if (envRules) {
    try {
      const parsed = JSON.parse(envRules)
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (r.pattern && r.mode && Object.values(PermissionMode).includes(r.mode)) {
            rules.push({
              pattern: r.pattern,
              mode: r.mode,
              tool: r.tool
            })
          }
        }
      }
    } catch {
      // ignore invalid env rules
    }
  }

  return { defaultMode, rules }
}
