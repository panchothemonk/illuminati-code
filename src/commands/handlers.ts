import { registerCommand, listCommands } from './registry.js'
import { compactMessages } from '../services/compact.js'
import { getTokenUsage, estimateMessagesTokens } from '../utils/tokenCounter.js'
import { undoLast, getHistory } from '../utils/history.js'
import { listSessions, deleteSession } from '../session/persistence.js'
import { listServers as listMCPServers, getAllActiveClients } from '../mcp/index.js'
import { getAllServerConfigs } from '../lsp/index.js'
import { createInterface } from 'readline'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR = join(homedir(), '.illuminati-code')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

function loadConfig(): Record<string, any> {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(cfg: Record<string, any>): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8')
}

export function registerAllCommands(): void {
  // 1. /help - show all commands
  registerCommand('help', 'Show all available slash commands', (args, ctx) => {
    const cmds = listCommands()
    ctx.print('\x1b[36m═══════════════════════════════════════\x1b[0m')
    ctx.print('\x1b[36m  Available Commands                   \x1b[0m')
    ctx.print('\x1b[36m═══════════════════════════════════════\x1b[0m')
    for (const cmd of cmds) {
      const usage = cmd.usage ? ` ${cmd.usage}` : ''
      ctx.print(`  \x1b[32m/${cmd.name}\x1b[0m${usage}`)
      ctx.print(`    ${cmd.description}`)
    }
    ctx.print('\x1b[36m═══════════════════════════════════════\x1b[0m')
  })

  // 2. /clear - clear screen
  registerCommand('clear', 'Clear the terminal screen', (args, ctx) => {
    process.stdout.write('\x1b[2J\x1b[H')
  })

  // 3. /compact - force context compaction
  registerCommand('compact', 'Force context compaction', (args, ctx) => {
    const before = ctx.messages.length
    const compacted = compactMessages(ctx.messages, { preserveLastN: 6 })
    ctx.setMessages(compacted)
    ctx.sessionManager.setMessages(compacted)
    ctx.print(`\x1b[33mCompacted: ${before} → ${compacted.length} messages\x1b[0m`)
    const usage = getTokenUsage(compacted)
    ctx.print(`\x1b[36mTokens: ${usage.used} / ${usage.max} (${usage.percent}%)\x1b[0m`)
  })

  // 4. /undo - undo last file change
  registerCommand('undo', 'Undo last file change', (args, ctx) => {
    const filePath = args[0]
    if (!filePath) {
      ctx.print('\x1b[33mUsage: /undo <file-path>\x1b[0m')
      return
    }
    const snap = undoLast(filePath)
    if (snap) {
      ctx.print(`\x1b[33mUndid last edit on ${filePath} (from ${new Date(snap.timestamp).toISOString()})\x1b[0m`)
    } else {
      ctx.print(`\x1b[33mNo history found for ${filePath}\x1b[0m`)
    }
  }, '<file-path>')

  // 5. /history - show file change history
  registerCommand('history', 'Show file change history', (args, ctx) => {
    const filePath = args[0]
    if (!filePath) {
      ctx.print('\x1b[33mUsage: /history <file-path>\x1b[0m')
      return
    }
    const history = getHistory(filePath)
    if (history.length === 0) {
      ctx.print(`\x1b[33mNo history for ${filePath}\x1b[0m`)
    } else {
      ctx.print(`\x1b[36mEdit history for ${filePath}:\x1b[0m`)
      for (const h of history) {
        ctx.print(`  ${new Date(h.timestamp).toISOString()} — ${h.content.length} bytes`)
      }
    }
  }, '<file-path>')

  // 6. /agents - list active agents
  registerCommand('agents', 'List active agents', (args, ctx) => {
    if (!ctx.coordinator) {
      ctx.print('\x1b[33mNo active swarm.\x1b[0m')
      return
    }
    const workers = ctx.coordinator.getWorkers?.() || []
    const activeTasks = ctx.coordinator.getActiveTasks?.() || []
    ctx.print('\x1b[36mActive Agents:\x1b[0m')
    if (workers.length === 0) {
      ctx.print('  None')
    } else {
      for (const w of workers) {
        ctx.print(`  ${w.id} (${w.config?.role || 'worker'})`)
      }
    }
    ctx.print('\x1b[36mActive Tasks:\x1b[0m')
    if (activeTasks.length === 0) {
      ctx.print('  None')
    } else {
      for (const t of activeTasks) {
        ctx.print(`  ${t.id}: ${t.description.slice(0, 60)}${t.description.length > 60 ? '...' : ''} [${t.status}]`)
      }
    }
  })

  // 7. /mcp - list MCP servers
  registerCommand('mcp', 'List MCP servers', (args, ctx) => {
    const servers = listMCPServers()
    const active = getAllActiveClients()
    ctx.print('\x1b[36mMCP Servers:\x1b[0m')
    if (servers.length === 0) {
      ctx.print('  No servers configured')
    } else {
      for (const s of servers) {
        const isActive = active.some((c: any) => c.config?.name === s.name)
        const marker = isActive ? ' \x1b[32m[connected]\x1b[0m' : ''
        ctx.print(`  ${s.name}${marker}`)
        ctx.print(`    command: ${s.command} ${s.args?.join(' ') || ''}`)
      }
    }
  })

  // 8. /lsp - list LSP servers
  registerCommand('lsp', 'List LSP servers', (args, ctx) => {
    const servers = getAllServerConfigs()
    ctx.print('\x1b[36mLSP Servers:\x1b[0m')
    for (const s of servers) {
      ctx.print(`  \x1b[32m${s.name}\x1b[0m`)
      ctx.print(`    command: ${s.command} ${s.args?.join(' ') || ''}`)
      ctx.print(`    languages: ${s.languageIds.join(', ')}`)
    }
  })

  // 9. /model - switch model
  registerCommand('model', 'Switch AI model', (args, ctx) => {
    const model = args[0]
    if (!model) {
      ctx.print(`\x1b[36mCurrent model: ${ctx.model}\x1b[0m`)
      ctx.print('\x1b[33mUsage: /model <model-name>\x1b[0m')
      return
    }
    ctx.setModel(model)
    const cfg = loadConfig()
    cfg.model = model
    saveConfig(cfg)
    ctx.print(`\x1b[33mSwitched to model: ${model}\x1b[0m`)
  }, '<model-name>')

  // 10. /verbose - toggle verbose mode
  registerCommand('verbose', 'Toggle verbose mode', (args, ctx) => {
    const newVal = !ctx.verbose
    ctx.setVerbose(newVal)
    ctx.print(`\x1b[33mVerbose mode: ${newVal ? 'ON' : 'OFF'}\x1b[0m`)
    if (newVal) {
      ctx.print('\x1b[36mVerbose mode shows full API requests/responses, tool execution details, and token counts.\x1b[0m')
    }
  })

  // 11. /debug - toggle debug mode
  registerCommand('debug', 'Toggle debug mode', (args, ctx) => {
    const newVal = !ctx.debug
    ctx.setDebug(newVal)
    ctx.print(`\x1b[33mDebug mode: ${newVal ? 'ON' : 'OFF'}\x1b[0m`)
    if (newVal) {
      ctx.print('\x1b[36mDebug mode shows raw JSON from API and stack traces.\x1b[0m')
    }
  })

  // 12. /save - save session
  registerCommand('save', 'Save current session', (args, ctx) => {
    const name = args[0] || ctx.sessionManager.getCurrentSession()
    ctx.sessionManager.saveCurrent()
    ctx.print(`\x1b[33mSaved session: ${name}\x1b[0m`)
  }, '[name]')

  // 13. /load - load session
  registerCommand('load', 'Load a saved session', (args, ctx) => {
    const name = args[0]
    if (!name) {
      ctx.print('\x1b[33mUsage: /load <session-name>\x1b[0m')
      return
    }
    const msgs = ctx.sessionManager.switchSession(name)
    ctx.setMessages(msgs)
    ctx.print(`\x1b[33mLoaded session: ${name}\x1b[0m`)
  }, '<session-name>')

  // 14. /sessions - list saved sessions
  registerCommand('sessions', 'List saved sessions', (args, ctx) => {
    const sessions = listSessions()
    ctx.print('\x1b[36mSaved sessions:\x1b[0m')
    for (const s of sessions) {
      const marker = s === ctx.sessionManager.getCurrentSession() ? ' *' : ''
      ctx.print(`  ${s}${marker}`)
    }
  })

  // 15. /tasks - show agent tasks
  registerCommand('tasks', 'Show agent tasks', (args, ctx) => {
    if (!ctx.coordinator) {
      ctx.print('\x1b[33mNo active swarm.\x1b[0m')
      return
    }
    const active = ctx.coordinator.getActiveTasks?.() || []
    const completed = ctx.coordinator.getCompletedTasks?.() || new Map()
    const events = ctx.coordinator.getEventLog?.() || []
    ctx.print('\x1b[36m═══════════════════════════════════════\x1b[0m')
    ctx.print('\x1b[36m  Agent Tasks                          \x1b[0m')
    ctx.print('\x1b[36m═══════════════════════════════════════\x1b[0m')
    ctx.print(`\x1b[33mActive (${active.length}):\x1b[0m`)
    for (const t of active) {
      ctx.print(`  [${t.status}] ${t.id}: ${t.description.slice(0, 50)}${t.description.length > 50 ? '...' : ''}`)
    }
    ctx.print(`\x1b[33mCompleted (${completed.size}):\x1b[0m`)
    for (const [id, r] of completed) {
      const statusColor = r.status === 'completed' ? '\x1b[32m' : '\x1b[31m'
      ctx.print(`  ${statusColor}[${r.status}]\x1b[0m ${id}`)
    }
    if (events.length > 0) {
      ctx.print(`\x1b[33mRecent Events:\x1b[0m`)
      const recent = events.slice(-5)
      for (const e of recent) {
        ctx.print(`  ${new Date(e.timestamp).toISOString()} ${e.type}${e.agentId ? ` (${e.agentId})` : ''}`)
      }
    }
  })

  // 16. /kill - kill agent
  registerCommand('kill', 'Kill an agent by ID', (args, ctx) => {
    const id = args[0]
    if (!id) {
      ctx.print('\x1b[33mUsage: /kill <agent-id>\x1b[0m')
      return
    }
    if (!ctx.coordinator) {
      ctx.print('\x1b[33mNo active swarm.\x1b[0m')
      return
    }
    const workers = ctx.coordinator.getWorkers?.() || []
    const worker = workers.find((w: any) => w.id === id)
    if (worker) {
      worker.cancel?.('Killed by user')
      ctx.print(`\x1b[33mKilled agent: ${id}\x1b[0m`)
    } else {
      ctx.print(`\x1b[33mAgent not found: ${id}\x1b[0m`)
    }
  }, '<agent-id>')

  // 17. /exit - quit
  registerCommand('exit', 'Quit Illuminati Code', (args, ctx) => {
    ctx.sessionManager.destroy()
    ctx.rl.close()
    // Let the rl.close() event handler exit properly
  })

  // Bonus: /tokens for token usage
  registerCommand('tokens', 'Show token usage', (args, ctx) => {
    const usage = getTokenUsage(ctx.messages)
    ctx.print(`\x1b[36mTokens: ${usage.used} / ${usage.max} (${usage.percent}%)\x1b[0m`)
    if (usage.shouldCompact) {
      ctx.print('\x1b[33mWarning: over threshold, compaction recommended\x1b[0m')
    }
  })

  // Bonus: /reset - clear current session
  registerCommand('reset', 'Reset current session', (args, ctx) => {
    ctx.sessionManager.reset()
    const system = { role: 'system' as const, content: 'You are Illuminati Code, a terminal AI coding assistant. You have access to tools: Bash, Read, Write, Edit, Grep, Glob, LS, View, Fetch, WebSearch, WebFetch, GitStatus, GitDiff, GitLog, GitBranch, GitCheckout, GitCommit, and more. When you need to use a tool, call it using the function_calling mechanism. Analyze the user request, use tools as needed, and provide a clear final answer.' }
    ctx.setMessages([system])
    ctx.sessionManager.setMessages([system])
    ctx.print('\x1b[33mSession reset.\x1b[0m')
  })

  // Bonus: /config - open config UI
  registerCommand('config', 'Open interactive config editor', async (args, ctx) => {
    const { runConfigUI } = await import('../config/ui.js')
    await runConfigUI()
    ctx.print('\x1b[33mConfig updated.\x1b[0m')
  })
}
