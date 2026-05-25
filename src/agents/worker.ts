import { ALL_TOOLS, Tool } from '../tools/index.js'
import {
  AgentConfig,
  AgentResult,
  AgentStatus,
  AgentMessage,
  AgentToolCall,
  SwarmCallbacks
} from './types.js'

const DEFAULT_BASE_URL = 'https://api.kimi.com/coding'
const DEFAULT_CLAW_ID = '19e51d2c-47a2-8b88-8000-000027bae32f'
const DEFAULT_MODEL = 'kimi-k2.6'

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

interface ToolCall {
  id: string
  name: string
  arguments: string
}

export class AgentWorker {
  readonly id: string
  readonly config: AgentConfig
  private messages: Message[] = []
  private status: AgentStatus = 'idle'
  private abortController: AbortController | null = null
  private callbacks: SwarmCallbacks
  private apiKey: string
  private baseUrl: string
  private clawId: string
  private model: string
  private toolCalls: AgentToolCall[] = []
  private startTime = 0

  constructor(
    config: AgentConfig,
    apiKey: string,
    callbacks: SwarmCallbacks = {},
    baseUrl = DEFAULT_BASE_URL,
    clawId = DEFAULT_CLAW_ID,
    model = DEFAULT_MODEL
  ) {
    this.id = config.id
    this.config = config
    this.apiKey = apiKey
    this.callbacks = callbacks
    this.baseUrl = baseUrl
    this.clawId = clawId
    this.model = model

    this.messages.push({
      role: 'system',
      content:
        config.systemPrompt ||
        'You are an AI coding assistant. You have access to Bash, Read, Write, Edit, Grep, Glob, LS, View, Fetch, WebSearch, and WebFetch tools. Use them when needed. When you need to use a tool, output it in this exact XML format:\n<tool_use>\n<name>ToolName</name>\n<arguments>{"key":"value"}</arguments>\n</tool_use>'
    })
  }

  getStatus(): AgentStatus {
    return this.status
  }

  getMessages(): AgentMessage[] {
    return this.messages.map((m, i) => ({
      id: `${this.id}_msg_${i}`,
      agentId: this.id,
      role: m.role,
      content: m.content,
      timestamp: Date.now(),
      toolCallId: m.tool_call_id,
      toolName: m.name
    }))
  }

  async execute(taskId: string, description: string, context?: string): Promise<AgentResult> {
    if (this.status === 'running') {
      throw new Error(`Agent ${this.id} is already running`)
    }

    this.status = 'running'
    this.startTime = Date.now()
    this.toolCalls = []
    this.abortController = new AbortController()

    const userContent = context ? `${description}\n\nContext:\n${context}` : description
    this.messages.push({ role: 'user', content: userContent })

    this.callbacks.onSpawn?.(this.id, this.config)

    try {
      const output = await this.runToolLoop(taskId)
      this.status = 'completed'
      const result: AgentResult = {
        taskId,
        agentId: this.id,
        status: 'completed',
        output,
        toolCalls: this.toolCalls,
        duration: Date.now() - this.startTime
      }
      this.callbacks.onComplete?.(this.id, result)
      return result
    } catch (err: any) {
      this.status = 'failed'
      const result: AgentResult = {
        taskId,
        agentId: this.id,
        status: 'failed',
        output: '',
        toolCalls: this.toolCalls,
        error: err.message,
        duration: Date.now() - this.startTime
      }
      this.callbacks.onError?.(this.id, err)
      return result
    }
  }

  cancel(reason = 'User cancelled'): void {
    if (this.abortController) {
      this.abortController.abort(reason)
    }
    this.status = 'cancelled'
    this.callbacks.onKill?.(this.id, reason)
  }

