import { spawn, ChildProcess } from 'child_process'

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: any
  result?: any
  error?: { code: number; message: string; data?: any }
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: any
}

export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: any
  serverInfo: { name: string; version?: string }
}

export interface MCPServerConfig {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export class MCPClient {
  private process: ChildProcess | null = null
  private requestId = 0
  private pendingRequests = new Map<number | string, { resolve: (value: any) => void; reject: (reason: any) => void }>()
  private buffer = ''
  private initialized = false
  private serverConfig: MCPServerConfig
  private initResult: MCPInitializeResult | null = null
  private httpHeaders: Record<string, string> = {}

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig
  }

  getName(): string {
    return this.serverConfig.name
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getInitResult(): MCPInitializeResult | null {
    return this.initResult
  }

  async connect(): Promise<void> {
    if (this.serverConfig.transport === 'stdio') {
      await this.connectStdio()
    } else if (this.serverConfig.transport === 'http') {
      await this.connectHttp()
    }
  }

  private async connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = this.serverConfig.command!
      const args = this.serverConfig.args || []
      const env = { ...process.env, ...this.serverConfig.env }

      this.process = spawn(cmd, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (data: Buffer) => this.handleStdioData(data))
      this.process.stderr?.on('data', (data: Buffer) => {
        // MCP servers may log to stderr; ignore for now
      })

      this.process.on('error', reject)
      this.process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          this.pendingRequests.forEach((req) => req.reject(new Error(`Server exited with code ${code}`)))
        }
      })

      // Give the server a moment to start
      setTimeout(resolve, 100)
    })
  }

  private async connectHttp(): Promise<void> {
    // HTTP connections are stateless per-request; nothing to set up here
    // But we verify the endpoint is reachable during initialize
  }

  async initialize(): Promise<MCPInitializeResult> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: 'illuminati-code',
        version: '0.1.0'
      }
    })

    this.initResult = result as MCPInitializeResult
    this.initialized = true

    // Send initialized notification
    await this.sendNotification('notifications/initialized', {})

    return this.initResult
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list', {})
    return (result?.tools || []) as MCPTool[]
  }

  async callTool(name: string, args: any): Promise<any> {
    return this.sendRequest('tools/call', {
      name,
      arguments: args
    })
  }

  async disconnect(): Promise<void> {
    if (this.serverConfig.transport === 'stdio') {
      if (!this.process) return
      try {
        await this.sendNotification('notifications/cancelled', { requestId: this.requestId, reason: 'client disconnect' })
      } catch {}
      this.process.kill()
      this.process = null
    }
    this.initialized = false
    this.initResult = null
    this.pendingRequests.clear()
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    if (this.serverConfig.transport === 'http') {
      return this.sendHttpRequest(method, params)
    }
    return this.sendStdioRequest(method, params)
  }

  private async sendNotification(method: string, params: any): Promise<void> {
    if (this.serverConfig.transport === 'http') {
      await this.sendHttpRequest(method, params)
      return
    }
    this.sendStdioMessage({ jsonrpc: '2.0', method, params })
  }

  private sendStdioRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve, reject })
      this.sendStdioMessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  private sendStdioMessage(message: JsonRpcMessage): void {
    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`
    this.process?.stdin?.write(header + body)
  }

  private handleStdioData(data: Buffer): void {
    this.buffer += data.toString('utf-8')
    while (true) {
      const headerMatch = this.buffer.match(/Content-Length:\s*(\d+)\s*\r\n\r\n/)
      if (!headerMatch) break
      const contentLength = parseInt(headerMatch[1], 10)
      const headerEnd = this.buffer.indexOf('\r\n\r\n') + 4
      const messageEnd = headerEnd + contentLength
      if (this.buffer.length < messageEnd) break

      const messageStr = this.buffer.slice(headerEnd, messageEnd)
      this.buffer = this.buffer.slice(messageEnd)

      try {
        const message: JsonRpcMessage = JSON.parse(messageStr)
        this.handleMessage(message)
      } catch {
        // ignore parse errors
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.result !== undefined) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        pending.resolve(message.result)
        this.pendingRequests.delete(message.id)
      }
    } else if (message.id !== undefined && message.error !== undefined) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)))
        this.pendingRequests.delete(message.id)
      }
    }
  }

  private async sendHttpRequest(method: string, params: any): Promise<any> {
    const url = this.serverConfig.url!
    const id = ++this.requestId

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...this.httpHeaders
      },
      body
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    const message: JsonRpcMessage = await response.json()

    if (message.error) {
      throw new Error(message.error.message || JSON.stringify(message.error))
    }

    return message.result
  }
}
