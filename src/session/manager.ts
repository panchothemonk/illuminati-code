import { saveSession, loadSession, deleteSession, listSessions, Message } from './persistence.js'

export interface SessionManagerOptions {
  autoSaveIntervalMs?: number
  defaultSessionName?: string
}

export class SessionManager {
  private currentSession: string
  private messages: Message[]
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null
  private options: Required<SessionManagerOptions>

  constructor(options: SessionManagerOptions = {}) {
    this.options = {
      autoSaveIntervalMs: options.autoSaveIntervalMs ?? 30000,
      defaultSessionName: options.defaultSessionName ?? 'default'
    }
    this.currentSession = this.options.defaultSessionName
    this.messages = loadSession(this.currentSession) || []
    this.startAutoSave()
  }

  getMessages(): Message[] {
    return this.messages
  }

  setMessages(messages: Message[]): void {
    this.messages = messages
  }

  appendMessage(message: Message): void {
    this.messages.push(message)
  }

  getCurrentSession(): string {
    return this.currentSession
  }

  switchSession(name: string): Message[] {
    saveSession(this.currentSession, this.messages)
    this.currentSession = name
    this.messages = loadSession(name) || []
    return this.messages
  }

  saveCurrent(): void {
    saveSession(this.currentSession, this.messages)
  }

  startAutoSave(): void {
    this.stopAutoSave()
    this.autoSaveTimer = setInterval(() => {
      this.saveCurrent()
    }, this.options.autoSaveIntervalMs)
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
  }

  listSessions(): string[] {
    return listSessions()
  }

  deleteSession(name: string): boolean {
    if (name === this.currentSession) {
      this.messages = []
    }
    return deleteSession(name)
  }

  exportSession(name: string): string | null {
    const msgs = loadSession(name)
    if (!msgs) return null
    return JSON.stringify({ name, messages: msgs, exportedAt: Date.now() }, null, 2)
  }

  importSession(name: string, json: string): boolean {
    try {
      const data = JSON.parse(json)
      if (!Array.isArray(data.messages)) return false
      saveSession(name, data.messages)
      if (name === this.currentSession) {
        this.messages = data.messages
      }
      return true
    } catch {
      return false
    }
  }

  reset(): void {
    this.messages = []
    this.saveCurrent()
  }

  destroy(): void {
    this.stopAutoSave()
    this.saveCurrent()
  }
}
