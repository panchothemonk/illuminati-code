import { z, ZodSchema, ZodTypeAny } from 'zod'
import { Tool } from '../tools/index.js'
import { MCPClient, MCPTool } from './client.js'
import { connectServer, getAllActiveClients, listServers } from './servers.js'

function jsonSchemaToZod(schema: any): ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any()
  }

  // Handle $ref - simplified, just return any
  if (schema.$ref) {
    return z.any()
  }

  // Handle anyOf / oneOf / allOf - use first option or any
  if (schema.anyOf || schema.oneOf) {
    const options = schema.anyOf || schema.oneOf
    if (options && options.length > 0) {
      return jsonSchemaToZod(options[0])
    }
    return z.any()
  }

  // Handle allOf - merge properties from all schemas
  if (schema.allOf) {
    const merged: any = { type: 'object', properties: {}, required: [] }
    for (const sub of schema.allOf) {
      if (sub.properties) {
        Object.assign(merged.properties, sub.properties)
      }
      if (sub.required) {
        merged.required.push(...sub.required)
      }
    }
    return jsonSchemaToZod(merged)
  }

  // Handle const
  if (schema.const !== undefined) {
    return z.literal(schema.const)
  }

  // Handle enum
  if (schema.enum) {
    if (schema.enum.length === 0) return z.any()
    // @ts-ignore
    return z.enum(schema.enum)
  }

  const type = schema.type

  switch (type) {
    case 'string': {
      let s = z.string()
      if (schema.minLength !== undefined) s = s.min(schema.minLength)
      if (schema.maxLength !== undefined) s = s.max(schema.maxLength)
      if (schema.pattern) s = s.regex(new RegExp(schema.pattern))
      if (schema.format === 'email') s = s.email()
      if (schema.format === 'url') s = s.url()
      if (schema.format === 'uuid') s = s.uuid()
      if (schema.format === 'date') s = s.date()
      if (schema.format === 'datetime') s = s.datetime()
      return s
    }
    case 'number':
    case 'integer': {
      let n = type === 'integer' ? z.number().int() : z.number()
      if (schema.minimum !== undefined) n = n.min(schema.minimum)
      if (schema.maximum !== undefined) n = n.max(schema.maximum)
      if (schema.exclusiveMinimum !== undefined) n = n.gt(schema.exclusiveMinimum)
      if (schema.exclusiveMaximum !== undefined) n = n.lt(schema.exclusiveMaximum)
      if (schema.multipleOf !== undefined) {
        n = n.refine((v: number) => v % schema.multipleOf === 0, { message: `Must be multiple of ${schema.multipleOf}` })
      }
      return n
    }
    case 'boolean':
      return z.boolean()
    case 'array': {
      const items = schema.items ? jsonSchemaToZod(schema.items) : z.any()
      let arr = z.array(items)
      if (schema.minItems !== undefined) arr = arr.min(schema.minItems)
      if (schema.maxItems !== undefined) arr = arr.max(schema.maxItems)
      if (schema.uniqueItems) {
        arr = arr.refine((v: any[]) => new Set(v).size === v.length, { message: 'Items must be unique' })
      }
      return arr
    }
    case 'object': {
      const properties: Record<string, ZodTypeAny> = {}
      const required = new Set(schema.required || [])
      for (const [key, value] of Object.entries(schema.properties || {})) {
        let propSchema = jsonSchemaToZod(value)
        if (!required.has(key)) {
          propSchema = propSchema.optional()
        }
        properties[key] = propSchema
      }
      // Handle additionalProperties
      if (schema.additionalProperties === true || schema.additionalProperties === undefined) {
        return z.object(properties).passthrough()
      } else if (schema.additionalProperties === false) {
        return z.object(properties).strict()
      } else if (typeof schema.additionalProperties === 'object') {
        return z.object(properties).catchall(jsonSchemaToZod(schema.additionalProperties))
      }
      return z.object(properties)
    }
    case 'null':
      return z.null()
    default:
      // No type specified - could be anything
      if (schema.properties) {
        return jsonSchemaToZod({ ...schema, type: 'object' })
      }
      return z.any()
  }
}

function buildZodSchema(inputSchema: any): ZodSchema {
  if (!inputSchema) {
    return z.object({}).passthrough()
  }
  return jsonSchemaToZod(inputSchema)
}

function wrapMcpTool(serverName: string, client: MCPClient, mcpTool: MCPTool): Tool {
  const toolName = `${serverName}_${mcpTool.name}`
  const schema = buildZodSchema(mcpTool.inputSchema)

  return {
    name: toolName,
    description: mcpTool.description || `MCP tool ${mcpTool.name} from server ${serverName}`,
    parameters: schema,
    async execute(args: any) {
      try {
        const result = await client.callTool(mcpTool.name, args)
        if (!result) return '(no result)'
        if (typeof result === 'string') return result
        return JSON.stringify(result, null, 2)
      } catch (err: any) {
        return `Error: ${err.message}`
      }
    }
  }
}

export async function discoverMCPTools(): Promise<Tool[]> {
  const tools: Tool[] = []
  const servers = listServers()

  for (const serverConfig of servers) {
    try {
      const client = await connectServer(serverConfig.name)
      const mcpTools = await client.listTools()
      for (const mcpTool of mcpTools) {
        tools.push(wrapMcpTool(serverConfig.name, client, mcpTool))
      }
    } catch (err: any) {
      // Log but don't fail - other servers may work
      console.error(`Failed to discover tools from MCP server "${serverConfig.name}": ${err.message}`)
    }
  }

  return tools
}

export async function refreshMCPTools(existingTools: Tool[]): Promise<Tool[]> {
  // Remove old MCP tools (prefixed with server name)
  const nonMcpTools = existingTools.filter(t => {
    const serverPrefix = t.name.indexOf('_')
    if (serverPrefix === -1) return true
    const serverName = t.name.slice(0, serverPrefix)
    return !listServers().some(s => s.name === serverName)
  })

  // Disconnect all active clients before rediscovering
  const { disconnectAllServers } = await import('./servers.js')
  await disconnectAllServers()

  const mcpTools = await discoverMCPTools()
  return [...nonMcpTools, ...mcpTools]
}
