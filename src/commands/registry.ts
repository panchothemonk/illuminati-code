export interface CommandContext {
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; name?: string; tool_call_id?: string }>
  sessionManager: any
  memoryStore: any
  coordinator?: any
  apiKey: string
  verbose: boolean
  debug: boolean
  model: string
  rl: any
  setVerbose: (v: boolean) => void
  setDebug: (v: boolean) => void
  setModel: (m: string) => void
  setMessages: (m: any[]) => void
  setCoordinator: (c: any) => void
  print: (s: string) => void
  prompt: () => void
}

export type CommandHandler = (args: string[], ctx: CommandContext) => Promise<void> | void

interface CommandDef {
  name: string
  description: string
  usage?: string
  handler: CommandHandler
}

const registry = new Map<string, CommandDef>()

export function registerCommand(name: string, description: string, handler: CommandHandler, usage?: string): void {
  registry.set(name, { name, description, handler, usage })
}

export function parseCommand(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const parts = trimmed.slice(1).split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1).filter(Boolean)
  return { command, args }
}

export function getCommand(name: string): CommandDef | undefined {
  return registry.get(name)
}

export function listCommands(): CommandDef[] {
  return Array.from(registry.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function executeCommand(command: string, args: string[], ctx: CommandContext): Promise<boolean> {
  const def = registry.get(command)
  if (!def) return false
  try {
    await def.handler(args, ctx)
  } catch (err: any) {
    ctx.print(`\x1b[31m[Command Error] ${err.message}\x1b[0m`)
    if (ctx.debug) {
      ctx.print(err.stack || '')
    }
  }
  return true
}
