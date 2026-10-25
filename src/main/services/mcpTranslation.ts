import { createHash } from 'node:crypto'
import type { McpToolDef } from '@shared/mcp'
import type { Db } from '../db/connection'
import { getMcpAutoTranslation, saveMcpAutoTranslation } from '../db/repos/mcpAutoTranslations'
import { listAgents } from '../db/repos/agents'
import type { ChatService } from './chat'
import { cleanReply } from './promptGen'

type TranslationItem = { name: string; description: string; parameters: Record<string, string> }

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
})

const hashTool = (tool: McpToolDef): string => createHash('sha256')
  .update(stableJson({ version: 1, description: tool.description, inputSchema: tool.inputSchema }))
  .digest('hex')

function parameterDescriptions(schema: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const obj = value as Record<string, unknown>
    if (typeof obj.description === 'string' && obj.description.trim()) result[path] = obj.description
    if (obj.properties && typeof obj.properties === 'object') {
      for (const [name, child] of Object.entries(obj.properties as Record<string, unknown>)) visit(child, `${path}.${name}`)
    }
    if (obj.items) visit(obj.items, `${path}[]`)
    if (obj.additionalProperties && typeof obj.additionalProperties === 'object') visit(obj.additionalProperties, `${path}.*`)
  }
  visit(schema, '$')
  return result
}

function applyParameterDescriptions(schema: Record<string, unknown>, translations: Record<string, string>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const obj = value as Record<string, unknown>
    if (translations[path]) obj.description = translations[path]
    if (obj.properties && typeof obj.properties === 'object') {
      for (const [name, child] of Object.entries(obj.properties as Record<string, unknown>)) visit(child, `${path}.${name}`)
    }
    if (obj.items) visit(obj.items, `${path}[]`)
    if (obj.additionalProperties && typeof obj.additionalProperties === 'object') visit(obj.additionalProperties, `${path}.*`)
  }
  visit(clone, '$')
  return clone
}

function parseBatch(text: string): TranslationItem[] {
  const cleaned = cleanReply(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(cleaned) as unknown
  if (!Array.isArray(parsed)) throw new Error('A tradução MCP não retornou uma lista.')
  return parsed.filter((item): item is TranslationItem => {
    if (!item || typeof item !== 'object') return false
    const value = item as Record<string, unknown>
    return typeof value.name === 'string' && typeof value.description === 'string' && typeof value.parameters === 'object'
  })
}

export class McpTranslationService {
  constructor(private readonly db: Db, private readonly chat: ChatService) {}

  async translate(serverName: string, tools: McpToolDef[]): Promise<McpToolDef[]> {
    const result: McpToolDef[] = tools.map((tool) => ({ ...tool, translationStatus: 'translating' as const }))
    const missing: { index: number; tool: McpToolDef; hash: string; params: Record<string, string> }[] = []
    for (let index = 0; index < tools.length; index++) {
      const tool = tools[index]!
      const cached = getMcpAutoTranslation(this.db, serverName, tool.name, hashTool(tool))
      if (cached) {
        result[index] = { ...tool, descriptionPtBr: cached.translatedDescription, inputSchemaPtBr: JSON.parse(cached.translatedInputSchema), translationStatus: 'translated' }
      } else {
        const params = parameterDescriptions(tool.inputSchema)
        if (!tool.description.trim() && Object.keys(params).length === 0) {
          result[index] = { ...tool, descriptionPtBr: tool.description, inputSchemaPtBr: tool.inputSchema, translationStatus: 'original' }
        } else missing.push({ index, tool, hash: hashTool(tool), params })
      }
    }
    if (!missing.length) return result
    const agent = listAgents(this.db)[0]
    if (!agent) return result.map((tool) => ({ ...tool, descriptionPtBr: tool.description, inputSchemaPtBr: tool.inputSchema, translationStatus: 'original' as const, translationError: 'Nenhum agente configurado para traduzir.' }))
    try {
      const items = missing.map(({ tool, params }) => ({ name: tool.name, description: tool.description, parameters: params }))
      const response = await this.chat.clientFor(agent.providerId).chat({
        model: agent.model,
        system: 'Você traduz documentação técnica para pt-BR. Responda SOMENTE JSON válido em uma lista com {name, description, parameters}. Preserve exatamente nomes de tools, nomes de parâmetros, caminhos, URLs, código e termos técnicos. Traduza apenas textos descritivos. Detecte o idioma e mantenha textos já em pt-BR.',
        messages: [{ role: 'user', content: JSON.stringify(items) }],
        temperature: 0.1,
        signal: AbortSignal.timeout(60_000)
      }, () => undefined)
      const translations = new Map(parseBatch(response.text).map((item) => [item.name, item]))
      for (const item of missing) {
        const translated = translations.get(item.tool.name)
        if (!translated) throw new Error(`Resposta sem tradução para ${item.tool.name}`)
        const translatedSchema = applyParameterDescriptions(item.tool.inputSchema, translated.parameters)
        saveMcpAutoTranslation(this.db, {
          serverName, toolName: item.tool.name, originalHash: item.hash,
          originalDescription: item.tool.description, originalInputSchema: stableJson(item.tool.inputSchema),
          translatedDescription: translated.description, translatedInputSchema: JSON.stringify(translatedSchema)
        })
        result[item.index] = { ...item.tool, descriptionPtBr: translated.description, inputSchemaPtBr: translatedSchema, translationStatus: 'translated' }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const item of missing) result[item.index] = { ...item.tool, descriptionPtBr: item.tool.description, inputSchemaPtBr: item.tool.inputSchema, translationStatus: 'original', translationError: message }
    }
    return result
  }
}
