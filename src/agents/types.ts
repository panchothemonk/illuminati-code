export type AgentRole = 'worker' | 'coordinator' | 'decomposer'

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentConfig {
  id: string
  role: AgentRole
  name?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
  maxIterations?: number
}

export interface AgentTask {
  id: string
  parentId?: string
  description: string
  context?: string
  priority: number
  status: AgentStatus
  assignedTo?: string
  result?: AgentResult
  createdAt: number
  startedAt?: number
  completedAt?: number
  dependencies?: string[]
}

export interface AgentResult {
  taskId: string
  agentId: string
  status: AgentStatus
  output: string
  toolCalls: AgentToolCall[]
  error?: string
  duration: number
}

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  result: string
  timestamp: number
}

export interface AgentMessage {
  id: string
  agentId: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCallId?: string
  toolName?: string
}

export interface SwarmConfig {
  maxConcurrentAgents: number
  defaultTimeout: number
  defaultMaxIterations: number
  apiKey: string
  baseUrl?: string
  clawId?: string
  model?: string
  onEvent?: (event: SwarmEvent) => void
}

export type SwarmEventType =
  | 'agent_spawn'
  | 'agent_start'
  | 'agent_progress'
  | 'agent_complete'
  | 'agent_error'
  | 'agent_kill'
  | 'task_create'
  | 'task_assign'
  | 'task_complete'
  | 'task_fail'
  | 'task_cancel'
  | 'swarm_start'
  | 'swarm_complete'
  | 'swarm_error'

export interface SwarmEvent {
  type: SwarmEventType
  timestamp: number
  agentId?: string
  taskId?: string
  data?: any
  error?: string
}

export interface DecompositionPlan {
  originalTask: string
  subtasks: AgentTask[]
  estimatedComplexity: number
}

export interface SwarmCallbacks {
  onSpawn?: (agentId: string, config: AgentConfig) => void
  onComplete?: (agentId: string, result: AgentResult) => void
  onError?: (agentId: string, error: Error) => void
  onKill?: (agentId: string, reason: string) => void
  onProgress?: (agentId: string, taskId: string, delta: string) => void
  onToolStart?: (agentId: string, taskId: string, name: string, args: any) => void
  onToolEnd?: (agentId: string, taskId: string, name: string, result: string) => void
}
