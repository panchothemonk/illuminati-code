import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { MCPClient, MCPServerConfig } from './client.js'

const MCP_CONFIG_DIR = join(homedir(), '.illuminati-code')
const MCP_CONFIG_PATH = join(MCP_CONFIG_DIR, 'mcp.json')

interface MCPConfigFile {
  servers: MCPServerConfig[]
}

function loadConfig(): MCPConfigFile {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return { servers: [] }
  }
  try {
    const content = readFileSync(MCP_CONFIG_PATH, 'utf-8')
    return JSON.parse(content) as MCPConfigFile
  } catch {
    return { servers: [] }
  }
}

function saveConfig(config: MCPConfigFile): void {
  mkdirSync(MCP_CONFIG_DIR, { recursive: true })
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

const activeClients = new Map<string, MCPClient>()

export function addServer(config: MCPServerConfig): void {
  const cfg = loadConfig()
  const existingIndex = cfg.servers.findIndex(s => s.name === config.name)
  if (existingIndex !== -1) {
    cfg.servers[existingIndex] = config
  } else {
    cfg.servers.push(config)
  }
  saveConfig(cfg)
}

export function removeServer(name: string): boolean {
  const cfg = loadConfig()
  const index = cfg.servers.findIndex(s => s.name === name)
  if (index === -1) return false
  cfg.servers.splice(index, 1)
  saveConfig(cfg)

  // Disconnect if active
  const client = activeClients.get(name)
  if (client) {
    client.disconnect().catch(() => {})
    activeClients.delete(name)
  }
  return true
}

export function listServers(): MCPServerConfig[] {
  return loadConfig().servers
}

export function getServerConfig(name: string): MCPServerConfig | undefined {
  return loadConfig().servers.find(s => s.name === name)
}

export async function connectServer(name: string): Promise<MCPClient> {
  const existing = activeClients.get(name)
  if (existing && existing.isInitialized()) {
    return existing
  }

  const config = getServerConfig(name)
  if (!config) {
    throw new Error(`MCP server "${name}" not found in config`)
  }

  const client = new MCPClient(config)
  await client.connect()
  await client.initialize()
  activeClients.set(name, client)
  return client
}

export async function disconnectServer(name: string): Promise<void> {
  const client = activeClients.get(name)
  if (client) {
    await client.disconnect()
    activeClients.delete(name)
  }
}

export async function disconnectAllServers(): Promise<void> {
  for (const [name, client] of activeClients) {
    try {
      await client.disconnect()
    } catch {}
  }
  activeClients.clear()
}

export function getActiveClient(name: string): MCPClient | undefined {
  return activeClients.get(name)
}

export function getAllActiveClients(): MCPClient[] {
  return Array.from(activeClients.values())
}

export async function ensureDefaultConfig(): Promise<void> {
  if (existsSync(MCP_CONFIG_PATH)) return
  mkdirSync(MCP_CONFIG_DIR, { recursive: true })
  const defaultConfig: MCPConfigFile = {
    servers: []
  }
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8')
}
