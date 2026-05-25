import { spawn, ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: any
  result?: any
  error?: any
}

interface LspServerConfig {
  command: string
  args: string[]
  languageIds: string[]
  extensions: string[]
  rootMarkers: string[]
}

interface TextDocumentItem {
  uri: string
  languageId: string
  version: number
  text: string
}

interface Position {
  line: number
  character: number
}

interface TextDocumentIdentifier {
  uri: string
}

interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier
  position: Position
}

interface Location {
  uri: string
  range: {
    start: Position
    end: Position
  }
}

interface Diagnostic {
  range: {
    start: Position
    end: Position
  }
  severity?: number
  code?: string | number
  source?: string
  message: string
}

interface WorkspaceEdit {
  changes?: Record<string, any[]>
  documentChanges?: any[]
}

export class LspClient {
  private process: ChildProcess | null = null
  private requestId = 0
  private pendingRequests = new Map<number | string, { resolve: (value: any) => void; reject: (reason: any) => void }>()
  private notificationHandlers = new Map<string, ((params: any) => void)[]>()
  private buffer = ''
  private initialized = false
  private serverConfig: LspServerConfig
  private rootUri: string

  constructor(serverConfig: LspServerConfig, rootUri: string) {
    this.serverConfig = serverConfig
    this.rootUri = rootUri
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.serverConfig.command, this.serverConfig.args, {
        cwd: this.rootUri.replace('file://', ''),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (data: Buffer) => this.handleData(data))
      this.process.stderr?.on('data', (data: Buffer) => {
        // LSP servers often log to stderr; ignore for now
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

  async initialize(): Promise<any> {
    const result = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: { dynamicRegistration: false },
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          documentHighlight: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false },
          codeAction: { dynamicRegistration: false },
          formatting: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          publishDiagnostics: { relatedInformation: true }
        },
        workspace: {
          applyEdit: true,
          workspaceEdit: { documentChanges: true }
        }
      },
      workspaceFolders: [{ uri: this.rootUri, name: 'workspace' }]
    })
    this.initialized = true
    await this.sendNotification('initialized', {})
    return result
  }

  async shutdown(): Promise<void> {
    if (!this.process) return
    try {
      await this.sendRequest('shutdown', {})
      await this.sendNotification('exit', {})
    } catch {}
    this.process.kill()
    this.process = null
    this.initialized = false
  }

  async didOpen(document: TextDocumentItem): Promise<void> {
    await this.sendNotification('textDocument/didOpen', {
      textDocument: document
    })
  }

  async didChange(uri: string, version: number, content: string): Promise<void> {
    await this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text: content }]
    })
  }

  async didClose(uri: string): Promise<void> {
    await this.sendNotification('textDocument/didClose', {
      textDocument: { uri }
    })
  }

  async gotoDefinition(filePath: string, line: number, character: number): Promise<Location[] | Location | null> {
    const params: TextDocumentPositionParams = {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line, character }
    }
    return this.sendRequest('textDocument/definition', params)
  }

  async findReferences(filePath: string, line: number, character: number, includeDeclaration = true): Promise<Location[] | null> {
    const params: TextDocumentPositionParams & { context: { includeDeclaration: boolean } } = {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line, character },
      context: { includeDeclaration }
    }
    return this.sendRequest('textDocument/references', params)
  }

  async hover(filePath: string, line: number, character: number): Promise<any> {
    const params: TextDocumentPositionParams = {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line, character }
    }
    return this.sendRequest('textDocument/hover', params)
  }

  async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
    // Publish diagnostics are sent as notifications; we need to trigger and collect
    const uri = `file://${resolve(filePath)}`
    // Some servers require a didChange to trigger diagnostics
    try {
      const content = readFileSync(resolve(filePath), 'utf-8')
      await this.didChange(filePath, 1, content)
    } catch {}

    // Wait a bit for diagnostics to be published
    return new Promise((resolve) => {
      const diagnostics: Diagnostic[] = []
      const handler = (params: any) => {
        if (params.uri === uri) {
          diagnostics.push(...(params.diagnostics || []))
        }
      }
      this.onNotification('textDocument/publishDiagnostics', handler)
      setTimeout(() => {
        this.offNotification('textDocument/publishDiagnostics', handler)
        resolve(diagnostics)
      }, 500)
    })
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    const params: TextDocumentPositionParams & { newName: string } = {
      textDocument: { uri: `file://${resolve(filePath)}` },
      position: { line, character },
      newName
    }
    return this.sendRequest('textDocument/rename', params)
  }

  onNotification(method: string, handler: (params: any) => void): void {
    const handlers = this.notificationHandlers.get(method) || []
    handlers.push(handler)
    this.notificationHandlers.set(method, handlers)
  }

  offNotification(method: string, handler: (params: any) => void): void {
    const handlers = this.notificationHandlers.get(method) || []
    const idx = handlers.indexOf(handler)
    if (idx !== -1) handlers.splice(idx, 1)
    this.notificationHandlers.set(method, handlers)
  }

  isInitialized(): boolean {
    return this.initialized
  }

  private handleData(data: Buffer): void {
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
    } else if (message.method) {
      const handlers = this.notificationHandlers.get(message.method) || []
      for (const handler of handlers) {
        try {
          handler(message.params)
        } catch {}
      }
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pendingRequests.set(id, { resolve, reject })
      this.sendMessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  private sendNotification(method: string, params: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.sendMessage({ jsonrpc: '2.0', method, params })
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  }

  private sendMessage(message: JsonRpcMessage): void {
    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`
    this.process?.stdin?.write(header + body)
  }
}
