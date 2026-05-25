import { z, ZodSchema } from 'zod'
import { Tool, ALL_TOOLS, setTools, ALL_BUILTIN_TOOLS } from '../tools/index.js'
import { discoverMCPTools, ensureDefaultConfig } from '../mcp/index.js'
import { checkPermission, createDefaultPermissionConfig, loadPermissionConfigFromEnv } from '../utils/permissions.js'

const KIMI_BASE_URL = 'https://api.kimi.com/coding'
const KIMI_CLAW_ID = '19e51d2c-47a2-8b88-8000-000027bae32f'
const DEFAULT_MODEL = 'kimi-k2.6'

let mcpInitialized = false

const permissionConfig = { ...createDefaultPermissionConfig(), ...loadPermissionConfigFromEnv() }

async function initMCPTools(): Promise<void> {
  if (mcpInitialized) return
  try {
    await ensureDefaultConfig()
    const mcpTools = await discoverMCPTools()
    if (mcpTools.length > 0) {
      setTools([...ALL_BUILTIN_TOOLS, ...mcpTools])
    }
    mcpInitialized = true
  } catch (err: any) {
    console.error(`MCP discovery failed: ${err.message}`)
  }
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

function zodToJsonSchema(schema: ZodSchema): any {
  const def = (schema as any)._def
  if (!def) return { type: 'object' }

  switch (def.typeName) {
    case 'ZodObject': {
      const properties: any = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(def.shape())) {
        properties[key] = zodToJsonSchema(value as ZodSchema)
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
      return { type: 'array', items: zodToJsonSchema(itemType), description: def.description }
    }
    case 'ZodOptional': {
      const inner = zodToJsonSchema(def.innerType)
      return { ...inner, description: def.description || inner.description }
    }
    default:
      return { type: 'string', description: def.description }
  }
}

function buildToolDefinitions(tools: Tool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters)
    }
  }))
}

function parseXmlToolCalls(content: string): ToolCall[] {
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
        type: 'function',
        function: {
          name: nameMatch[1].trim(),
          arguments: argMatch[1].trim()
        }
      })
    }
  }
  return calls
}

function stripXmlToolCalls(content: string): string {
  return content.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '').trim()
}

export async function runToolLoop({
  apiKey,
  model,
  messages,
  verbose,
  debug,
  readline,
  onTextDelta,
  onReasoningDelta,
  onToolStart,
  onToolEnd,
  onApiRequest,
  onApiResponseChunk
}: {
  apiKey: string
  model?: string
  messages: Message[]
  verbose?: boolean
  debug?: boolean
  readline?: any
  onTextDelta: (text: string) => void
  onReasoningDelta?: (text: string) => void
  onToolStart: (name: string, args: any) => void
  onToolEnd: (name: string, result: string) => void
  onApiRequest?: (body: any) => void
  onApiResponseChunk?: (chunk: any) => void
}): Promise<string> {
  await initMCPTools()

  const tools = buildToolDefinitions(ALL_TOOLS)
  const toolMap = new Map(ALL_TOOLS.map(t => [t.name, t]))

  while (true) {
    const requestBody: any = {
      model: model || DEFAULT_MODEL,
      messages,
      stream: true,
      temperature: 0.7
    }

    if (tools.length > 0) {
      requestBody.tools = tools
    }

    onApiRequest?.(requestBody)

    const response = await fetch(`${KIMI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Desktop Kimi Claw Plugin',
        'X-Kimi-Claw-ID': KIMI_CLAW_ID
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`HTTP ${response.status}: ${err}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let contentText = ''
    let reasoningText = ''
    let collectedToolCalls: ToolCall[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data:')) continue

        let jsonStr = trimmed
        if (jsonStr.startsWith('data: ')) {
          jsonStr = jsonStr.slice(6)
        } else if (jsonStr.startsWith('data:')) {
          jsonStr = jsonStr.slice(5)
        }

        try {
          const data = JSON.parse(jsonStr)
          onApiResponseChunk?.(data)

          const choice = data.choices?.[0]
          if (!choice) continue

          const delta = choice.delta
          if (!delta) continue

          // Stream reasoning content
          if (delta.reasoning_content) {
            onReasoningDelta?.(delta.reasoning_content)
            reasoningText += delta.reasoning_content
          }

          // Stream regular content
          if (delta.content) {
            onTextDelta(delta.content)
            contentText += delta.content
          }

          // Accumulate native tool calls (arguments stream progressively)
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!collectedToolCalls[idx]) {
                collectedToolCalls[idx] = {
                  id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
                  type: 'function',
                  function: { name: '', arguments: '' }
                }
              }
              if (tc.id) collectedToolCalls[idx].id = tc.id
              if (tc.function?.name) {
                collectedToolCalls[idx].function.name = tc.function.name
              }
              if (tc.function?.arguments) {
                collectedToolCalls[idx].function.arguments += tc.function.arguments
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    // Also check for XML tool_use tags in content (fallback for models that emit XML)
    const xmlToolCalls = parseXmlToolCalls(contentText)
    if (xmlToolCalls.length > 0) {
      for (const tc of xmlToolCalls) {
        collectedToolCalls.push(tc)
      }
      contentText = stripXmlToolCalls(contentText)
    }

    // If no tool calls, return the content
    if (collectedToolCalls.length === 0) {
      const finalContent = contentText || reasoningText
      messages.push({ role: 'assistant', content: finalContent })
      return finalContent
    }

    // Build assistant message with tool calls for history (OpenAI format)
    // Kimi requires reasoning_content on assistant messages when tool_calls are present
    const assistantMessage: any = {
      role: 'assistant',
      content: contentText || '',
      tool_calls: collectedToolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }))
    }
    if (reasoningText) {
      assistantMessage.reasoning_content = reasoningText
    }
    messages.push(assistantMessage)

    // Execute each tool call
    for (const call of collectedToolCalls) {
      const toolName = call.function.name
      const tool = toolMap.get(toolName)

      if (!tool) {
        onToolStart(toolName, {})
        const result = `Error: Unknown tool "${toolName}"`
        onToolEnd(toolName, result)
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: call.id,
          name: toolName
        })
        continue
      }

      let args: any
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        onToolStart(toolName, {})
        const result = `Error: Invalid JSON arguments for tool ${toolName}: ${call.function.arguments}`
        onToolEnd(toolName, result)
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: call.id,
          name: toolName
        })
        continue
      }

      onToolStart(toolName, args)

      const permResult = await checkPermission({
        toolName: toolName,
        args,
        config: permissionConfig,
        readline
      })

      if (!permResult.allowed) {
        const result = `Permission denied: ${permResult.reason}`
        onToolEnd(toolName, result)
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: call.id,
          name: toolName
        })
        continue
      }

      const result = await tool.execute(args)
      onToolEnd(toolName, result)

      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: call.id,
        name: toolName
      })
    }

    // Loop back to send tool results to the model
  }
}
