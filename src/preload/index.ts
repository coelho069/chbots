import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { channels as c, events } from '@shared/ipc'
import type { FlowStepEvent } from '@shared/flows'
import type { ChatChunk, DelegationCard, FlowInterruptEvent, McpApprovalRequest, McpToolCallEvent, PageRecord, PilotosApi, SendDraft } from '@shared/types'
import type { OfficeEvent } from '@shared/office'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// API mínima e tipada; o renderer não tem acesso ao ipcRenderer em si.
const api: PilotosApi = {
  providers: {
    list: () => invoke(c.providersList),
    create: (input) => invoke(c.providersCreate, input),
    update: (id, input) => invoke(c.providersUpdate, id, input),
    remove: (id) => invoke(c.providersRemove, id),
    listModels: (id) => invoke(c.providersModels, id)
  },
  agents: {
    list: () => invoke(c.agentsList),
    create: (input) => invoke(c.agentsCreate, input),
    update: (id, input) => invoke(c.agentsUpdate, id, input),
    duplicate: (id) => invoke(c.agentsDuplicate, id),
    remove: (id) => invoke(c.agentsRemove, id)
  },
  conversations: {
    list: (agentId) => invoke(c.conversationsList, agentId),
    create: (agentId) => invoke(c.conversationsCreate, agentId),
    remove: (id) => invoke(c.conversationsRemove, id),
    messages: (id, beforeId?) => invoke(c.conversationsMessages, id, beforeId)
  },
  chat: {
    send: (conversationId, text, attachments?) => invoke(c.chatSend, conversationId, text, attachments),
    stop: (conversationId) => invoke(c.chatStop, conversationId),
    handoff: (input) => invoke(c.chatHandoff, input),
    onChunk: (listener) => subscribe<ChatChunk>(events.chatChunk, listener)
  },
  routines: {
    list: () => invoke(c.routinesList),
    create: (input) => invoke(c.routinesCreate, input),
    update: (id, input) => invoke(c.routinesUpdate, id, input),
    remove: (id) => invoke(c.routinesRemove, id),
    runNow: (id) => invoke(c.routinesRunNow, id),
    runs: (routineId) => invoke(c.routinesRuns, routineId),
    onRunsChanged: (listener) => subscribe<void>(events.runsChanged, () => listener())
  },
  settings: {
    get: () => invoke(c.settingsGet),
    update: (input) => invoke(c.settingsUpdate, input),
    dataDir: () => invoke(c.settingsDataDir),
    openDataDir: () => invoke(c.settingsOpenDataDir),
    backup: () => invoke(c.settingsBackup)
  },
  app: {
    askUnsaved: (detail, canSave) => invoke(c.appAskUnsaved, detail, canSave),
    onCloseCurrent: (listener) => subscribe<void>(events.closeCurrent, () => listener())
  },
  prompts: {
    correct: (agentId, idea) => invoke(c.promptsCorrect, agentId, idea),
    generate: (input) => invoke(c.promptsGenerate, input),
    list: () => invoke(c.promptsList),
    remove: (id) => invoke(c.promptsRemove, id),
    saveMarkdown: (content, suggestedName) => invoke(c.promptsSaveMd, content, suggestedName)
  },
  blackbox: {
    list: (filters) => invoke(c.blackboxList, filters),
    activeCount: () => invoke(c.blackboxActiveCount),
    exportCsv: (filters) => invoke(c.blackboxExportCsv, filters)
  },
  memory: {
    search: (query, limit) => invoke(c.memorySearch, query, limit),
    list: (filters) => invoke(c.memoryList, filters),
    save: (input) => invoke(c.memorySave, input),
    edit: (id, patch) => invoke(c.memoryEdit, id, patch),
    merge: (keepId, removeId) => invoke(c.memoryMerge, keepId, removeId),
    archive: (id) => invoke(c.memoryArchive, id),
    delete: (id) => invoke(c.memoryDelete, id),
    confirm: (id) => invoke(c.memoryConfirm, id),
    export: () => invoke(c.memoryExport),
    import: (json) => invoke(c.memoryImport, json),
    categoriesList: () => invoke(c.memoryCategoriesList),
    categoriesSave: (nome, cor) => invoke(c.memoryCategoriesSave, nome, cor),
    categoriesDelete: (nome, mergeTo) => invoke(c.memoryCategoriesDelete, nome, mergeTo),
    ligacoesList: (filters) => invoke(c.memoryLigacoesList, filters),
    ligacoesSave: (origemId, destinoId) => invoke(c.memoryLigacoesSave, origemId, destinoId),
    ligacoesDelete: (id) => invoke(c.memoryLigacoesDelete, id),
    positionsSave: (positions) => invoke(c.memoryPositionsSave, positions),
    positionsList: () => invoke(c.memoryPositionsList),
    graphGroupsList: () => invoke(c.memoryGraphGroupsList),
    graphGroupsSave: (input) => invoke(c.memoryGraphGroupsSave, input),
    graphGroupsDelete: (id) => invoke(c.memoryGraphGroupsDelete, id),
    graphConfigGet: () => invoke(c.memoryGraphConfigGet),
    graphConfigSave: (config) => invoke(c.memoryGraphConfigSave, config)
  },
  delegation: {
    getConfig: (agentId) => invoke(c.delegationConfigGet, agentId),
    saveConfig: (config) => invoke(c.delegationConfigSave, config),
    list: (conversaId) => invoke(c.delegationList, conversaId),
    onCard: (listener) => subscribe<DelegationCard>(events.delegationCard, listener)
  },
  perf: {
    stats: () => invoke(c.perfStats),
    clearCache: () => invoke(c.perfClearCache),
    optimize: () => invoke(c.perfOptimize)
  },
  flows: {
    list: () => invoke(c.flowsList),
    get: (id) => invoke(c.flowsGet, id),
    create: (meta) => invoke(c.flowsCreate, meta),
    save: (id, input) => invoke(c.flowsSave, id, input),
    remove: (id) => invoke(c.flowsRemove, id),
    run: (id) => invoke(c.flowsRun, id),
    runs: (flowId) => invoke(c.flowsRuns, flowId),
    steps: (runId) => invoke(c.flowsRunSteps, runId),
    cancel: (runId) => invoke(c.flowsCancel, runId),
    status: (runId) => invoke(c.flowsStatus, runId),
    interruptRespond: (runId, approved) => invoke(c.flowsInterruptRespond, runId, approved),
    onStep: (listener) => subscribe<FlowStepEvent>(events.flowStep, listener),
    onRunsChanged: (listener) => subscribe<number>(events.flowRunsChanged, listener),
    onInterrupt: (listener) => subscribe<FlowInterruptEvent>(events.flowInterrupt, listener)
  },
  mcp: {
    list: () => invoke(c.mcpList),
    add: (name, config, enabled) => invoke(c.mcpAdd, name, config, enabled),
    update: (name, config) => invoke(c.mcpUpdate, name, config),
    remove: (name) => invoke(c.mcpRemove, name),
    toggle: (name, enabled) => invoke(c.mcpToggle, name, enabled),
    restart: (name) => invoke(c.mcpRestart, name),
    callTool: (serverName, toolName, args) => invoke(c.mcpCallTool, serverName, toolName, args),
    translateTool: (toolName, description) => invoke(c.mcpTranslateTool, toolName, description),
    retranslateAll: () => invoke(c.mcpRetranslateAll),
    importConfig: () => invoke(c.mcpImport),
    approvalRespond: (requestId, approved) => invoke(c.mcpApprovalRespond, requestId, approved),
    approveConversation: (conversationId, approved) => invoke(c.mcpApprovalConversation, conversationId, approved),
    approveAllPending: (approved) => invoke(c.mcpApprovalAll, approved),
    pendingApprovals: () => invoke(c.mcpApprovalPending),
    alwaysAllow: (agentId, serverName, toolName) => invoke(c.mcpApprovalAlwaysAllow, agentId, serverName, toolName),
    getApprovals: (agentId) => invoke(c.mcpGetApprovals, agentId),
    setApproval: (agentId, serverName, toolName, value) => invoke(c.mcpSetApproval, agentId, serverName, toolName, value),
    removeApproval: (agentId, serverName, toolName) => invoke(c.mcpRemoveApproval, agentId, serverName, toolName),
    onStatusChanged: (listener) => subscribe<void>(events.mcpStatusChanged, () => listener()),
    onApprovalRequest: (listener) => subscribe<McpApprovalRequest>(events.mcpApprovalRequest, listener),
    onToolCall: (listener) => subscribe<McpToolCallEvent>(events.mcpToolCall, listener)
  },
  office: {
    onEvent: (listener: (evs: OfficeEvent[]) => void) => subscribe<OfficeEvent[]>('escritorio:evento', listener),
    getEstado: () => ipcRenderer.invoke('escritorio:getEstado')
  },
  pages: {
    list: () => invoke(c.pagesList),
    get: (id: number) => invoke(c.pagesGet, id),
    delete: (id: number) => invoke(c.pagesDelete, id),
    onOpen: (listener: (page: PageRecord) => void) => subscribe<PageRecord>(events.pageOpen, listener)
  },
  drafts: {
    respond: (draftId: number, approve: boolean) => invoke(c.draftRespond, draftId, approve),
    onPending: (listener: (draft: SendDraft) => void) => subscribe<SendDraft>(events.draftPending, listener)
  }
}

contextBridge.exposeInMainWorld('pilotos', api)
