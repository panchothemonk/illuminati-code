import { Message } from '../utils/tokenCounter.js'

export interface CompactOptions {
  preserveLastN?: number
  maxSummaryLength?: number
}

export function formatCompactSummary(summary: string): string {
  return `[Context Summary]\n${summary}\n[End Summary]`
}

export function compactMessages(
  messages: Message[],
  options: CompactOptions = {}
): Message[] {
  const preserveLastN = options.preserveLastN ?? 6
  const maxSummaryLength = options.maxSummaryLength ?? 4000

  if (messages.length <= preserveLastN + 1) {
    return [...messages]
  }

  const systemMsg = messages.find(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')

  if (nonSystem.length <= preserveLastN) {
    return systemMsg ? [systemMsg, ...nonSystem] : [...nonSystem]
  }

  const preserved = nonSystem.slice(-preserveLastN)
  const toSummarize = nonSystem.slice(0, nonSystem.length - preserveLastN)

  const summary = generateSummary(toSummarize, maxSummaryLength)
  const summaryMsg: Message = {
    role: 'system',
    content: formatCompactSummary(summary)
  }

  const result: Message[] = []
  if (systemMsg) result.push(systemMsg)
  result.push(summaryMsg)
  result.push(...preserved)

  return result
}

function generateSummary(messages: Message[], maxLength: number): string {
  const parts: string[] = []
  let currentLength = 0

  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role === 'tool' ? `Tool(${msg.name || 'unknown'})` : 'System'
    const text = `[${prefix}]: ${msg.content.slice(0, 500)}`
    if (currentLength + text.length > maxLength) {
      const remaining = maxLength - currentLength
      if (remaining > 50) {
        parts.push(text.slice(0, remaining - 3) + '...')
      }
      break
    }
    parts.push(text)
    currentLength += text.length + 1
  }

  if (parts.length === 0 && messages.length > 0) {
    const first = messages[0]
    const prefix = first.role === 'user' ? 'User' : first.role === 'assistant' ? 'Assistant' : 'System'
    return `[${prefix}]: ${first.content.slice(0, maxLength - 20)}...`
  }

  return parts.join('\n')
}
