import { createInterface } from 'readline'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { runToolLoop } from './services/toolLoop.js'
import { AgentCoordinator } from './agents/index.js'
import { SessionManager } from './session/manager.js'
import { compactMessages } from './services/compact.js'
import { shouldCompact, getTokenUsage, estimateMessagesTokens } from './utils/tokenCounter.js'
import { saveSnapshot, undoLast, getHistory, clearHistory } from './utils/history.js'
import { deleteSession, listSessions } from './session/persistence.js'
import { createVectorStore, indexDirectory, getStoreStats, hybridSearch, formatSearchResults } from './memory/index.js'
import { registerAllCommands, parseCommand, executeCommand } from './commands/index.js'
import { runConfigUI } from './config/ui.js'

const _env = process['env']
const _key = _env['KIMI_API_KEY'] || ''
const _cfgPath = join(homedir(), '.illuminati-code', 'config.json')
let KIMI_API_KEY = _key
let CURRENT_MODEL = 'kimi-k2.6'
let VERBOSE = false
let DEBUG = false

if (existsSync(_cfgPath)) {
  try {
    const _file = readFileSync(_cfgPath, 'utf-8')
    const _json = JSON.parse(_file)
    const _k = _json['apiKey'] || ''
    if (_k) KIMI_API_KEY = _k
    const _m = _json['model'] || ''
    if (_m) CURRENT_MODEL = _m
    if (_json['verbose'] === true) VERBOSE = true
    if (_json['debug'] === true) DEBUG = true
  } catch {}
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: any[]
}

const SYSTEM_PROMPT = 'You are Illuminati Code, a terminal AI coding assistant. You have access to tools: Bash, Read, Write, Edit, Grep, Glob, LS, View, Fetch, WebSearch, WebFetch, GitStatus, GitDiff, GitLog, GitBranch, GitCheckout, GitCommit, and more. When you need to use a tool, call it using the function_calling mechanism. Analyze the user request, use tools as needed, and provide a clear final answer.'

const sessionManager = new SessionManager({ defaultSessionName: 'default', autoSaveIntervalMs: 30000 })
let messages: Message[] = sessionManager.getMessages()

const memoryStore = createVectorStore()
let memoryIndexed = false
let activeCoordinator: AgentCoordinator | undefined
const msgQueue: string[] = []
let msgProcessing = false

async function ensureMemoryIndexed(): Promise<void> {
  if (memoryIndexed) return
  const count = indexDirectory(memoryStore, process.cwd())
  const stats = getStoreStats(memoryStore)
  console.log(`\x1b[33m[Memory] Indexed ${stats.totalSnippets} snippets from ${stats.files} files\x1b[0m`)
  memoryIndexed = true
}

// Validate loaded messages: any assistant with tool_calls must have matching tool results after
function isValidHistory(msgs: Message[]): boolean {
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const ids = new Set(m.tool_calls.map((tc: any) => tc.id))
      for (let j = i + 1; j < msgs.length && ids.size > 0; j++) {
        if (msgs[j].role === 'tool' && msgs[j].tool_call_id && ids.has(msgs[j].tool_call_id)) {
          ids.delete(msgs[j].tool_call_id)
        }
      }
      if (ids.size > 0) return false
    }
  }
  return true
}

