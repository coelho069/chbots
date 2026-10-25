import type { ChatChunk, Message } from '@shared/types'
import type { Db } from '../db/connection'
import { getAgent } from '../db/repos/agents'
import {
  defaultTitle,
  getConversation,
  insertMessage,
  listMessages,
  setConversationTitle
} from '../db/repos/conversations'
import { getProvider } from '../db/repos/providers'
import type { ClientFactory } from '../llm'
import type { ChatTurn, LlmClient, ToolDef } from '../llm/provider'
import type { SecretStore } from '../secrets'
import type { DelegationService } from './delegation'
import { extractDelegations, extractManualDelegation } from './delegation'
import { checkCache, storeCache } from './llmCache'
import type { MemoryService } from './memory'
import type { McpService } from './mcp'
import { getApprovals } from '../db/repos/mcp'
import { logMcpCall } from '../db/repos/mcp'

const MAX_TOOL_CALLS = 10

export interface ChatDeps {
  db: Db
  secrets: SecretStore
  createClient: ClientFactory
  onChunk: (chunk: ChatChunk) => void
  memory?: MemoryService
  delegation?: DelegationService
  mcpService?: McpService
}

export class ChatService {
  private readonly busy = new Set<number>()
  private readonly controllers = new Map<number, AbortController>()

  constructor(readonly deps: ChatDeps) {}

  clientFor(providerId: number): LlmClient {
    const provider = getProvider(this.deps.db, providerId)
    if (!provider) throw new Error('Provedor não encontrado')
    const apiKey = provider.keyRef ? this.deps.secrets.get(provider.keyRef) : null
    return this.deps.createClient({ kind: provider.kind, baseUrl: provider.baseUrl, apiKey })
  }

  isBusy(conversationId: number): boolean {
    return this.busy.has(conversationId)
  }

  stop(conversationId: number): void {
    this.controllers.get(conversationId)?.abort()
  }

