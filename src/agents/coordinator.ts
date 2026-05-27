import { AgentWorker } from './worker.js'
import {
  AgentConfig,
  AgentTask,
  AgentResult,
  AgentStatus,
  SwarmConfig,
  SwarmEvent,
  SwarmEventType,
  DecompositionPlan,
  SwarmCallbacks
} from './types.js'

const DEFAULT_BASE_URL = 'https://api.kimi.com/coding'
const DEFAULT_CLAW_ID = '19e51d2c-47a2-8b88-8000-000027bae32f'
const DEFAULT_MODEL = 'kimi-k2.6'

export class AgentCoordinator {
  private config: SwarmConfig
  private workers = new Map<string, AgentWorker>()
  private taskQueue: AgentTask[] = []
  private activeTasks = new Map<string, AgentTask>()
  private completedTasks = new Map<string, AgentResult>()
  private callbacks: SwarmCallbacks = {}
  private eventLog: SwarmEvent[] = []
  private nextId = 0
  private running = false

  constructor(config: SwarmConfig) {
    this.config = {
      maxConcurrentAgents: 5,
      defaultTimeout: 120000,
      defaultMaxIterations: 20,
      baseUrl: DEFAULT_BASE_URL,
      clawId: DEFAULT_CLAW_ID,
      model: DEFAULT_MODEL,
      ...config
    }
  }

  setCallbacks(callbacks: SwarmCallbacks): void {
    this.callbacks = callbacks
  }

  private emit(type: SwarmEventType, data?: any, agentId?: string, taskId?: string, error?: string): void {
    const event: SwarmEvent = {
      type,
      timestamp: Date.now(),
      agentId,
      taskId,
      data,
      error
    }
    this.eventLog.push(event)
    this.config.onEvent?.(event)
  }

  async decomposeTask(description: string, context?: string): Promise<DecompositionPlan> {
    this.emit('swarm_start', { description, context })

    const decomposer = new AgentWorker(
      {
        id: 'decomposer',
        role: 'decomposer',
        systemPrompt:
          'You are a task decomposition specialist. Given a complex coding task, break it down into 2-5 smaller, independent subtasks. Each subtask should be clear, actionable, and include any relevant file paths or context. Respond ONLY with a JSON array in this format:\n[\n  {\n    "description": "string",\n    "context": "string (optional)",\n    "priority": number (1-10, lower is higher priority),\n    "dependencies": ["task_id"] (optional)\n  }\n]',
        temperature: 0.3,
        maxIterations: 5
      },
      this.config.apiKey,
      {},
      this.config.baseUrl,
      this.config.clawId,
      this.config.model
    )

    const prompt = context
      ? `Task: ${description}\n\nContext:\n${context}\n\nBreak this into subtasks.`
      : `Task: ${description}\n\nBreak this into subtasks.`

    const result = await decomposer.execute('decompose', prompt)

    // Clean up decomposer worker
    try { decomposer.cancel('Decomposition complete') } catch {}

    let subtasks: Array<{
      description: string
      context?: string
      priority?: number
      dependencies?: string[]
    }> = []

    try {
      const jsonMatch = result.output.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        subtasks = JSON.parse(jsonMatch[0])
      }
    } catch {
      // Fallback: create a single subtask with the original description
      subtasks = [{ description, priority: 5 }]
    }

    const agentTasks: AgentTask[] = subtasks.map((st, i) => ({
      id: `task_${this.nextId++}`,
      description: st.description,
      context: st.context || context,
      priority: st.priority ?? 5,
      status: 'idle',
      dependencies: st.dependencies,
      createdAt: Date.now()
    }))

    this.emit('task_create', { count: agentTasks.length })