if (messages.length === 0 || !messages.some(m => m.role === 'system') || !isValidHistory(messages)) {
  messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  sessionManager.setMessages(messages)
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[32m>\x1b[0m '
})

function printBanner(): void {
  console.log('\x1b[36m╔══════════════════════════════════════╗\x1b[0m')
  console.log('\x1b[36m║     Illuminati Code v0.1.0          ║\x1b[0m')
  console.log('\x1b[36m╚══════════════════════════════════════╝\x1b[0m')
  console.log('')
  console.log('Type /help for all commands')
  console.log('')
}

async function askForApiKey(): Promise<boolean> {
  console.log('\x1b[36m═══════════════════════════════════════\x1b[0m')
  console.log('\x1b[36m  Welcome to Illuminati Code!          \x1b[0m')
  console.log('\x1b[36m═══════════════════════════════════════\x1b[0m')
  console.log('')
  console.log('To use Illuminati Code, you need a Kimi API key.')
  console.log('Get one at: https://platform.moonshot.cn/console/api-keys')
  console.log('')

  const key = await new Promise<string>((resolve) => {
    rl.question('\x1b[32mEnter your Kimi API key: \x1b[0m', (answer) => {
      resolve(answer.trim())
    })
  })

  if (!key) {
    console.log('\x1b[31mNo API key provided. Exiting.\x1b[0m')
    return false
  }

  KIMI_API_KEY = key
  try {
    const { writeFileSync, mkdirSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const dir = join(homedir(), '.illuminati-code')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ apiKey: key, model: CURRENT_MODEL }, null, 2), 'utf-8')
    console.log('\x1b[32mAPI key saved!\x1b[0m\n')
    return true
  } catch (err: any) {
    console.log(`\x1b[31mError saving config: ${err.message}\x1b[0m`)
    return false
  }
}

printBanner()

if (!KIMI_API_KEY) {
  askForApiKey().then(ok => {
    if (!ok) {
      rl.close()
      process.exit(1)
    }
    rl.prompt()
  })
}

function maybeCompact(): void {
  if (shouldCompact(messages)) {
    const before = messages.length
    messages = compactMessages(messages, { preserveLastN: 6 })
    const after = messages.length
    if (after < before) {
      console.log(`\x1b[33m[Context compacted: ${before} → ${after} messages]\x1b[0m`)
      sessionManager.setMessages(messages)
    }
  }
}

function print(s: string): void {
  console.log(s)
}

function prompt(): void {
  rl.prompt()
}

