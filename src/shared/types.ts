import type { FlowDetail, FlowRun, FlowRunStep, FlowSaveInput, FlowStepEvent, FlowSummary } from './flows'

export interface FlowInterruptEvent {
  runId: number
  flowId: number
  nodeId: string
  nodeType: string
  description: string
}

export interface FlowRunState {
  vars: Record<string, string>
  ultimoResultado: string
  activeNodeId: string
}
import type { AgentInput, HandoffInput, PromptGenerateInput, ProviderInput, RoutineInput } from './schemas'
import type { McpApprovalMap, McpApprovalRequest, McpCallResult, McpServerInfo, McpToolRef } from './mcp'

export interface Attachment {
  name: string
  mediaType: string
  data: string   // base64
  size: number
}

export const providerKinds = ['openai', 'anthropic', 'ollama'] as const
export type ProviderKind = (typeof providerKinds)[number]

export const providerKindLabels: Record<ProviderKind, string> = {
  openai: 'Compatível com OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama (local)'
}

export const defaultBaseUrls: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://127.0.0.1:11434'
}

export interface Provider {
  id: number
  kind: ProviderKind
  name: string
  baseUrl: string
  hasKey: boolean
  createdAt: string
}

export interface Agent {
  id: number
  name: string
  color: string
  systemPrompt: string
  providerId: number
  model: string
  temperature: number
  usarCache: boolean
  mcpTools: { serverName: string; toolName: string }[]
  createdAt: string
  updatedAt: string
}

export type ConversationOrigin = 'manual' | 'handoff' | 'routine'

