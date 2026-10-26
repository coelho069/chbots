import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import cron from 'node-cron'
import { z } from 'zod'
import { defaultNodeData, nodeRef, validateGraph, type FlowSaveInput } from '@shared/flows'
import { channels } from '@shared/ipc'
import {
  agentInput,
  flowMetaInput,
  flowSaveInput,
  handoffInput,
  idSchema,
  promptGenerateInput,
  promptIdea,
  promptSaveMdInput,
  providerInput,
  routineInput,
  sendInput,
  settingsInput,
  type ProviderInput,
  type RoutineInput
} from '@shared/schemas'
import { unsavedChoice, unsavedDialog } from './closeDialog'
import type { Db } from './db/connection'
import { deleteAgent, getAgent, insertAgent, listAgents, updateAgent } from './db/repos/agents'
import {
  deleteConversation,
  getConversation,
  getMessage,
  insertConversation,
  listConversations,
  listMessages
} from './db/repos/conversations'
import {
  deleteProvider,
  getProvider,
  insertProvider,
  listProviders,
  providerInUse,
  setProviderKeyRef,
  toPublic,
  updateProvider
} from './db/repos/providers'
import {
  deleteFlow,
  getFlow,
  getFlowDetail,
  insertFlow,
  listFlowRuns,
  listFlows,
  listSteps,
  saveFlow
} from './db/repos/flows'
import { deleteGeneratedPrompt, listGeneratedPrompts } from './db/repos/prompts'
import {
  archiveFato, confirmFato, deleteFato, editFato, exportFacts, getFato,
  importFacts, listCategories, listFacts, mergeFatos, saveFact, searchFacts,
  deleteCategory, saveCategory,
  listLigacoes, saveLigacao, deleteLigacao, listNodePositions, saveNodePositions,
  listGraphGroups, saveGraphGroup, deleteGraphGroup, getGraphConfig, saveGraphConfig
} from './db/repos/memoria'
import { deleteRoutine, insertRoutine, listRoutines, listRuns, updateRoutine } from './db/repos/routines'
import { getSettings, saveSettings } from './db/repos/settings'
import { checkOllama } from './claudeCode'
import type { FlowRunner } from './flows/runner'
import { providerKeyRef, type SecretStore } from './secrets'
import type { ChatService } from './services/chat'
import type { DelegationService } from './services/delegation'
import { delegationConfigInput, mcpServerAddInput, mcpApprovalInput } from '@shared/schemas'
import { clearAllCache, getCacheStats } from './db/repos/cache'
import { getApprovals, logMcpCall, removeApproval, setApproval } from './db/repos/mcp'
import { getMcpTranslation, saveMcpTranslation } from './db/repos/mcpTranslations'
import { clearMcpAutoTranslations } from './db/repos/mcpAutoTranslations'
import type { McpService } from './services/mcp'
import type { VerificadorService } from './verificador'
import { importFromFile, loadMcpFile, saveMcpFile } from './mcpConfig'
import type { McpServerConfig, McpToolApproval } from '@shared/mcp'
import { getDelegationConfig, listDelegations, saveDelegationConfig } from './db/repos/delegations'
import { handoff } from './services/handoff'
import type { PromptGenerator } from './services/promptGen'
import { cleanReply } from './services/promptGen'
import type { Scheduler } from './services/scheduler'
import { listPages, getPage as getPageRecord, deletePage } from './db/repos/pages'

export interface IpcContext {
  db: Db
  secrets: SecretStore
  chat: ChatService
  delegation: DelegationService
  scheduler: Scheduler
  flowRunner: FlowRunner
  promptGen: PromptGenerator
  mcpService: McpService
  dataDir: string
  getWindow: () => BrowserWindow | null
  isTrustedUrl: (url: string) => boolean
  resolveDraft: (draftId: number, approve: boolean) => void
  verificador?: VerificadorService
}

type Handler = (...args: unknown[]) => unknown

