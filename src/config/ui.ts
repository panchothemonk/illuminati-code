import { createInterface } from 'readline'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR = join(homedir(), '.illuminati-code')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const MCP_CONFIG_PATH = join(CONFIG_DIR, 'mcp.json')

interface AppConfig {
  apiKey?: string
  model?: string
  permissionMode?: string
  autoSaveIntervalMs?: number
  maxContextTokens?: number
  verbose?: boolean
  debug?: boolean
}

function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as AppConfig
  } catch {
    return {}
  }
}

function saveConfig(cfg: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8')
}

function loadMcpConfig(): { servers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }> } {
  if (!existsSync(MCP_CONFIG_PATH)) return { servers: [] }
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'))
  } catch {
    return { servers: [] }
  }
}

function saveMcpConfig(cfg: { servers: any[] }): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8')
}

function question(rl: any, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => resolve(answer.trim()))
    rl.on('SIGINT', () => resolve(''))
    rl.on('close', () => resolve(''))
  })
}

export async function runConfigUI(existingRl?: any): Promise<void> {
  // Pause the main readline to prevent input conflicts
  if (existingRl?.pause) {
    existingRl.pause()
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  })

  try {
    let running = true
    while (running) {
      console.log('')
      console.log('\x1b[36m═══════════════════════════════════════\x1b[0m')
      console.log('\x1b[36m  Illuminati Code Config Editor        \x1b[0m')
      console.log('\x1b[36m═══════════════════════════════════════\x1b[0m')
      console.log('  1. Edit API Key')
      console.log('  2. Edit Model')
      console.log('  3. Edit Permission Mode')
      console.log('  4. Edit Auto-Save Interval (ms)')
      console.log('  5. Edit Max Context Tokens')
      console.log('  6. Manage MCP Servers')
      console.log('  7. View Current Config')
      console.log('  8. Save & Exit')
      console.log('  9. Exit Without Saving')
      console.log('\x1b[36m═══════════════════════════════════════\x1b[0m')

      const choice = await question(rl, '\x1b[32mSelect option: \x1b[0m')

      const cfg = loadConfig()

      switch (choice) {
        case '1': {
          const current = cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}...` : '(not set)'
          console.log(`Current API Key: ${current}`)
          const key = await question(rl, 'Enter new API key (or press Enter to keep): ')
          if (key) {
            cfg.apiKey = key
            saveConfig(cfg)
            console.log('\x1b[32mAPI key updated.\x1b[0m')
          }
          break
        }
        case '2': {
          console.log(`Current model: ${cfg.model || 'kimi-k2.6'}`)
          const model = await question(rl, 'Enter new model (or press Enter to keep): ')
          if (model) {
            cfg.model = model
            saveConfig(cfg)
            console.log('\x1b[32mModel updated.\x1b[0m')
          }
          break
        }
        case '3': {
          console.log(`Current permission mode: ${cfg.permissionMode || 'ask'}`)
          console.log('Available: auto, ask, deny')
          const mode = await question(rl, 'Enter new mode (or press Enter to keep): ')
          if (mode && ['auto', 'ask', 'deny'].includes(mode)) {
            cfg.permissionMode = mode
            saveConfig(cfg)
            console.log('\x1b[32mPermission mode updated.\x1b[0m')
          } else if (mode) {
            console.log('\x1b[31mInvalid mode.\x1b[0m')
          }
          break
        }
        case '4': {
          console.log(`Current auto-save interval: ${cfg.autoSaveIntervalMs || 30000}ms`)
          const interval = await question(rl, 'Enter new interval in ms (or press Enter to keep): ')
          const n = parseInt(interval, 10)
          if (!isNaN(n) && n > 0) {
            cfg.autoSaveIntervalMs = n
            saveConfig(cfg)
            console.log('\x1b[32mAuto-save interval updated.\x1b[0m')
          }
          break
        }
        case '5': {
          console.log(`Current max context tokens: ${cfg.maxContextTokens || 128000}`)
          const tokens = await question(rl, 'Enter new max tokens (or press Enter to keep): ')
          const n = parseInt(tokens, 10)
          if (!isNaN(n) && n > 0) {
            cfg.maxContextTokens = n
            saveConfig(cfg)
            console.log('\x1b[32mMax context tokens updated.\x1b[0m')
          }
          break
        }
        case '6': {
          await manageMCPServers(rl)
          break
        }
        case '7': {
          console.log('\x1b[36mCurrent Config:\x1b[0m')
          console.log(JSON.stringify(loadConfig(), null, 2))
          break
        }
        case '8': {
          saveConfig(cfg)
          console.log('\x1b[32mConfig saved.\x1b[0m')
          running = false
          break
        }
        case '9': {
          running = false
          break
        }
        default: {
          console.log('\x1b[31mInvalid option.\x1b[0m')
        }
      }
    }
  } finally {
    // Don't close stdin - just remove our listener
    rl.removeAllListeners()
    if (existingRl?.resume) {
      existingRl.resume()
    }
  }
}

async function manageMCPServers(rl: any): Promise<void> {
  let running = true
  while (running) {
    const mcp = loadMcpConfig()
    console.log('')
    console.log('\x1b[36mMCP Server Management\x1b[0m')
    console.log('  1. List Servers')
    console.log('  2. Add Server')
    console.log('  3. Remove Server')
    console.log('  4. Back')

    const choice = await question(rl, '\x1b[32mSelect option: \x1b[0m')

    switch (choice) {
      case '1': {
        if (mcp.servers.length === 0) {
          console.log('No MCP servers configured.')
        } else {
          console.log('\x1b[36mConfigured MCP Servers:\x1b[0m')
          for (const s of mcp.servers) {
            console.log(`  ${s.name}: ${s.command} ${s.args?.join(' ') || ''}`)
          }
        }
        break
      }
      case '2': {
        const name = await question(rl, 'Server name: ')
        const command = await question(rl, 'Command: ')
        const argsStr = await question(rl, 'Args (space-separated, optional): ')
        const args = argsStr ? argsStr.split(/\s+/) : []
        mcp.servers.push({ name, command, args })
        saveMcpConfig(mcp)
        console.log('\x1b[32mServer added.\x1b[0m')
        break
      }
      case '3': {
        const name = await question(rl, 'Server name to remove: ')
        const idx = mcp.servers.findIndex(s => s.name === name)
        if (idx !== -1) {
          mcp.servers.splice(idx, 1)
          saveMcpConfig(mcp)
          console.log('\x1b[32mServer removed.\x1b[0m')
        } else {
          console.log('\x1b[31mServer not found.\x1b[0m')
        }
        break
      }
      case '4': {
        running = false
        break
      }
      default: {
        console.log('\x1b[31mInvalid option.\x1b[0m')
      }
    }
  }
}
