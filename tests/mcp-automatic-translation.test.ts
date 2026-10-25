import { describe, expect, it } from 'vitest'
import { clearMcpAutoTranslations } from '../src/main/db/repos/mcpAutoTranslations'
import { McpTranslationService } from '../src/main/services/mcpTranslation'
import type { McpToolDef } from '../src/shared/mcp'
import { setup, FakeClient } from './helpers'

const loadFixture = async (name: string): Promise<{ server: string; tools: McpToolDef[] }> => {
  const module = await import(`./fixtures/${name}.json`)
  return module.default as { server: string; tools: McpToolDef[] }
}

const translatedClient = (requests: { messages: { content: string }[] }[]) => new FakeClient((request) => {
  requests.push(request)
  const items = JSON.parse(request.messages[0]!.content) as { name: string; description: string; parameters: Record<string, string> }[]
  return JSON.stringify(items.map((item) => ({
    name: item.name,
    description: `Descrição pt-BR: ${item.description}`,
    parameters: Object.fromEntries(Object.entries(item.parameters).map(([key, value]) => [key, `Parâmetro pt-BR: ${value}`]))
  })))
})

describe('tradução automática MCP', () => {
  it('traduz em lote tools e parâmetros de fixtures filesystem e memory', async () => {
    const requests: { messages: { content: string }[] }[] = []
    const client = translatedClient(requests)
    const { db, chat, agent } = setup(client)
    agent('Tradutor')
    const translator = new McpTranslationService(db, chat)
    const filesystem = await loadFixture('mcp-filesystem-tools')
    const memory = await loadFixture('mcp-memory-tools')
    const fsResult = await translator.translate(filesystem.server, filesystem.tools)
    const memoryResult = await translator.translate(memory.server, memory.tools)

    expect(requests).toHaveLength(2)
    expect(client.requests[0]!.system).toContain('pt-BR')
    expect(JSON.parse(requests[0]!.messages[0]!.content)).toHaveLength(2)
    expect(JSON.parse(requests[1]!.messages[0]!.content)).toHaveLength(1)
    expect(fsResult.every((tool) => tool.translationStatus === 'translated')).toBe(true)
    expect(memoryResult[0]!.descriptionPtBr).toContain('Descrição pt-BR')
    expect((fsResult[0]!.inputSchemaPtBr?.properties as Record<string, { description: string }>).path.description).toContain('Parâmetro pt-BR')
  })

  it('usa servidor + tool + hash; não retraduz, mas retraduz quando a descrição muda', async () => {
    const requests: { messages: { content: string }[] }[] = []
    const { db, chat, agent } = setup(translatedClient(requests))
    agent('Tradutor')
    const translator = new McpTranslationService(db, chat)
    const tools = (await loadFixture('mcp-memory-tools')).tools
    await translator.translate('memory', tools)
    await translator.translate('memory', tools)
    await translator.translate('outro-servidor', tools)
    await translator.translate('memory', [{ ...tools[0]!, description: `${tools[0]!.description} Also updates entities.` }])
    expect(requests).toHaveLength(3)
    expect((db.prepare('SELECT COUNT(*) AS count FROM mcp_tool_translations_auto').get() as { count: number }).count).toBe(3)
  })

  it('preserva descrição e schema originais para o modelo e para chamadas', async () => {
    const requests: { messages: { content: string }[] }[] = []
    const { db, chat, agent } = setup(translatedClient(requests))
    agent('Tradutor')
    const translator = new McpTranslationService(db, chat)
    const tools = (await loadFixture('mcp-filesystem-tools')).tools
    const original = structuredClone(tools)
    await translator.translate('filesystem', tools)
    expect(tools).toEqual(original)
    const sent = JSON.parse(requests[0]!.messages[0]!.content) as { description: string; parameters: Record<string, string> }[]
    expect(sent[0]!.description).toBe(original[0]!.description)
    expect(sent[0]!.parameters['$.path']).toBe('The absolute path to the file.')
  })

  it('faz fallback para original sem agente ou quando o modelo falha', async () => {
    const noAgent = setup(new FakeClient())
    const noAgentResult = await new McpTranslationService(noAgent.db, noAgent.chat).translate('filesystem', (await loadFixture('mcp-filesystem-tools')).tools)
    expect(noAgentResult[0]!.translationStatus).toBe('original')
    expect(noAgentResult[0]!.descriptionPtBr).toBe(noAgentResult[0]!.description)

    const failing = setup(new FakeClient(async () => { throw new Error('modelo indisponível') }))
    failing.agent('Tradutor')
    const failed = await new McpTranslationService(failing.db, failing.chat).translate('filesystem', (await loadFixture('mcp-filesystem-tools')).tools)
    expect(failed[0]!.translationStatus).toBe('original')
    expect(failed[0]!.translationError).toContain('modelo indisponível')
  })

  it('limpa o cache para permitir Retraduzir tudo', async () => {
    const requests: { messages: { content: string }[] }[] = []
    const { db, chat, agent } = setup(translatedClient(requests))
    agent('Tradutor')
    const translator = new McpTranslationService(db, chat)
    const tools = (await loadFixture('mcp-filesystem-tools')).tools
    await translator.translate('filesystem', tools)
    clearMcpAutoTranslations(db)
    await translator.translate('filesystem', tools)
    expect(requests).toHaveLength(2)
  })
})
