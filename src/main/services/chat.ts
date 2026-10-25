import type { Attachment, ChatChunk, Message } from '@shared/types'
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
import type { ChatTurn, ContentBlock, LlmClient, ToolDef } from '../llm/provider'
import type { SecretStore } from '../secrets'
import type { DelegationService } from './delegation'
import { extractDelegations, extractManualDelegation } from './delegation'
import { checkCache, storeCache } from './llmCache'
import type { MemoryService } from './memory'
import type { McpService } from './mcp'
import { getApprovals } from '../db/repos/mcp'
import { logMcpCall } from '../db/repos/mcp'

const MAX_TOOL_ROUNDS = 5
const MODEL_TIMEOUT_MS = 60_000
const MAX_TOOL_DESCRIPTION_LENGTH = 600

function modelSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController()
  let didTimeout = false
  const timer = setTimeout(() => {
    didTimeout = true
    controller.abort(new Error(`Tempo limite do modelo excedido (${timeoutMs / 1000}s)`))
  }, timeoutMs)
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
    }
  }
}

export interface ChatDeps {
  db: Db
  secrets: SecretStore
  createClient: ClientFactory
  onChunk: (chunk: ChatChunk) => void
  memory?: MemoryService
  delegation?: DelegationService
  mcpService?: McpService
  onOfficeEvent?: (ev: import('@shared/office').OfficeEvent) => void
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
    opts: { fromAgentId?: number; signal?: AbortSignal; delegationDepth?: number; delegationStack?: number[]; attachments?: Attachment[] } = {}
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
    const requestStartedAt = Date.now()
    try {
      const client = this.clientFor(agent.providerId)
      const { attachments } = opts
      const pdfTexts = (attachments ?? []).filter((a) => a.mediaType === 'application/pdf').map((a) => `[PDF: ${a.name}]`).join(' ')
      const finalText = pdfTexts ? `${text}\n${pdfTexts}` : text
      insertMessage(db, { conversationId, role: 'user', content: finalText, fromAgentId: opts.fromAgentId ?? null })
      if (conversation.title === defaultTitle) setConversationTitle(db, conversationId, titleFrom(text))

      const history: ChatTurn[] = listMessages(db, conversationId)
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as ChatTurn['role'], content: m.content }))

      // Replace last user turn with ContentBlock[] when images are attached
      if (attachments?.length && history.length > 0) {
        const last = history[history.length - 1]!
        if (last.role === 'user') {
          const userContent: ContentBlock[] = [
            { type: 'text', text },
            ...attachments.flatMap((a): ContentBlock[] => {
              if (a.mediaType === 'application/pdf') return []
              return [{ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }]
            })
          ]
          history[history.length - 1] = { ...last, content: userContent }
        }
      }

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

      this.deps.onOfficeEvent?.({ botId: agent.id, state: 'thinking', task: text.slice(0, 80), ts: Date.now() })

      // Build MCP tools list for this agent
      const toolBuildStartedAt = Date.now()
      const mcpTools: ToolDef[] = []
      const { mcpService } = this.deps
      if (mcpService && agent.mcpTools.length > 0) {
        for (const ref of mcpService.getTools(agent.mcpTools)) {
          // Only selected tools reach the model. Keep the source text (never pt-BR
          // presentation text) and cap its size to reduce prompt overhead.
          const description = ref.tool.description.length > MAX_TOOL_DESCRIPTION_LENGTH
            ? `${ref.tool.description.slice(0, MAX_TOOL_DESCRIPTION_LENGTH - 1)}…`
            : ref.tool.description
          mcpTools.push({ name: ref.tool.name, description, inputSchema: ref.tool.inputSchema })
        }
      }
      console.info(`[MCP] montar tools: ${Date.now() - toolBuildStartedAt}ms (${mcpTools.length} selecionadas)`)

      const parentSignal = opts.signal ?? abortController.signal
      const callModel = async (request: Omit<Parameters<LlmClient['chat']>[0], 'signal'>, label: string) => {
        const startedAt = Date.now()
        const timed = modelSignal(parentSignal, MODEL_TIMEOUT_MS)
        console.info(`[MCP] chamada ao modelo (${label}) iniciada`)
        try {
          return await client.chat({ ...request, signal: timed.signal }, (delta) => {
            this.deps.onChunk({ conversationId, delta })
            if (delta) this.deps.onOfficeEvent?.({ botId: agent.id, state: 'writing', text: delta.slice(0, 60), ts: Date.now() })
          })
        } catch (error) {
          if (timed.timedOut()) throw new Error(`Tempo limite do modelo excedido (60s)`)
          throw error
        } finally {
          timed.cleanup()
          console.info(`[MCP] chamada ao modelo (${label}) terminou em ${Date.now() - startedAt}ms`)
        }
      }

      // Tool loop: model may request at most five rounds of tool calls.
      const approvals = mcpService && agent.mcpTools.length > 0 ? getApprovals(db, agent.id) : {}
      let toolRounds = 0
      let result = await callModel({
        model: agent.model,
        system: systemWithMemory,
        messages: history,
        temperature: agent.temperature,
        tools: mcpTools.length > 0 ? mcpTools : undefined,
        streaming: true
      }, 'inicial')

      while (result.toolUse?.length && mcpService) {
        if (toolRounds >= MAX_TOOL_ROUNDS) throw new Error(`Limite de ${MAX_TOOL_ROUNDS} rodadas de ferramentas MCP atingido`)
        toolRounds++
        console.info(`[MCP] rodada de tools ${toolRounds}/${MAX_TOOL_ROUNDS} (${result.toolUse.length} chamadas)`)
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
              botId: agent.id,
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
        result = await callModel({
          model: agent.model,
          system: systemWithMemory,
          messages: history,
          temperature: agent.temperature,
          tools: mcpTools,
          streaming: true
        }, `após tools ${toolRounds}`)
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
      console.info(`[MCP] resposta final pronta para conversa ${conversationId} em ${Date.now() - requestStartedAt}ms`)
      const source = `conversa com agente ${agent.name} em ${new Date().toLocaleDateString('pt-BR')}`
      this.deps.memory?.extractAndSaveAsync(agent.id, `Usuário: ${text}\nAssistente: ${finalText}`, source)
      this.deps.onOfficeEvent?.({ botId: agent.id, state: 'done', ts: Date.now() })
      return saved
    } catch (err) {
      this.deps.onOfficeEvent?.({ botId: agent.id, state: 'error', error: String(err).slice(0, 120), ts: Date.now() })
      throw err
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