export function registerIpc(ctx: IpcContext): void {
  const { db, secrets, chat, delegation, scheduler, flowRunner, promptGen, mcpService } = ctx

  // Só a janela do próprio app pode chamar o main.
  const handle = (channel: string, fn: Handler): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const url = event.senderFrame?.url ?? ''
      if (!ctx.isTrustedUrl(url)) throw new Error('Origem não autorizada')
      return fn(...args)
    })
  }
  const id = (v: unknown): number => idSchema.parse(v)

  // ---- Provedores ----
  const applyKey = (providerId: number, apiKey: ProviderInput['apiKey']): void => {
    if (apiKey === undefined) return
    const ref = providerKeyRef(providerId)
    if (apiKey.trim() === '') {
      secrets.delete(ref)
      setProviderKeyRef(db, providerId, null)
    } else {
      secrets.set(ref, apiKey.trim())
      setProviderKeyRef(db, providerId, ref)
    }
  }

  handle(channels.providersList, () => listProviders(db).map(toPublic))
  handle(channels.providersCreate, (input) => {
    const p = providerInput.parse(input)
    const created = insertProvider(db, p)
    applyKey(created.id, p.apiKey)
    return toPublic(getProvider(db, created.id)!)
  })
  handle(channels.providersUpdate, (rawId, input) => {
    const providerId = id(rawId)
    const p = providerInput.parse(input)
    updateProvider(db, providerId, p)
    applyKey(providerId, p.apiKey)
    return toPublic(getProvider(db, providerId)!)
  })
  handle(channels.providersRemove, (rawId) => {
    const providerId = id(rawId)
    if (providerInUse(db, providerId)) throw new Error('Há agentes usando este provedor')
    secrets.delete(providerKeyRef(providerId))
    deleteProvider(db, providerId)
  })
  handle(channels.providersModels, (rawId) => chat.clientFor(id(rawId)).listModels())

  // ---- Agentes ----
  handle(channels.agentsList, () => listAgents(db))
  handle(channels.agentsCreate, (input) => insertAgent(db, agentInput.parse(input)))
  handle(channels.agentsUpdate, (rawId, input) => updateAgent(db, id(rawId), agentInput.parse(input)))
  handle(channels.agentsDuplicate, (rawId) => {
    const agent = getAgent(db, id(rawId))
    if (!agent) throw new Error('Agente não encontrado')
    return insertAgent(db, { ...agent, name: `${agent.name} (cópia)`.slice(0, 80) })
  })
  handle(channels.agentsRemove, (rawId) => {
    deleteAgent(db, id(rawId))
    scheduler.reload()
  })

  // ---- Conversas e chat ----
  handle(channels.conversationsList, (agentId) => listConversations(db, id(agentId)))
  handle(channels.conversationsCreate, (agentId) => {
    const agentIdNum = id(agentId)
    if (!getAgent(db, agentIdNum)) throw new Error('Agente não encontrado')
    return insertConversation(db, agentIdNum, 'manual')
  })
  handle(channels.conversationsRemove, (rawId) => {
    const conversationId = id(rawId)
    if (chat.isBusy(conversationId)) throw new Error('Aguarde a resposta terminar')
    deleteConversation(db, conversationId)
  })
  handle(channels.conversationsMessages, (rawId, rawBeforeId?) => listMessages(db, id(rawId), rawBeforeId != null ? id(rawBeforeId) : undefined))

  handle(channels.chatSend, (conversationId, text, rawAttachments?) => {
    const input = sendInput.parse({ conversationId, text, attachments: rawAttachments })
    return chat.send(input.conversationId, input.text, { attachments: input.attachments })
  })
  handle(channels.chatStop, (conversationId) => { chat.stop(id(conversationId)) })
  handle(channels.chatHandoff, (input) => {
    const req = handoffInput.parse(input)
    const message = getMessage(db, req.messageId)
    if (!message) throw new Error('Mensagem não encontrada')
    const conversation = getConversation(db, message.conversationId)!
    return handoff(db, chat, {
      fromAgentId: conversation.agentId,
      toAgentId: req.toAgentId,
      content: message.content,
      instruction: req.instruction,
      origin: 'handoff'
    })
  })

  // ---- Fechar item atual (Ctrl+B) ----
  handle(channels.appAskUnsaved, async (rawDetail, rawCanSave) => {
    const detail = z.string().max(500).parse(rawDetail)
    const canSave = z.boolean().parse(rawCanSave)
    const options = unsavedDialog(detail, canSave)
    const win = ctx.getWindow()
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return unsavedChoice(response, canSave)
  })

  // ---- Gerador de Prompts ----
  handle(channels.promptsCorrect, (rawAgentId, idea) => promptGen.correct(id(rawAgentId), promptIdea.parse(idea)))
  handle(channels.promptsGenerate, (input) => promptGen.generate(promptGenerateInput.parse(input)))
  handle(channels.promptsList, () => listGeneratedPrompts(db))
  handle(channels.promptsRemove, (rawId) => deleteGeneratedPrompt(db, id(rawId)))
  handle(channels.promptsSaveMd, async (rawContent, rawName) => {
    const { content, suggestedName } = promptSaveMdInput.parse({ content: rawContent, suggestedName: rawName })
    const safeName = suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'prompt'
    const win = ctx.getWindow()
    const options = {
      title: 'Salvar prompt',
      defaultPath: safeName.toLowerCase().endsWith('.md') ? safeName : `${safeName}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })

  // ---- Rotinas ----
  const parseRoutine = (input: unknown): RoutineInput => {
    const r = routineInput.parse(input)
    if (!cron.validate(r.cron)) throw new Error('Horário inválido')
    if (r.targetAgentId === r.sourceAgentId) throw new Error('O agente de destino deve ser diferente do de origem')
    return r
  }
  handle(channels.routinesList, () => listRoutines(db))
  handle(channels.routinesCreate, (input) => {
    const created = insertRoutine(db, parseRoutine(input))
    scheduler.reload()
    return created
  })
  handle(channels.routinesUpdate, (rawId, input) => {
    const updated = updateRoutine(db, id(rawId), parseRoutine(input))
    scheduler.reload()
    return updated
  })
  handle(channels.routinesRemove, (rawId) => {
    deleteRoutine(db, id(rawId))
    scheduler.reload()
  })
  handle(channels.routinesRunNow, (rawId) => scheduler.trigger(id(rawId)).run)
  handle(channels.routinesRuns, (routineId) => listRuns(db, routineId === null ? null : id(routineId)))

  // ---- Configurações ----
  // ---- Configurações ----
  handle(channels.settingsGet, () => getSettings(db))
  handle(channels.settingsTestOllama, () => checkOllama())

  // ---- Fluxos ----
  const parseFlow = (input: unknown): FlowSaveInput => {
    const parsed = flowSaveInput.parse(input) as FlowSaveInput
    const problems = validateGraph(parsed.graph)
    for (const n of parsed.graph.nodes) {
      if (n.type === 'trigger' && n.data.mode === 'schedule' && n.data.cron.trim() && !cron.validate(n.data.cron))
        problems.push('Horário do Gatilho inválido.')
      if ((n.type === 'agent' || n.type === 'promptgen' || n.type === 'delegate') && n.data.agentId !== null && !getAgent(db, n.data.agentId))
        problems.push(`${nodeRef(parsed.graph, n.id)}: o agente escolhido não existe mais.`)
    }
    if (problems.length > 0) throw new Error(problems.join('\n'))
    return parsed
  }

  handle(channels.flowsList, () => listFlows(db))
  handle(channels.flowsGet, (rawId) => {
    const flow = getFlowDetail(db, id(rawId))
    if (!flow) throw new Error('Fluxo não encontrado')
    return flow
  })
  handle(channels.flowsCreate, (input) => {
    const meta = flowMetaInput.parse(input)
    // começa com um gatilho manual, já que todo fluxo precisa de um
    const trigger = { id: randomUUID(), type: 'trigger' as const, data: defaultNodeData('trigger'), position: { x: 0, y: 0 } }
    return insertFlow(db, meta, { nodes: [trigger], edges: [] })
  })
  handle(channels.flowsSave, (rawId, input) => {
    const flowId = id(rawId)
    if (!getFlow(db, flowId)) throw new Error('Fluxo não encontrado')
    const { graph, ...meta } = parseFlow(input)
    const saved = saveFlow(db, flowId, meta, graph)
    flowRunner.reload()
    return saved
  })
  handle(channels.flowsRemove, (rawId) => {
    const flowId = id(rawId)
    if (flowRunner.isRunning(flowId)) throw new Error('Aguarde a execução terminar')
    deleteFlow(db, flowId)
    flowRunner.reload()
  })
  handle(channels.flowsRun, (rawId) => flowRunner.start(id(rawId), 'manual').run)
  handle(channels.flowsRuns, (flowId) => listFlowRuns(db, id(flowId)))
  handle(channels.flowsRunSteps, (runId) => listSteps(db, id(runId)))
  handle(channels.flowsCancel, (rawRunId) => { flowRunner.cancel(id(rawRunId)) })
  handle(channels.flowsStatus, (rawRunId) => flowRunner.status(id(rawRunId)))
  handle(channels.flowsInterruptRespond, (rawRunId, rawApproved) => {
    flowRunner.respondInterrupt(id(rawRunId), Boolean(rawApproved))
  })

  handle(channels.settingsUpdate, (input) => {
    const parsed = settingsInput.parse(input)
    const existing = getSettings(db)
    // preserve apiToken: the renderer never sees/sends it, so always keep the stored value
    return saveSettings(db, { ...existing, ...parsed, apiToken: existing.apiToken })
  })

  // ---- Caixa-Preta ----
  type BBRow = { tipo: 'fluxo' | 'rotina'; execucaoId: number; nome: string; status: string; agentId: number | null; fluxoId: number | null; iniciadoEm: string; finalizadoEm: string | null; erro: string | null }
  const listBlackBox = (filters?: { tipo?: string; apenasErros?: boolean; agentId?: number; fluxoId?: number; busca?: string }): BBRow[] => {
    const errClause = filters?.apenasErros ? " AND fr.status = 'error'" : ''
    const flowIdClause = filters?.fluxoId != null ? ` AND f.id = ${Number(filters.fluxoId)}` : ''
    const buscaClause = filters?.busca ? ` AND (f.name LIKE ? OR fr.error LIKE ?)` : ''
    const buscaParams = filters?.busca ? [`%${filters.busca}%`, `%${filters.busca}%`] : []

    let entries: BBRow[] = []

    if (!filters?.tipo || filters.tipo === 'fluxo') {
      entries.push(...(db.prepare(`
        SELECT 'fluxo' as tipo, fr.id as execucaoId, f.name as nome, fr.status, NULL as agentId, f.id as fluxoId,
               fr.started_at as iniciadoEm, fr.finished_at as finalizadoEm, fr.error as erro
        FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id
        WHERE 1=1${errClause}${flowIdClause}${buscaClause}
      `).all(...buscaParams) as unknown as BBRow[]))
    }

    if (!filters?.tipo || filters.tipo === 'rotina') {
      const agentClause = filters?.agentId != null ? ` AND r.source_agent_id = ${Number(filters.agentId)}` : ''
      const errClause2 = filters?.apenasErros ? " AND rr.status = 'error'" : ''
      const buscaClause2 = filters?.busca ? ` AND (r.name LIKE ? OR rr.error LIKE ?)` : ''
      entries.push(...(db.prepare(`
        SELECT 'rotina' as tipo, rr.id as execucaoId, r.name as nome, rr.status, r.source_agent_id as agentId, NULL as fluxoId,
               rr.started_at as iniciadoEm, rr.finished_at as finalizadoEm, rr.error as erro
        FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id
        WHERE 1=1${errClause2}${agentClause}${buscaClause2}
      `).all(...buscaParams) as unknown as BBRow[]))
    }

    entries.sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm))
    return entries
  }
  handle(channels.blackboxList, (rawFilters) => listBlackBox(rawFilters as Parameters<typeof listBlackBox>[0]))
  handle(channels.blackboxActiveCount, () => {
    const row = db.prepare(`
      SELECT (SELECT COUNT(*) FROM flow_runs WHERE status='running') + (SELECT COUNT(*) FROM routine_runs WHERE status='running') as n
    `).get() as { n: number } | undefined
    return row?.n ?? 0
  })
  handle(channels.blackboxExportCsv, (rawFilters) => {
    const entries = listBlackBox(rawFilters as Parameters<typeof listBlackBox>[0])
    const header = 'tipo,execucaoId,nome,status,iniciadoEm,finalizadoEm,erro\n'
    const rows = entries.map((e) =>
      [e.tipo, e.execucaoId, `"${e.nome.replace(/"/g, '""')}"`, e.status, e.iniciadoEm, e.finalizadoEm ?? '', `"${(e.erro ?? '').replace(/"/g, '""')}"`].join(',')
    )
    return header + rows.join('\n')
  })
  // ---- Memória ----
  handle(channels.memorySearch, (query, limit) => searchFacts(db, z.string().parse(query), typeof limit === 'number' ? limit : 10))
  handle(channels.memoryList, (filters) => listFacts(db, (filters ?? {}) as Parameters<typeof listFacts>[1]))
  handle(channels.memorySave, (input) => {
    const i = input as Parameters<typeof saveFact>[1]
    if (!i.fonte?.trim()) throw new Error('Fonte obrigatória')
    return saveFact(db, i)
  })
  handle(channels.memoryEdit, (rawId, patch) => editFato(db, id(rawId), patch as Parameters<typeof editFato>[2]))
  handle(channels.memoryMerge, (keepId, removeId) => mergeFatos(db, id(keepId), id(removeId)))
  handle(channels.memoryArchive, (rawId) => archiveFato(db, id(rawId)))
  handle(channels.memoryDelete, (rawId) => deleteFato(db, id(rawId)))
  handle(channels.memoryConfirm, (rawId) => confirmFato(db, id(rawId)))
  handle(channels.memoryExport, () => exportFacts(db))
  handle(channels.memoryImport, (json) => importFacts(db, z.string().parse(json)))
  handle(channels.memoryCategoriesList, () => listCategories(db))
  handle(channels.memoryCategoriesSave, (nome, cor) => saveCategory(db, z.string().parse(nome), z.string().parse(cor)))
  handle(channels.memoryCategoriesDelete, (nome, mergeTo) => deleteCategory(db, z.string().parse(nome), z.string().parse(mergeTo)))
  handle(channels.memoryLigacoesList, (filters) => listLigacoes(db, (filters ?? {}) as object))
  handle(channels.memoryLigacoesSave, (origemId, destinoId) => saveLigacao(db, id(origemId), id(destinoId)))
  handle(channels.memoryLigacoesDelete, (rawId) => deleteLigacao(db, id(rawId)))
  handle(channels.memoryPositionsList, () => listNodePositions(db))
  handle(channels.memoryPositionsSave, (positions) => saveNodePositions(db, positions as import('@shared/types').NodePosition[]))
  handle(channels.memoryGraphGroupsList, () => listGraphGroups(db))
  handle(channels.memoryGraphGroupsSave, (input) => saveGraphGroup(db, input as Parameters<typeof saveGraphGroup>[1]))
  handle(channels.memoryGraphGroupsDelete, (rawId) => deleteGraphGroup(db, id(rawId)))
  handle(channels.memoryGraphConfigGet, () => getGraphConfig(db))
  handle(channels.memoryGraphConfigSave, (config) => saveGraphConfig(db, config))

  // ---- Delegação ----
  handle(channels.delegationConfigGet, (rawAgentId) => getDelegationConfig(db, id(rawAgentId)))
  handle(channels.delegationConfigSave, (input) => saveDelegationConfig(db, delegationConfigInput.parse(input)))
  handle(channels.delegationList, (rawConversaId) => listDelegations(db, id(rawConversaId)))

  // ---- Desempenho ----
  handle(channels.perfStats, () => getCacheStats(db, join(ctx.dataDir, 'ch-bots.db')))
  handle(channels.perfClearCache, () => clearAllCache(db))
  handle(channels.perfOptimize, () => { db.prepare('VACUUM').run() })

  // ---- MCP ----
  handle(channels.mcpList, () => mcpService.list())

  // Persistir configuração não deve aguardar o handshake do servidor.
  const loadMcpInBackground = (entries: ReturnType<typeof loadMcpFile>): void => {
    void mcpService.loadAll(entries).catch((error: unknown) => {
      console.error('Falha ao atualizar conexões MCP após salvar:', error)
    })
  }

  handle(channels.mcpAdd, async (rawName, rawConfig, rawEnabled) => {
    const name = z.string().trim().min(1).max(80).parse(rawName)
    const { config } = mcpServerAddInput.parse({ name, config: rawConfig, enabled: rawEnabled ?? true })
    const entries = loadMcpFile(ctx.dataDir)
    if (entries.some((e) => e.name === name)) throw new Error(`Servidor "${name}" já existe`)
    entries.push({ name, enabled: rawEnabled !== false, config: config as McpServerConfig })
    saveMcpFile(ctx.dataDir, entries)
    loadMcpInBackground(entries)
    return mcpService.list()
  })

  handle(channels.mcpUpdate, async (rawName, rawConfig) => {
    const name = z.string().trim().min(1).max(80).parse(rawName)
    const entries = loadMcpFile(ctx.dataDir)
    const idx = entries.findIndex((e) => e.name === name)
    if (idx === -1) throw new Error(`Servidor "${name}" não encontrado`)
    const { config } = mcpServerAddInput.parse({ name, config: rawConfig })
    entries[idx] = { ...entries[idx]!, config: config as McpServerConfig }
    saveMcpFile(ctx.dataDir, entries)
    loadMcpInBackground(entries)
    return mcpService.list()
  })

  handle(channels.mcpRemove, async (rawName) => {
    const name = z.string().trim().min(1).max(80).parse(rawName)
    await mcpService.disconnect(name)
    const entries = loadMcpFile(ctx.dataDir).filter((e) => e.name !== name)
    saveMcpFile(ctx.dataDir, entries)
    loadMcpInBackground(entries)
    return mcpService.list()
  })

  handle(channels.mcpToggle, async (rawName, rawEnabled) => {
    const name = z.string().trim().min(1).max(80).parse(rawName)
    const enabled = z.boolean().parse(rawEnabled)
    const entries = loadMcpFile(ctx.dataDir)
    const entry = entries.find((e) => e.name === name)
    if (!entry) throw new Error(`Servidor "${name}" não encontrado`)
    entry.enabled = enabled
    saveMcpFile(ctx.dataDir, entries)
    loadMcpInBackground(entries)
    return mcpService.list()
  })

  handle(channels.mcpRestart, async (rawName) => {
    await mcpService.restart(z.string().trim().min(1).max(80).parse(rawName))
  })

  handle(channels.mcpCallTool, async (rawServer, rawTool, rawArgs) => {
    const serverName = z.string().min(1).max(80).parse(rawServer)
    const toolName = z.string().min(1).max(200).parse(rawTool)
    const args = (rawArgs ?? {}) as Record<string, unknown>
    const result = await mcpService.callTool(serverName, toolName, args)
    logMcpCall(db, serverName, toolName, result.isError ? 'error' : 'ok', result.durationMs)
    return result
  })

  handle(channels.mcpTranslateTool, async (rawTool, rawDescription) => {
    const toolName = z.string().min(1).max(200).parse(rawTool)
    const originalDescription = z.string().trim().min(1).max(20_000).parse(rawDescription)
    const cached = getMcpTranslation(db, toolName, originalDescription)
    if (cached) return cached
    const agent = listAgents(db)[0]
    if (!agent) throw new Error('Configure ao menos um agente para traduzir descrições MCP.')
    const result = await chat.clientFor(agent.providerId).chat({
      model: agent.model,
      system: 'Você traduz descrições técnicas de ferramentas para português do Brasil. Preserve nomes de parâmetros, caminhos, URLs e código. Responda somente com a tradução.',
      messages: [{ role: 'user', content: `Nome da ferramenta: ${toolName}\nDescrição original:\n${originalDescription}` }],
      temperature: 0.1,
      signal: AbortSignal.timeout(30_000)
    }, () => undefined)
    const translated = cleanReply(result.text)
    if (!translated) throw new Error('O modelo devolveu uma tradução vazia.')
    saveMcpTranslation(db, toolName, originalDescription, translated)
    return translated
  })

  handle(channels.mcpRetranslateAll, async () => {
    clearMcpAutoTranslations(db)
    await mcpService.retranslateAll()
  })

  handle(channels.mcpImport, async () => {
    const win = ctx.getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { title: 'Importar mcp.json', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
      : await dialog.showOpenDialog({ title: 'Importar mcp.json', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (res.canceled || !res.filePaths[0]) return mcpService.list()
    const imported = importFromFile(res.filePaths[0])
    const existing = loadMcpFile(ctx.dataDir)
    const merged = [...existing]
    for (const ie of imported) {
      if (!merged.some((e) => e.name === ie.name)) merged.push(ie)
    }
    saveMcpFile(ctx.dataDir, merged)
    loadMcpInBackground(merged)
    return mcpService.list()
  })

  handle(channels.mcpApprovalRespond, (rawRequestId, rawApproved) => {
    const { requestId, approved } = mcpApprovalInput.parse({ requestId: rawRequestId, approved: rawApproved })
    mcpService.respondApproval(requestId, approved)
  })

  handle(channels.mcpApprovalConversation, (rawConversationId, rawApproved) => {
    const conversationId = id(rawConversationId)
    const approved = z.boolean().parse(rawApproved)
    return mcpService.setConversationApproval(conversationId, approved)
  })

  handle(channels.mcpApprovalAll, (rawApproved) => mcpService.respondApprovals(z.boolean().parse(rawApproved)))
  handle(channels.mcpApprovalPending, () => mcpService.listPendingApprovals())

  handle(channels.mcpApprovalAlwaysAllow, (rawAgentId, rawServer, rawTool) => {
    const agentId = id(rawAgentId)
    const serverName = z.string().min(1).max(80).parse(rawServer)
    const toolName = z.string().min(1).max(200).parse(rawTool)
    setApproval(db, agentId, serverName, toolName, 'allow')
    mcpService.respondApprovalForTool(agentId, serverName, toolName, true)
  })

  handle(channels.mcpGetApprovals, (rawAgentId) => getApprovals(db, id(rawAgentId)))

  handle(channels.mcpSetApproval, (rawAgentId, rawServer, rawTool, rawApproval) => {
    const agentId = id(rawAgentId)
    const serverName = z.string().min(1).max(80).parse(rawServer)
    const toolName = z.string().min(1).max(200).parse(rawTool)
    const approval = z.enum(['ask', 'allow', 'block']).parse(rawApproval) as McpToolApproval
    setApproval(db, agentId, serverName, toolName, approval)
  })

  handle(channels.mcpRemoveApproval, (rawAgentId, rawServer, rawTool) => {
    const agentId = id(rawAgentId)
    const serverName = z.string().min(1).max(80).parse(rawServer)
    const toolName = z.string().min(1).max(200).parse(rawTool)
    removeApproval(db, agentId, serverName, toolName)
  })

  handle(channels.settingsDataDir, () => ctx.dataDir)
  handle(channels.settingsOpenDataDir, async () => {
    await shell.openPath(ctx.dataDir)
  })
  handle(channels.settingsBackup, async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const win = ctx.getWindow()
    const options = {
      title: 'Salvar backup do banco',
      defaultPath: `ch-bots-backup-${stamp}.db`,
      filters: [{ name: 'Banco SQLite', extensions: ['db'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const target = z.string().min(1).parse(result.filePath)
    // VACUUM INTO recusa arquivo existente; o diálogo já confirmou a substituição.
    rmSync(target, { force: true })
    db.prepare('VACUUM INTO ?').run(target)
    return target
  })

  // ---- Pages ----
  handle(channels.pagesList, () => listPages(db))
  handle(channels.pagesGet, (rawId) => getPageRecord(db, id(rawId)))
  handle(channels.pagesDelete, (rawId) => { deletePage(db, id(rawId)) })

  // ---- Canais externos (rascunhos de envio) ----
  handle(channels.draftRespond, (rawDraftId, approve) => {
    ctx.resolveDraft(id(rawDraftId), Boolean(approve))
  })

  // ---- Verificador de Fontes ----
  handle(channels.verificacoesList, (rawId) => ctx.verificador?.listSummary(id(rawId)) ?? null)
}
