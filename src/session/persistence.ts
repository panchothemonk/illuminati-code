import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const SESSIONS_DIR = join(homedir(), '.illuminati-code', 'sessions')

function ensureSessionsDir(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true })
}

function getSessionPath(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(SESSIONS_DIR, `${safeName}.json`)
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

export interface SessionData {
  name: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export function saveSession(name: string, messages: Message[]): void {
  ensureSessionsDir()
  const path = getSessionPath(name)
  const now = Date.now()
  let createdAt = now
  try {
    const existing = readFileSync(path, 'utf-8')
    const data: SessionData = JSON.parse(existing)
    createdAt = data.createdAt || now
  } catch {
    // new session
  }
  const session: SessionData = { name, messages, createdAt, updatedAt: now }
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
}

export function loadSession(name: string): Message[] | null {
  const path = getSessionPath(name)
  if (!existsSync(path)) return null
  try {
    const data = readFileSync(path, 'utf-8')
    const session: SessionData = JSON.parse(data)
    return session.messages || []
  } catch {
    return null
  }
}

export function deleteSession(name: string): boolean {
  const path = getSessionPath(name)
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

export function listSessions(): string[] {
  ensureSessionsDir()
  return readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
}

export function getSessionInfo(name: string): SessionData | null {
  const path = getSessionPath(name)
  if (!existsSync(path)) return null
  try {
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data)
  } catch {
    return null
  }
}