  private async runToolLoop(taskId: string): Promise<string> {
    const tools = this.buildToolDefinitions(ALL_TOOLS)
    const toolMap = new Map(ALL_TOOLS.map(t => [t.name, t]))
    const maxIter = this.config.maxIterations || 20

    for (let iter = 0; iter < maxIter; iter++) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Agent execution cancelled')
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': 'Desktop Kimi Claw Plugin',
          'X-Kimi-Claw-ID': this.clawId
        },
        body: JSON.stringify({
          model: this.model,
          messages: this.messages,
          tools,
          stream: true,
          temperature: this.config.temperature ?? 0.7,
          max_tokens: this.config.maxTokens
        }),
        signal: this.abortController?.signal
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`HTTP ${response.status}: ${err}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''

      while (true) {
        if (this.abortController?.signal.aborted) {
          reader.cancel()
          throw new Error('Agent execution cancelled')
        }

        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          try {
            const data = JSON.parse(trimmed.slice(6))
            const delta = data.choices?.[0]?.delta
            const content = delta?.content || delta?.reasoning_content || ''
            if (content) {
              this.callbacks.onProgress?.(this.id, taskId, content)
              fullContent += content
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      const toolCalls = this.parseToolCalls(fullContent)
      const textContent = this.stripToolCalls(fullContent)

      if (toolCalls.length === 0) {
        this.messages.push({ role: 'assistant', content: textContent || fullContent })
        return textContent || fullContent
      }

      this.messages.push({ role: 'assistant', content: fullContent })

      for (const call of toolCalls) {
        const tool = toolMap.get(call.name)
        if (!tool) {
          this.callbacks.onToolStart?.(this.id, taskId, call.name, {})
          const result = `Error: Unknown tool "${call.name}"`
          this.callbacks.onToolEnd?.(this.id, taskId, call.name, result)
          this.recordToolCall(call, {}, result)
          this.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: call.id,
            name: call.name
          })
          continue
        }

        let args: any
        try {
          args = JSON.parse(call.arguments)
        } catch {
          this.callbacks.onToolStart?.(this.id, taskId, call.name, {})
          const result = `Error: Invalid JSON arguments for tool ${call.name}`
          this.callbacks.onToolEnd?.(this.id, taskId, call.name, result)
          this.recordToolCall(call, {}, result)
          this.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: call.id,
            name: call.name
          })
          continue
        }

        this.callbacks.onToolStart?.(this.id, taskId, call.name, args)
        const result = await tool.execute(args)
        this.callbacks.onToolEnd?.(this.id, taskId, call.name, result)
        this.recordToolCall(call, args, result)

        this.messages.push({
          role: 'tool',
          content: result,
          tool_call_id: call.id,
          name: call.name
        })
      }
    }

    throw new Error('Max iterations reached')
  }

  private buildToolDefinitions(tools: Tool[]) {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: this.zodToJsonSchema(t.parameters)
      }
    }))
  }

  private zodToJsonSchema(schema: any): any {
    const def = schema._def
    if (!def) return { type: 'object' }

    switch (def.typeName) {
      case 'ZodObject': {
        const properties: any = {}
        const required: string[] = []
        for (const [key, value] of Object.entries(def.shape())) {
          properties[key] = this.zodToJsonSchema(value)
          if (!(value as any).isOptional?.()) {
            required.push(key)
          }
        }
        return { type: 'object', properties, required }
      }
      case 'ZodString':
        return { type: 'string', description: def.description }
      case 'ZodNumber':
        return { type: 'number', description: def.description }
      case 'ZodBoolean':
        return { type: 'boolean', description: def.description }
      case 'ZodArray': {
        const itemType = def.type
        return { type: 'array', items: this.zodToJsonSchema(itemType), description: def.description }
      }
      case 'ZodOptional': {
        const inner = this.zodToJsonSchema(def.innerType)
        return { ...inner, description: def.description || inner.description }
      }
      default:
        return { type: 'string', description: def.description }
    }
  }

  private parseToolCalls(content: string): ToolCall[] {
    const calls: ToolCall[] = []
    const regex = /<tool_use>([\s\S]*?)<\/tool_use>/g
    let match
    while ((match = regex.exec(content)) !== null) {
      const inner = match[1]
      const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/)
      const argMatch = inner.match(/<arguments>([\s\S]*?)<\/arguments>/)
      if (nameMatch && argMatch) {
        calls.push({
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          name: nameMatch[1].trim(),
          arguments: argMatch[1].trim()
        })
      }
    }
    return calls
  }

  private stripToolCalls(content: string): string {
    return content.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '').trim()
  }

  private recordToolCall(call: ToolCall, args: any, result: string): void {
    this.toolCalls.push({
      id: call.id,
      name: call.name,
      arguments: args,
      result,
      timestamp: Date.now()
    })
  }
}