export interface Conversation {
  id: number
  agentId: number
  title: string
  origin: ConversationOrigin
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'system' | 'user' | 'assistant'

export interface Message {
  id: number
  conversationId: number
  role: MessageRole
  content: string
  fromAgentId: number | null
  tokensIn: number | null
  tokensOut: number | null
  createdAt: string
}

export interface Routine {
  id: number
  name: string
  cron: string
  sourceAgentId: number
  taskPrompt: string
  targetAgentId: number | null
  handoffPrompt: string | null
  enabled: boolean
  lastRunAt: string | null
  createdAt: string
  lastOutputHash: string | null
  notifyOnlyWhenChanged: boolean
}

export type RunStatus = 'running' | 'ok' | 'error'

export interface RoutineRun {
  id: number
  routineId: number
  startedAt: string
  finishedAt: string | null
  status: RunStatus
  sourceConversationId: number | null
  targetConversationId: number | null
  error: string | null
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

// ---- Gerador de Prompts ----

export const MIN_PROMPT_CHARS = 3000
export const MAX_PROMPT_EXPANSIONS = 2
export const PROMPT_CALL_TIMEOUT_SEC = 60
export const PROMPT_HISTORY_LIMIT = 20

export interface GeneratedPrompt {
  id: number
  originalIdea: string
  correctedIdea: string
  prompt: string
  chars: number
  // null se o agente foi excluído depois
  agentId: number | null
  createdAt: string
}

export interface PromptGenResult {
  record: GeneratedPrompt
  // quantas vezes foi preciso pedir para expandir (0 a MAX_PROMPT_EXPANSIONS)
  expansions: number
}

export interface Settings {
  minimizeToTray: boolean
  notifyOnRun: boolean
  retentionDays: number
}

export const defaultSettings: Settings = { minimizeToTray: true, notifyOnRun: true, retentionDays: 30 }

// ---- Cache / Desempenho ----

export interface CacheStats {
  dbSizeMb: number
  cacheRows: number
  cacheHits: number
  cacheMisses: number
  tokensSaved: number
  oldestEntry: string | null
}

// ---- Caixa-Preta ----

export interface BlackBoxFilters {
  tipo?: 'fluxo' | 'rotina'
  apenasErros?: boolean
  agentId?: number
  fluxoId?: number
  busca?: string
}

export interface BlackBoxEntry {
  tipo: 'fluxo' | 'rotina'
  execucaoId: number
  nome: string
  status: 'running' | 'ok' | 'error'
  agentId: number | null
  fluxoId: number | null
  iniciadoEm: string
  finalizadoEm: string | null
  erro: string | null
}

// ---- Memória ----

export interface MemoryCategoria { id: number; nome: string; cor: string }

export interface MemorySource {
  id: number; fatoId: number; fonte: string
  tipo: 'usuario' | 'arquivo' | 'site' | 'modelo' | 'conversa'
  dateFonte: string | null; trecho: string | null; criadoEm: string
}

export interface MemoryFato {
  id: number; fato: string; categoria: string; confianca: number
  status: 'ativo' | 'conflito' | 'arquivado'
  confirmacoes: number; criadoEm: string; atualizadoEm: string
  fontes: MemorySource[]
}

export interface MemoryFilters {
  query?: string; categoria?: string
  status?: 'ativo' | 'conflito' | 'arquivado'
  orderBy?: 'confianca' | 'criado_em'
}

export interface MemoryImportResult { imported: number; skipped: number }

export type LigacaoTipo = 'mesma_fonte' | 'mesma_entidade' | 'similar' | 'conflito' | 'manual'

export interface MemoryLigacao {
  id: number; origemId: number; destinoId: number
  tipo: LigacaoTipo; peso: number; criadoEm: string
}

export interface LigacoesFilters { tipo?: LigacaoTipo; categoria?: string }

export interface NodePosition { fatoId: number; x: number; y: number }

export interface GraphGroup { id: number; nome: string; consulta: string; cor: string }

export interface GraphConfig {
  showOrphans: boolean; showEntities: boolean; showConflicts: boolean
  showArrows: boolean; showLinkLabels: boolean; nodeSize: number; linkWidth: number; textFade: number
  centerForce: number; repelForce: number; linkForce: number; linkDistance: number
  localDepth: number; panelOpen: boolean
}

export const defaultGraphConfig: GraphConfig = {
  showOrphans: true, showEntities: true, showConflicts: true,
  showArrows: false, showLinkLabels: false, nodeSize: 100, linkWidth: 100, textFade: 1.5,
  centerForce: 20, repelForce: 120, linkForce: 50, linkDistance: 60,
  localDepth: 1, panelOpen: false
}

// ---- Delegação entre bots ----

export interface DelegationConfig {
  agentId: number
  podeDelegar: boolean
  podeReceber: boolean
  destinosPermitidos: number[]   // IDs dos agentes que este pode chamar
  maxProfundidade: number        // padrão 2
  maxPorResposta: number         // padrão 3
}

export type DelegationStatus = 'running' | 'ok' | 'error'

export interface DelegationEntry {
  id: number
  conversaId: number
  botOrigemId: number
  botDestinoId: number
  tarefa: string
  resposta: string | null
  status: DelegationStatus
  profundidade: number
  iniciadoEm: string
  finalizadoEm: string | null
  erro: string | null
}

// Evento enviado do main → renderer enquanto a delegação acontece
export interface DelegationCard {
  id: number
  conversaId: number
  botDestinoNome: string
  tarefa: string
  resposta: string | null
  status: DelegationStatus
  iniciadoEm: string
  finalizadoEm: string | null
  erro: string | null
}

// Tipos das entradas; os validadores ficam em schemas.ts (só o main carrega o zod).
export type { AgentInput, HandoffInput, PromptGenerateInput, ProviderInput, RoutineInput }
export type { McpApprovalMap, McpApprovalRequest, McpCallResult, McpServerInfo, McpToolRef }
export type { BotActivityState, BotDeskState, OfficeEvent } from './office'

// ---- Pages ----

export interface PageRecord {
  id: number
  title: string
  html: string
  createdAt: string
  updatedAt: string
}

// ---- Canais externos (e-mail, Slack) ----

export interface SendDraft {
  id: number
  tool: 'send_email' | 'send_slack'
  conversationId: number
  recipient: string
  subject: string | null
  body: string
  status: 'pending' | 'sent' | 'discarded'
  createdAt: string
}

// ---- Eventos enviados do main para o renderer ----

export interface McpToolCallEvent {
  conversationId: number
  serverName: string
  toolName: string
  args: Record<string, unknown>
  result?: McpCallResult
  status: 'calling' | 'done' | 'error' | 'denied'
}

export interface ChatChunk {
  conversationId: number
  delta: string
  // true no último aviso: a resposta (ou o erro) já está gravada no banco.
  done?: boolean
}

export interface HandoffResult {
  conversationId: number
  reply: Message
}

// ---- API exposta no renderer (window.pilotos) ----

export interface MemorySaveInput {
  fato: string; categoria: string
  fonte: string; tipo: MemorySource['tipo']
  dateFonte?: string | null; trecho?: string | null; confianca?: number
}

export interface PilotosApi {
  providers: {
    list(): Promise<Provider[]>
    create(input: ProviderInput): Promise<Provider>
    update(id: number, input: ProviderInput): Promise<Provider>
    remove(id: number): Promise<void>
    listModels(id: number): Promise<string[]>
  }
  agents: {
    list(): Promise<Agent[]>
    create(input: AgentInput): Promise<Agent>
    update(id: number, input: AgentInput): Promise<Agent>
    duplicate(id: number): Promise<Agent>
    remove(id: number): Promise<void>
  }
  conversations: {
    list(agentId: number): Promise<Conversation[]>
    create(agentId: number): Promise<Conversation>
    remove(id: number): Promise<void>
    messages(id: number, beforeId?: number): Promise<Message[]>
  }
  chat: {
    send(conversationId: number, text: string, attachments?: Attachment[]): Promise<Message>
    stop(conversationId: number): Promise<void>
    handoff(input: HandoffInput): Promise<HandoffResult>
    onChunk(listener: (chunk: ChatChunk) => void): () => void
  }
  blackbox: {
    list(filters?: BlackBoxFilters): Promise<BlackBoxEntry[]>
    activeCount(): Promise<number>
    exportCsv(filters?: BlackBoxFilters): Promise<string>
  }
  routines: {
    list(): Promise<Routine[]>
    create(input: RoutineInput): Promise<Routine>
    update(id: number, input: RoutineInput): Promise<Routine>
    remove(id: number): Promise<void>
    runNow(id: number): Promise<RoutineRun>
    runs(routineId: number | null): Promise<RoutineRun[]>
    onRunsChanged(listener: () => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(input: Settings): Promise<Settings>
    dataDir(): Promise<string>
    openDataDir(): Promise<void>
    backup(): Promise<string | null>
  }
  perf: {
    stats(): Promise<CacheStats>
    clearCache(): Promise<void>
    optimize(): Promise<void>
  }
  app: {
    // pergunta nativa; canSave=false mostra só Descartar/Cancelar
    askUnsaved(detail: string, canSave: boolean): Promise<UnsavedChoice>
    onCloseCurrent(listener: () => void): () => void
  }
  prompts: {
    correct(agentId: number, idea: string): Promise<string>
    generate(input: PromptGenerateInput): Promise<PromptGenResult>
    list(): Promise<GeneratedPrompt[]>
    remove(id: number): Promise<void>
    // abre "Salvar como"; null se o usuário cancelar
    saveMarkdown(content: string, suggestedName: string): Promise<string | null>
  }
  memory: {
    search(query: string, limit?: number): Promise<MemoryFato[]>
    list(filters?: MemoryFilters): Promise<MemoryFato[]>
    save(input: MemorySaveInput): Promise<{ action: string; fatoId: number }>
    edit(id: number, patch: { fato?: string; categoria?: string; confianca?: number }): Promise<void>
    merge(keepId: number, removeId: number): Promise<void>
    archive(id: number): Promise<void>
    delete(id: number): Promise<void>
    confirm(id: number): Promise<void>
    export(): Promise<string>
    import(json: string): Promise<MemoryImportResult>
    categoriesList(): Promise<MemoryCategoria[]>
    categoriesSave(nome: string, cor: string): Promise<MemoryCategoria>
    categoriesDelete(nome: string, mergeTo: string): Promise<void>
    ligacoesList(filters?: LigacoesFilters): Promise<MemoryLigacao[]>
    ligacoesSave(origemId: number, destinoId: number): Promise<MemoryLigacao>
    ligacoesDelete(id: number): Promise<void>
    positionsSave(positions: NodePosition[]): Promise<void>
    positionsList(): Promise<NodePosition[]>
    graphGroupsList(): Promise<GraphGroup[]>
    graphGroupsSave(input: { id?: number; nome: string; consulta: string; cor: string }): Promise<GraphGroup>
    graphGroupsDelete(id: number): Promise<void>
    graphConfigGet(): Promise<GraphConfig | null>
    graphConfigSave(config: GraphConfig): Promise<void>
  }
  delegation: {
    getConfig(agentId: number): Promise<DelegationConfig>
    saveConfig(config: DelegationConfig): Promise<void>
    list(conversaId: number): Promise<DelegationEntry[]>
    onCard(listener: (card: DelegationCard) => void): () => void
  }
  flows: {
    list(): Promise<FlowSummary[]>
    get(id: number): Promise<FlowDetail>
    create(meta: { name: string; description: string }): Promise<FlowDetail>
    save(id: number, input: FlowSaveInput): Promise<FlowDetail>
    remove(id: number): Promise<void>
    run(id: number): Promise<FlowRun>
    runs(flowId: number): Promise<FlowRun[]>
    steps(runId: number): Promise<FlowRunStep[]>
    cancel(runId: number): Promise<void>
    status(runId: number): Promise<FlowRunState | null>
    interruptRespond(runId: number, approved: boolean): Promise<void>
    onStep(listener: (event: FlowStepEvent) => void): () => void
    onRunsChanged(listener: (flowId: number) => void): () => void
    onInterrupt(listener: (event: FlowInterruptEvent) => void): () => void
  }
  mcp: {
    list(): Promise<McpServerInfo[]>
    add(name: string, config: unknown, enabled?: boolean): Promise<McpServerInfo[]>
    update(name: string, config: unknown): Promise<McpServerInfo[]>
    remove(name: string): Promise<McpServerInfo[]>
    toggle(name: string, enabled: boolean): Promise<McpServerInfo[]>
    restart(name: string): Promise<void>
    callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult>
    translateTool(toolName: string, description: string): Promise<string>
    retranslateAll(): Promise<void>
    importConfig(): Promise<McpServerInfo[]>
    approvalRespond(requestId: string, approved: boolean): Promise<void>
    approveConversation(conversationId: number, approved: boolean): Promise<number>
    approveAllPending(approved: boolean): Promise<number>
    pendingApprovals(): Promise<(McpApprovalRequest & { agentId?: number })[]>
    alwaysAllow(agentId: number, serverName: string, toolName: string): Promise<void>
    getApprovals(agentId: number): Promise<McpApprovalMap>
    setApproval(agentId: number, serverName: string, toolName: string, value: string): Promise<void>
    removeApproval(agentId: number, serverName: string, toolName: string): Promise<void>
    onStatusChanged(listener: () => void): () => void
    onApprovalRequest(listener: (req: McpApprovalRequest) => void): () => void
    onToolCall(listener: (event: McpToolCallEvent) => void): () => void
  }
  office: {
    onEvent(listener: (evs: import('./office').OfficeEvent[]) => void): () => void
    getEstado(): Promise<import('./office').BotDeskState[]>
  }
  pages: {
    list(): Promise<PageRecord[]>
    get(id: number): Promise<PageRecord | null>
    delete(id: number): Promise<void>
    onOpen(listener: (page: PageRecord) => void): () => void
  }
  drafts: {
    respond(draftId: number, approve: boolean): Promise<void>
    onPending(listener: (draft: SendDraft) => void): () => void
  }
}
