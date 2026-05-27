import { z } from 'zod'
import { Tool } from '../tools/index.js'
import { LspClient } from './client.js'
import {
  getServerConfigByExtension,
  getServerConfigByLanguageId,
  detectRootPath,
  detectLanguageFromPath,
  LspServerConfig
} from './servers.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const clientCache = new Map<string, LspClient>()

async function getOrCreateClient(filePath: string): Promise<{ client: LspClient; config: LspServerConfig } | null> {
  const dotIndex = filePath.lastIndexOf('.')
  const ext = dotIndex > 0 ? filePath.slice(dotIndex) : ''
  let config = getServerConfigByExtension(ext)
  if (!config) {
    const langId = detectLanguageFromPath(filePath)
    config = getServerConfigByLanguageId(langId)
  }
  if (!config) return null

  const rootPath = detectRootPath(resolve(filePath), config)
  const cacheKey = `${config.name}:${rootPath}`

  let client = clientCache.get(cacheKey)
  if (!client) {
    client = new LspClient(config, `file://${rootPath}`)
    await client.start()
    await client.initialize()
    clientCache.set(cacheKey, client)
  }

  // Ensure file is open
  try {
    const content = readFileSync(resolve(filePath), 'utf-8')
    await client.didOpen({
      uri: `file://${resolve(filePath)}`,
      languageId: config.languageIds[0],
      version: 1,
      text: content
    })
  } catch {}

  return { client, config }
}

export async function shutdownAllClients(): Promise<void> {
  for (const [key, client] of clientCache) {
    try {
      await client.shutdown()
    } catch {}
  }
  clientCache.clear()
}

export const GoToDefinitionTool: Tool = {
  name: 'GoToDefinition',
  description: 'Go to the definition of a symbol at a specific position in a file using LSP. Returns the file path and line range of the definition.',
  parameters: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    line: z.number().describe('Zero-based line number'),
    character: z.number().describe('Zero-based character/column number')
  }),
  async execute(args) {
    const result = await getOrCreateClient(args.filePath)
    if (!result) return 'Error: No LSP server available for this file type'
    const { client } = result
    try {
      const locations = await client.gotoDefinition(args.filePath, args.line, args.character)
      if (!locations) return 'No definition found'
      const arr = Array.isArray(locations) ? locations : [locations]
      if (arr.length === 0) return 'No definition found'
      return arr.map((loc: any) => {
        const uri = loc.uri || loc.targetUri || ''
        const range = loc.range || loc.targetRange
        if (!range) return uri
        return `${uri}:${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`
      }).join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const FindReferencesTool: Tool = {
  name: 'FindReferences',
  description: 'Find all references to a symbol at a specific position in a file using LSP. Returns a list of file paths and line ranges.',
  parameters: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    line: z.number().describe('Zero-based line number'),
    character: z.number().describe('Zero-based character/column number')
  }),
  async execute(args) {
    const result = await getOrCreateClient(args.filePath)
    if (!result) return 'Error: No LSP server available for this file type'
    const { client } = result
    try {
      const locations = await client.findReferences(args.filePath, args.line, args.character)
      if (!locations || locations.length === 0) return 'No references found'
      return locations.map((loc: any) => {
        const uri = loc.uri || ''
        const range = loc.range
        if (!range) return uri
        return `${uri}:${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`
      }).join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const HoverTool: Tool = {
  name: 'Hover',
  description: 'Get hover information (type info, docs) for a symbol at a specific position in a file using LSP.',
  parameters: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    line: z.number().describe('Zero-based line number'),
    character: z.number().describe('Zero-based character/column number')
  }),
  async execute(args) {
    const result = await getOrCreateClient(args.filePath)
    if (!result) return 'Error: No LSP server available for this file type'
    const { client } = result
    try {
      const hover = await client.hover(args.filePath, args.line, args.character)
      if (!hover) return 'No hover information found'
      const contents = hover.contents
      if (typeof contents === 'string') return contents
      if (Array.isArray(contents)) {
        return contents.map((c: any) => typeof c === 'string' ? c : c.value || JSON.stringify(c)).join('\n')
      }
      if (contents?.value) return contents.value
      return JSON.stringify(hover, null, 2)
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const GetDiagnosticsTool: Tool = {
  name: 'GetDiagnostics',
  description: 'Get diagnostics (errors, warnings, hints) for a file using LSP. Returns a list of diagnostic messages with severity and location.',
  parameters: z.object({
    filePath: z.string().describe('Absolute or relative path to the file')
  }),
  async execute(args) {
    const result = await getOrCreateClient(args.filePath)
    if (!result) return 'Error: No LSP server available for this file type'
    const { client } = result
    try {
      const diagnostics = await client.getDiagnostics(args.filePath)
      if (!diagnostics || diagnostics.length === 0) return 'No diagnostics found'
      const severityMap = ['Error', 'Warning', 'Information', 'Hint']
      return diagnostics.map((d: any) => {
        const sev = severityMap[d.severity - 1] || 'Unknown'
        const line = d.range?.start?.line != null ? d.range.start.line + 1 : '?'
        const char = d.range?.start?.character != null ? d.range.start.character + 1 : '?'
        return `[${sev}] ${args.filePath}:${line}:${char} ${d.message}`
      }).join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

export const RenameSymbolTool: Tool = {
  name: 'RenameSymbol',
  description: 'Rename a symbol at a specific position in a file using LSP. Returns the workspace edit (file changes) that would be applied.',
  parameters: z.object({
    filePath: z.string().describe('Absolute or relative path to the file'),
    line: z.number().describe('Zero-based line number'),
    character: z.number().describe('Zero-based character/column number'),
    newName: z.string().describe('The new name for the symbol')
  }),
  async execute(args) {
    const result = await getOrCreateClient(args.filePath)
    if (!result) return 'Error: No LSP server available for this file type'
    const { client } = result
    try {
      const edit = await client.rename(args.filePath, args.line, args.character, args.newName)
      if (!edit) return 'Cannot rename this symbol'
      if (edit.changes) {
        const parts: string[] = []
        for (const [uri, edits] of Object.entries(edit.changes)) {
          parts.push(`File: ${uri}`)
          for (const e of edits as any[]) {
            const start = e.range?.start
            const end = e.range?.end
            parts.push(`  ${start.line + 1}:${start.character + 1}-${end.line + 1}:${end.character + 1} => "${e.newText}"`)
          }
        }
        return parts.join('\n')
      }
      if (edit.documentChanges) {
        return JSON.stringify(edit.documentChanges, null, 2)
      }
      return JSON.stringify(edit, null, 2)
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}