function setVerbose(v: boolean): void {
  VERBOSE = v
  try {
    const cfg = JSON.parse(readFileSync(_cfgPath, 'utf-8'))
    cfg.verbose = v
    const { writeFileSync } = require('fs')
    writeFileSync(_cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch {}
}

function setDebug(v: boolean): void {
  DEBUG = v
  try {
    const cfg = JSON.parse(readFileSync(_cfgPath, 'utf-8'))
    cfg.debug = v
    const { writeFileSync } = require('fs')
    writeFileSync(_cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch {}
}

function setModel(m: string): void {
  CURRENT_MODEL = m
}

function setMessages(m: Message[]): void {
  messages = m
}

function setCoordinator(c: AgentCoordinator | undefined): void {
  activeCoordinator = c
}

registerAllCommands()

if (KIMI_API_KEY) {
  rl.prompt()
}

rl.on('line', async (input) => {
  const text = input.trim()

  if (!text) {
    rl.prompt()
    return
  }

  // Handle legacy exit/quit
  if (text === 'exit' || text === 'quit') {
    sessionManager.destroy()
    rl.close()
    return
  }

  // Parse slash command
  const parsed = parseCommand(text)
  if (parsed) {
    const ctx = {
      messages,
      sessionManager,
      memoryStore,
      coordinator: activeCoordinator,
      apiKey: KIMI_API_KEY,
      verbose: VERBOSE,
      debug: DEBUG,
      model: CURRENT_MODEL,
      rl,
      setVerbose,
      setDebug,
      setModel,
      setMessages,
      setCoordinator,
      print,
      prompt
    }
    const handled = await executeCommand(parsed.command, parsed.args, ctx)
    if (handled) {
      rl.prompt()
      return
    }
  }

  // Legacy commands (still supported for backwards compat)
  if (text === '/sessions') {
    const sessions = listSessions()
    console.log('\x1b[36mSaved sessions:\x1b[0m')
    for (const s of sessions) {
      const marker = s === sessionManager.getCurrentSession() ? ' *' : ''
      console.log(`  ${s}${marker}`)
    }
    console.log('')
    rl.prompt()
    return
  }

  if (text === '/reset') {
    sessionManager.reset()
    messages = [{ role: 'system', content: SYSTEM_PROMPT }]
    console.log('\x1b[33mSession reset.\x1b[0m')
    rl.prompt()
    return
  }

  if (text.startsWith('/session ')) {
    const name = text.slice(9).trim()
    if (!name) {
      console.log('\x1b[33mUsage: /session <name>\x1b[0m')
      rl.prompt()
      return
    }
    messages = sessionManager.switchSession(name)
    if (messages.length === 0 || !messages.some(m => m.role === 'system')) {
      messages = [{ role: 'system', content: SYSTEM_PROMPT }]
      sessionManager.setMessages(messages)
    }
    console.log(`\x1b[33mSwitched to session: ${name}\x1b[0m`)
    rl.prompt()
    return
  }

  if (text.startsWith('/save')) {
    const name = text.slice(5).trim() || sessionManager.getCurrentSession()
    sessionManager.saveCurrent()
    console.log(`\x1b[33mSaved session: ${name}\x1b[0m`)
    rl.prompt()
    return
  }

  if (text.startsWith('/undo ')) {
    const filePath = text.slice(6).trim()
    if (!filePath) {
      console.log('\x1b[33mUsage: /undo <file-path>\x1b[0m')
      rl.prompt()
      return
    }
    const snap = undoLast(filePath)
    if (snap) {
      console.log(`\x1b[33mUndid last edit on ${filePath} (from ${new Date(snap.timestamp).toISOString()})\x1b[0m`)
    } else {
      console.log(`\x1b[33mNo history found for ${filePath}\x1b[0m`)
    }
    rl.prompt()
    return
  }

  if (text.startsWith('/history ')) {
    const filePath = text.slice(9).trim()
    if (!filePath) {
      console.log('\x1b[33mUsage: /history <file-path>\x1b[0m')
      rl.prompt()
      return
    }
    const history = getHistory(filePath)
    if (history.length === 0) {
      console.log(`\x1b[33mNo history for ${filePath}\x1b[0m`)
    } else {
      console.log(`\x1b[36mEdit history for ${filePath}:\x1b[0m`)
      for (const h of history) {
        console.log(`  ${new Date(h.timestamp).toISOString()} — ${h.content.length} bytes`)
      }
    }
    rl.prompt()
    return
  }

  if (text === '/compact') {
    const before = messages.length
    messages = compactMessages(messages, { preserveLastN: 6 })
    const after = messages.length
    console.log(`\x1b[33mCompacted: ${before} → ${after} messages\x1b[0m`)
    sessionManager.setMessages(messages)
    rl.prompt()
    return
  }

  if (text === '/tokens') {
    const usage = getTokenUsage(messages)
    console.log(`\x1b[36mTokens: ${usage.used} / ${usage.max} (${usage.percent}%)\x1b[0m`)
    if (usage.shouldCompact) {
      console.log('\x1b[33mWarning: over threshold, compaction recommended\x1b[0m')
    }
    rl.prompt()
    return
  }

  if (text === '/memory') {
    memoryIndexed = false
    await ensureMemoryIndexed()
    rl.prompt()
    return
  }

  if (text.startsWith('/search ')) {
    const query = text.slice(8).trim()
    if (!query) {
      console.log('\x1b[33mUsage: /search <query>\x1b[0m')
      rl.prompt()
      return
    }
    await ensureMemoryIndexed()
    const results = hybridSearch(memoryStore, query, { topK: 5 })
    console.log(formatSearchResults(results))
    rl.prompt()
    return
  }

  if (text.startsWith('/swarm ')) {
    const task = text.slice(7).trim()
    if (!task) {
      console.log('\x1b[33mUsage: /swarm <task description>\x1b[0m')
      rl.prompt()
      return
    }
    if (!KIMI_API_KEY) {
      console.log('\x1b[31mError: KIMI_API_KEY not set.\x1b[0m')
      rl.prompt()
      return
    }

    console.log('\x1b[36m[Swarm] Decomposing task...\x1b[0m')
    const coordinator = new AgentCoordinator({
      apiKey: KIMI_API_KEY,
      maxConcurrentAgents: 5,
      defaultTimeout: 120000,
      onEvent: (event) => {
        if (event.type === 'agent_spawn') {
          console.log(`\x1b[36m[Swarm] Spawned agent ${event.agentId}\x1b[0m`)
        } else if (event.type === 'task_complete') {
          console.log(`\x1b[32m[Swarm] Task ${event.taskId} complete\x1b[0m`)
        } else if (event.type === 'task_fail') {
          console.log(`\x1b[31m[Swarm] Task ${event.taskId} failed\x1b[0m`)
        }
      }
    })
    activeCoordinator = coordinator

    try {
      const result = await coordinator.runTask(task)
      console.log('\n\x1b[36m═══ Swarm Result ═══\x1b[0m\n')
      console.log(result.output)
      console.log('\n\x1b[36m════════════════════\x1b[0m')
    } catch (err: any) {
      console.log(`\x1b[31m[Swarm Error] ${err.message}\x1b[0m`)
      if (DEBUG) {
        console.log(err.stack || '')
      }
    }

    activeCoordinator = undefined
    console.log('')
    rl.prompt()
    return
  }

  // Normal chat message
  if (msgProcessing) {
    msgQueue.push(text)
    console.log(`\x1b[90m[Queued ${msgQueue.length} message${msgQueue.length > 1 ? 's' : ''}]\x1b[0m`)
    rl.prompt()
    return
  }

  await handleChat(text)
  rl.prompt()
})

rl.on('close', () => {
  sessionManager.destroy()
  console.log('\n\x1b[33mGoodbye.\x1b[0m')
  process.exit(0)
})

async function handleChat(text: string): Promise<void> {
  messages.push({ role: 'user', content: text })
  maybeCompact()

  msgProcessing = true
  process.stdout.write('\x1b[36mAssistant:\x1b[0m ')

  try {
    let hasOutput = false
    let reasoningActive = false
    const result = await runToolLoop({
      apiKey: KIMI_API_KEY,
      model: CURRENT_MODEL,
      messages,
      verbose: VERBOSE,
      debug: DEBUG,
      readline: rl,
      onReasoningDelta: (delta) => {
        if (!hasOutput) {
          process.stdout.write('\x1b[90m')
          hasOutput = true
        }
        reasoningActive = true
        process.stdout.write(delta)
      },
      onTextDelta: (delta) => {
        if (hasOutput && reasoningActive) {
          process.stdout.write('\x1b[0m')
          reasoningActive = false
        }
        process.stdout.write(delta)
        hasOutput = true
      },
      onToolStart: (name, args) => {
        if (hasOutput) {
          process.stdout.write('\n')
          hasOutput = false
        }
        process.stdout.write(`\x1b[33m[Tool: ${name}]\x1b[0m\n`)
        if (VERBOSE) {
          console.log(`\x1b[90m  Args: ${JSON.stringify(args)}\x1b[0m`)
        }
      },
      onToolEnd: (name, result) => {
        process.stdout.write(`\x1b[33m[Tool ${name} done]\x1b[0m\n`)
        if (VERBOSE) {
          const preview = result.length > 200 ? result.slice(0, 200) + '...' : result
          console.log(`\x1b[90m  Result: ${preview}\x1b[0m`)
        }
      },
      onApiRequest: (body) => {
        if (VERBOSE) {
          console.log(`\x1b[90m[API Request] ${JSON.stringify(body).slice(0, 500)}...\x1b[0m`)
        }
      },
      onApiResponseChunk: (chunk) => {
        if (DEBUG) {
          console.log(`\x1b[90m[API Chunk] ${JSON.stringify(chunk)}\x1b[0m`)
        }
      }
    })

    if (!hasOutput && result) {
      process.stdout.write(result)
    }
    console.log('')

  } catch (err: any) {
    console.log(`\x1b[31mError: ${err.message}\x1b[0m`)
    if (DEBUG) {
      console.log(err.stack || '')
    }
  }

  sessionManager.setMessages(messages)
  maybeCompact()
  if (VERBOSE) {
    const usage = getTokenUsage(messages)
    console.log(`\x1b[90m[Tokens: ${usage.used} / ${usage.max} (${usage.percent}%)]\x1b[0m`)
  }
  console.log('')
  msgProcessing = false

  // Process any queued messages
  while (msgQueue.length > 0) {
    const next = msgQueue.shift()!
    if (next === 'exit' || next === 'quit') {
      sessionManager.destroy()
      rl.close()
      return
    }
    await handleChat(next)
  }
}