  // Grava a mensagem do usuário, chama o modelo com o histórico e grava a resposta.
  async send(
    conversationId: number,
    text: string,
    opts: { fromAgentId?: number; signal?: AbortSignal; delegationDepth?: number; delegationStack?: number[] } = {}
  ): Promise<Message> {
    const { db } = this.deps
    const conversation = getConversation(db, conversationId)
    if (!conversation) throw new Error('Conversa não encontrada')
    const agent = getAgent(db, conversation.agentId)
    if (!agent) throw new Error('Agente não encontrado')
    if (this.busy.has(conversationId)) throw new Error('Esta conversa ainda está respondendo')

    // Comando manual @NomeBot tarefa: delega diretamente sem passar pelo LLM
    const { delegation } = this.deps
    const depth = opts.delegationDepth ?? 0
    const callStack = opts.delegationStack ?? [agent.id]
    const manualDel = delegation ? extractManualDelegation(text) : null
    if (manualDel && delegation) {
      const destId = delegation.resolveByName(manualDel.para)
      if (!destId) throw new Error(`Bot "@${manualDel.para}" não encontrado`)
      const resposta = await delegation.delegate({
        conversaId: conversationId, botOrigemId: agent.id,
        botDestinoId: destId, tarefa: manualDel.tarefa,
        depth, callStack
      })
      // Grava a resposta como mensagem do bot destino
      return insertMessage(db, { conversationId, role: 'assistant', content: resposta, fromAgentId: destId })
    }

    this.busy.add(conversationId)
    const abortController = new AbortController()
    this.controllers.set(conversationId, abortController)
    try {
      const client = this.clientFor(agent.providerId)
      insertMessage(db, { conversationId, role: 'user', content: text, fromAgentId: opts.fromAgentId ?? null })
      if (conversation.title === defaultTitle) setConversationTitle(db, conversationId, titleFrom(text))

      const history: ChatTurn[] = listMessages(db, conversationId)
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as ChatTurn['role'], content: m.content }))

      const memoryCtx = this.deps.memory?.buildContextSection(text) ?? ''
      const systemWithMemory = memoryCtx ? `${agent.systemPrompt}${memoryCtx}` : agent.systemPrompt

      const provider = getProvider(db, agent.providerId)
      const cacheOpts = {
        provedor: provider?.kind ?? 'unknown',
        modelo: agent.model,
        system: systemWithMemory,
        messages: history,
        temperature: agent.temperature,
        ttlSec: 86400,
        forceEnabled: agent.usarCache
      }
      const cached = checkCache(db, cacheOpts)
      if (cached) {
        this.deps.onChunk({ conversationId, delta: '', done: true })
        return insertMessage(db, {
          conversationId, role: 'assistant',
          content: cached.resposta, tokensIn: cached.tokensIn, tokensOut: cached.tokensOut
        })
      }

      // Build MCP tools list for this agent
      const mcpTools: ToolDef[] = []
      const { mcpService } = this.deps
      if (mcpService && agent.mcpTools.length > 0) {
        for (const ref of mcpService.getTools(agent.mcpTools)) {
          mcpTools.push({ name: ref.tool.name, description: ref.tool.description, inputSchema: ref.tool.inputSchema })
        }
      }

      // Tool loop: model may request tool calls up to MAX_TOOL_CALLS times
      const approvals = mcpService && agent.mcpTools.length > 0 ? getApprovals(db, agent.id) : {}
      let toolCallCount = 0
      let result = await client.chat(
        {
          model: agent.model,
          system: systemWithMemory,
          messages: history,
          temperature: agent.temperature,
          signal: opts.signal ?? abortController.signal,
          tools: mcpTools.length > 0 ? mcpTools : undefined,
          streaming: mcpTools.length === 0
        },
        (delta) => this.deps.onChunk({ conversationId, delta })
      )

      while (result.toolUse?.length && toolCallCount < MAX_TOOL_CALLS && mcpService) {
        toolCallCount++
        const toolTurn: ChatTurn = { role: 'assistant', content: result.text, toolUse: result.toolUse }
        history.push(toolTurn)

        for (const tu of result.toolUse) {
          // Find which server owns this tool
          const ref = agent.mcpTools.find((r) => r.toolName === tu.name)
          if (!ref) {
            history.push({ role: 'tool', content: 'Ferramenta não encontrada', toolCallId: tu.id })
            continue
          }
          const approvalKey = `${ref.serverName}::${tu.name}`
          const policy = approvals[approvalKey] ?? 'ask'
          let toolContent: string
          try {
            const callResult = await mcpService.callTool(ref.serverName, tu.name, tu.input, {
              conversationId,
              requireApproval: policy === 'ask',
            })
            logMcpCall(db, ref.serverName, tu.name, callResult.isError ? 'error' : 'ok', callResult.durationMs)
            toolContent = callResult.content
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('negada')) {
              logMcpCall(db, ref.serverName, tu.name, 'denied')
              toolContent = `Chamada negada pelo usuário`
            } else {
              logMcpCall(db, ref.serverName, tu.name, 'error', undefined, msg)
              toolContent = `Erro: ${msg}`
            }
          }
          history.push({ role: 'tool', content: toolContent, toolCallId: tu.id })
        }

        // Final call — stream the text
        result = await client.chat(
          {
            model: agent.model,
            system: systemWithMemory,
            messages: history,
            temperature: agent.temperature,
            signal: opts.signal ?? abortController.signal,
            tools: mcpTools,
            streaming: result.toolUse == null // stream only if no more tool_use expected
          },
          (delta) => this.deps.onChunk({ conversationId, delta })
        )
      }

      // Processa blocos de delegação embutidos na resposta antes de gravar
      let finalText = result.text
      if (delegation) {
        const delegs = extractDelegations(result.text)
        const maxDel = 3  // limite por resposta (não configurável por bot aqui; segurança extra)
        for (const del of delegs.slice(0, maxDel)) {
          const destId = delegation.resolveByName(del.para)
          if (!destId) continue
          try {
            const resp = await delegation.delegate({
              conversaId: conversationId, botOrigemId: agent.id,
              botDestinoId: destId, tarefa: del.tarefa,
              depth, callStack
            })
            // Substitui o bloco JSON pela resposta inline
            const placeholder = `[Resposta de ${del.para}: ${resp}]`
            finalText = finalText.replace(/\{"delegar"\s*:\s*\{[^}]*"para"\s*:\s*"[^"]*"[^}]*\}}/,  placeholder)
          } catch {
            // Erro na delegação não trava o chat; bloco fica no texto
          }
        }
      }

      storeCache(db, cacheOpts, {
        resposta: finalText,
        tokensIn: result.tokensIn ?? 0,
        tokensOut: result.tokensOut ?? 0
      })
      const saved = insertMessage(db, {
        conversationId,
        role: 'assistant',
        content: finalText,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut
      })
      const source = `conversa com agente ${agent.name} em ${new Date().toLocaleDateString('pt-BR')}`
      this.deps.memory?.extractAndSaveAsync(agent.id, `Usuário: ${text}\nAssistente: ${finalText}`, source)
      return saved
    } finally {
      this.busy.delete(conversationId)
      this.controllers.delete(conversationId)
      this.deps.onChunk({ conversationId, delta: '', done: true })
    }
  }
}

export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.trim()
  return line.length > 60 ? `${line.slice(0, 57)}...` : line || defaultTitle
}
