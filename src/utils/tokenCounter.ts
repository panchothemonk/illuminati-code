export const MAX_CONTEXT_TOKENS = 128000
export const WARNING_THRESHOLD = 0.8
export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.content)
    if (msg.name) total += estimateTokens(msg.name)
    if (msg.tool_call_id) total += estimateTokens(msg.tool_call_id)
    total += 4
  }
  return total
}

export function shouldCompact(messages: Message[]): boolean {
  const tokens = estimateMessagesTokens(messages)
  return tokens > MAX_CONTEXT_TOKENS * WARNING_THRESHOLD
}

export function getTokenUsage(messages: Message[]): { used: number; max: number; percent: number; shouldCompact: boolean } {
  const used = estimateMessagesTokens(messages)
  const max = MAX_CONTEXT_TOKENS
  const percent = used / max
  return { used, max, percent: Math.round(percent * 1000) / 10, shouldCompact: percent > WARNING_THRESHOLD }
}