    return {
      originalTask: description,
      subtasks: agentTasks,
      estimatedComplexity: agentTasks.length
    }
  }

  async runTask(description: string, context?: string): Promise<AgentResult> {
    const plan = await this.decomposeTask(description, context)

    if (plan.subtasks.length === 1) {
      return this.executeSingle(plan.subtasks[0])
    }

    return this.executeSwarm(plan.subtasks)
  }

  private async executeSingle(task: AgentTask): Promise<AgentResult> {
    const worker = this.spawnWorker(`agent_${this.nextId++}`, 'worker')
    this.emit('task_assign', { task }, worker.id, task.id)

    task.status = 'running'
    task.assignedTo = worker.id
    task.startedAt = Date.now()
    this.activeTasks.set(task.id, task)

    try {
      const result = await worker.execute(task.id, task.description, task.context)

      task.status = result.status
      task.completedAt = Date.now()
      task.result = result
      this.activeTasks.delete(task.id)
      this.completedTasks.set(task.id, result)

      this.emit(
        result.status === 'completed' ? 'task_complete' : 'task_fail',
        result,
        worker.id,
        task.id,
        result.error
      )

      return result
    } catch (err: any) {
      task.status = 'failed'
      task.completedAt = Date.now()
      const result: AgentResult = {
        taskId: task.id,
        agentId: worker.id,
        status: 'failed',
        output: '',
        toolCalls: [],
        error: err.message,
        duration: 0
      }
      task.result = result
      this.activeTasks.delete(task.id)
      this.completedTasks.set(task.id, result)
      this.emit('task_fail', result, worker.id, task.id, err.message)
      return result
    } finally {
      this.workers.delete(worker.id)
      this.emit('agent_kill', { reason: 'Task complete' }, worker.id)
    }
  }

  private async executeSwarm(tasks: AgentTask[]): Promise<AgentResult> {
    this.running = true
    this.taskQueue = [...tasks].sort((a, b) => a.priority - b.priority)

    const promises: Promise<void>[] = []
    const maxConcurrent = Math.min(this.config.maxConcurrentAgents, tasks.length)

    for (let i = 0; i < maxConcurrent; i++) {
      promises.push(this.workerLoop())
    }

    await Promise.all(promises)
    this.running = false

    this.emit('swarm_complete', { completed: this.completedTasks.size })

    const outputs: string[] = []
    for (const task of tasks) {
      const result = this.completedTasks.get(task.id)
      if (result) {
        outputs.push(`## ${task.description}\n\n${result.output}`)
      } else {
        outputs.push(`## ${task.description}\n\n[No result]`)
      }
    }

    const aggregated: AgentResult = {
      taskId: 'swarm_aggregate',
      agentId: 'coordinator',
      status: 'completed',
      output: outputs.join('\n\n---\n\n'),
      toolCalls: Array.from(this.completedTasks.values()).flatMap(r => r.toolCalls),
      duration: Array.from(this.completedTasks.values()).reduce((sum, r) => sum + r.duration, 0)
    }

    return aggregated
  }

  private async workerLoop(): Promise<void> {
    while (this.running) {
      const task = this.getNextTask()
      if (!task) {
        await new Promise(r => setTimeout(r, 100))
        if (this.taskQueue.length === 0 && this.activeTasks.size === 0) break
        continue
      }

      const worker = this.spawnWorker(`agent_${this.nextId++}`, 'worker')
      this.emit('task_assign', { task }, worker.id, task.id)

      task.status = 'running'
      task.assignedTo = worker.id
      task.startedAt = Date.now()
      this.activeTasks.set(task.id, task)

      try {
        const timeout = this.config.defaultTimeout
        const result = await this.withTimeout(
          worker.execute(task.id, task.description, task.context),
          timeout
        )

        task.status = result.status
        task.completedAt = Date.now()
        task.result = result
        this.completedTasks.set(task.id, result)

        this.emit(
          result.status === 'completed' ? 'task_complete' : 'task_fail',
          result,
          worker.id,
          task.id,
          result.error
        )
      } catch (err: any) {
        task.status = 'failed'
        task.completedAt = Date.now()
        const result: AgentResult = {
          taskId: task.id,
          agentId: worker.id,
          status: 'failed',
          output: '',
          toolCalls: [],
          error: err.message,
          duration: 0
        }
        task.result = result
        this.completedTasks.set(task.id, result)
        this.emit('task_fail', result, worker.id, task.id, err.message)
      }

      this.activeTasks.delete(task.id)
      this.workers.delete(worker.id)
      this.emit('agent_kill', { reason: 'Task complete' }, worker.id)
    }
  }

  private getNextTask(): AgentTask | undefined {
    const idx = this.taskQueue.findIndex(t => {
      if (t.dependencies && t.dependencies.length > 0) {
        return t.dependencies.every(depId => {
          const dep = this.completedTasks.get(depId)
          // Allow task if dependency is completed OR failed (don't get stuck)
          return dep && (dep.status === 'completed' || dep.status === 'failed')
        })
      }
      return true
    })
    if (idx === -1) return undefined
    return this.taskQueue.splice(idx, 1)[0]
  }

  private spawnWorker(id: string, role: 'worker' | 'coordinator'): AgentWorker {
    const config: AgentConfig = {
      id,
      role,
      maxIterations: this.config.defaultMaxIterations
    }

    const worker = new AgentWorker(
      config,
      this.config.apiKey,
      {
        onSpawn: (agentId, cfg) => {
          this.emit('agent_spawn', cfg, agentId)
          this.callbacks.onSpawn?.(agentId, cfg)
        },
        onComplete: (agentId, result) => {
          this.emit('agent_complete', result, agentId, result.taskId)
          this.callbacks.onComplete?.(agentId, result)
        },
        onError: (agentId, error) => {
          this.emit('agent_error', { message: error.message }, agentId, undefined, error.message)
          this.callbacks.onError?.(agentId, error)
        },
        onKill: (agentId, reason) => {
          this.emit('agent_kill', { reason }, agentId)
          this.callbacks.onKill?.(agentId, reason)
        },
        onProgress: (agentId, taskId, delta) => {
          this.emit('agent_progress', { delta }, agentId, taskId)
          this.callbacks.onProgress?.(agentId, taskId, delta)
        },
        onToolStart: (agentId, taskId, name, args) => {
          this.emit('agent_progress', { type: 'tool_start', name, args }, agentId, taskId)
          this.callbacks.onToolStart?.(agentId, taskId, name, args)
        },
        onToolEnd: (agentId, taskId, name, result) => {
          this.emit('agent_progress', { type: 'tool_end', name, result }, agentId, taskId)
          this.callbacks.onToolEnd?.(agentId, taskId, name, result)
        }
      },
      this.config.baseUrl,
      this.config.clawId,
      this.config.model
    )

    this.workers.set(id, worker)
    return worker
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms)
      promise.then(
        val => {
          clearTimeout(timer)
          resolve(val)
        },
        err => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  }

  getWorkers(): AgentWorker[] {
    return Array.from(this.workers.values())
  }

  getActiveTasks(): AgentTask[] {
    return Array.from(this.activeTasks.values())
  }

  getCompletedTasks(): Map<string, AgentResult> {
    return new Map(this.completedTasks)
  }

  getEventLog(): SwarmEvent[] {
    return [...this.eventLog]
  }

  cancelAll(reason = 'Coordinator shutdown'): void {
    this.running = false
    // Cancel all pending tasks first
    for (const task of [...this.taskQueue]) {
      task.status = 'cancelled'
      this.emit('task_cancel', { reason }, undefined, task.id)
    }
    this.taskQueue = []
    // Cancel active workers
    for (const worker of this.workers.values()) {
      worker.cancel(reason)
    }
    for (const task of this.activeTasks.values()) {
      task.status = 'cancelled'
      this.emit('task_cancel', { reason }, task.assignedTo, task.id)
    }
    // Resolve any remaining tasks as cancelled
    for (const task of this.activeTasks.values()) {
      if (!this.completedTasks.has(task.id)) {
        this.completedTasks.set(task.id, {
          taskId: task.id,
          agentId: task.assignedTo || 'cancelled',
          status: 'cancelled',
          output: '',
          toolCalls: [],
          error: reason,
          duration: 0
        })
      }
    }
    this.workers.clear()
    this.activeTasks.clear()
  }
}
