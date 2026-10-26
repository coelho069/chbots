// Tipos e regras de grafo dos Fluxos. Sem dependências: usado pelo main e pela UI.

export const MAX_FLOW_NODES = 10

export const flowNodeTypes = ['trigger', 'news', 'promptgen', 'agent', 'condition', 'output', 'memory', 'delegate', 'mcp-tool', 'claude-code'] as const
export type FlowNodeType = (typeof flowNodeTypes)[number]

export const flowNodeLabels: Record<FlowNodeType, string> = {
  trigger: 'Gatilho',
  news: 'Buscar notícias',
  promptgen: 'Gerador de Prompt',
  agent: 'Agente',
  condition: 'Condição',
  output: 'Saída',
  memory: 'Memória',
  delegate: 'Delegar',
  'mcp-tool': 'Ferramenta MCP',
  'claude-code': 'Claude Code'
}

// Edições do Google Notícias: idioma da interface (hl), país (gl) e edição (ceid).
export const newsLanguages = {
  'pt-BR': { label: 'Português (Brasil)', hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
  'pt-PT': { label: 'Português (Portugal)', hl: 'pt-PT', gl: 'PT', ceid: 'PT:pt-150' },
  'en-US': { label: 'Inglês (EUA)', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  'es-419': { label: 'Espanhol (América Latina)', hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' }
} as const
export type NewsLanguage = keyof typeof newsLanguages
export const newsLanguageCodes = Object.keys(newsLanguages) as NewsLanguage[]
export const MAX_NEWS_COUNT = 30

export interface TriggerData {
  mode: 'manual' | 'schedule'
  cron: string
  input: string
}

export interface AgentNodeData {
  agentId: number | null
  refinePrompt: string
  timeoutSec: number
  // false (padrão): usa só a saída do predecessor imediato quando há múltiplas entradas
  includeAllInputs: boolean
}

export interface ConditionData {
  operator: 'contains' | 'not_contains'
  value: string
  caseSensitive: boolean
}

export interface OutputData {
  action: 'save_md' | 'notify'
  // vazio = pasta padrão (Documentos\CH BOTS)
  folder: string
  fileName: string
  title: string
  timeoutSec: number
}

export interface NewsData {
  topic: string
  language: NewsLanguage
  count: number
  timeoutSec: number
}

// Corrige a ideia recebida e a transforma num prompt longo (as mesmas etapas da tela Gerador de Prompts).
export interface PromptGenNodeData {
  agentId: number | null
  // cobre a correção, a geração e até 2 expansões
  timeoutSec: number
}

export interface MemoryNodeData {
  mode: 'save' | 'search'
  categories: string[]
  limit: number
  source: string
  timeoutSec: number
}

export interface DelegateNodeData {
  agentId: number | null
  timeoutSec: number
}

export interface McpToolNodeData {
  serverName: string
  toolName: string
  // JSON args; supports {{entrada}} interpolation
  args: string
  timeoutSec: number
}

// Roda o Claude Code CLI local (Ollama). Tarefa vazia = usa a entrada; aceita {{entrada}}.
export interface ClaudeCodeNodeData {
  tarefa: string
  pasta: string
  modelo: string
  timeoutSec: number
}

export interface FlowNodeDataMap {
  trigger: TriggerData
  news: NewsData
  promptgen: PromptGenNodeData
  agent: AgentNodeData
  condition: ConditionData
  output: OutputData
  memory: MemoryNodeData
  delegate: DelegateNodeData
  'mcp-tool': McpToolNodeData
  'claude-code': ClaudeCodeNodeData
}

export type FlowNode = {
  [T in FlowNodeType]: { id: string; type: T; data: FlowNodeDataMap[T]; position: { x: number; y: number } }
}[FlowNodeType]

export type ConditionBranch = 'true' | 'false'

export interface FlowEdge {
  id: string
  source: string
  target: string
  // só em arestas que saem de uma condição
  conditionValue: ConditionBranch | null
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface Flow {
  id: number
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface FlowSummary extends Flow {
  nodeCount: number
  schedule: string | null
}

export interface FlowDetail extends Flow {
  graph: FlowGraph
}

export interface FlowSaveInput {
  name: string
  description: string
  graph: FlowGraph
}

export type StepStatus = 'running' | 'success' | 'error' | 'skipped'
export type FlowRunStatus = 'running' | 'ok' | 'error'

export interface FlowRun {
  id: number
  flowId: number
  trigger: 'manual' | 'schedule'
  startedAt: string
  finishedAt: string | null
  status: FlowRunStatus
  path: string[]
  error: string | null
}

export interface FlowRunStep {
  id: number
  runId: number
  nodeId: string
  status: StepStatus
  input: string
  output: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface FlowStepEvent {
  flowId: number
  runId: number
  step: FlowRunStep
}

export const defaultTimeoutSec = 120

export function defaultNodeData<T extends FlowNodeType>(type: T): FlowNodeDataMap[T] {
  const defaults: FlowNodeDataMap = {
    trigger: { mode: 'manual', cron: '0 8 * * *', input: '' },
    news: { topic: '', language: 'pt-BR', count: 10, timeoutSec: 30 },
    promptgen: { agentId: null, timeoutSec: 300 },
    agent: { agentId: null, refinePrompt: '', timeoutSec: defaultTimeoutSec, includeAllInputs: false },
    condition: { operator: 'contains', value: '', caseSensitive: false },
    output: { action: 'save_md', folder: '', fileName: '{fluxo}-{data}.md', title: '', timeoutSec: 30 },
    memory: { mode: 'save', categories: [], limit: 10, source: '', timeoutSec: 30 },
    delegate: { agentId: null, timeoutSec: 120 },
    'mcp-tool': { serverName: '', toolName: '', args: '{}', timeoutSec: 60 },
    'claude-code': { tarefa: '', pasta: '', modelo: 'qwen2.5:0.5b', timeoutSec: 300 }
  }
  return defaults[type]
}

export const triggerOf = (graph: FlowGraph) =>
  graph.nodes.find((n): n is Extract<FlowNode, { type: 'trigger' }> => n.type === 'trigger')

// Nome curto para mensagens: "Condição 2" = segunda condição na ordem do grafo.
export function nodeRef(graph: FlowGraph, id: string): string {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return `nó ${id.slice(0, 6)}`
  const sameType = graph.nodes.filter((n) => n.type === node.type)
  const label = flowNodeLabels[node.type]
  return sameType.length > 1 ? `${label} ${sameType.indexOf(node) + 1}` : label
}

// true se ligar source → target fecharia um ciclo (target já alcança source).
export function wouldCreateCycle(edges: Pick<FlowEdge, 'source' | 'target'>[], source: string, target: string): boolean {
  if (source === target) return true
  const stack = [target]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === source) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const e of edges) if (e.source === current) stack.push(e.target)
  }
  return false
}

// Ordem topológica (Kahn), estável pela ordem dos nós. Nós em ciclo ficam de fora.
export function topologicalOrder(graph: FlowGraph): { order: string[]; cyclic: string[] } {
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]))
  for (const e of graph.edges) if (indegree.has(e.target)) indegree.set(e.target, indegree.get(e.target)! + 1)
  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const e of graph.edges) {
      if (e.source !== id || !indegree.has(e.target)) continue
      const left = indegree.get(e.target)! - 1
      indegree.set(e.target, left)
      if (left === 0) queue.push(e.target)
    }
  }
  const done = new Set(order)
  return { order, cyclic: graph.nodes.filter((n) => !done.has(n.id)).map((n) => n.id) }
}

export function reachableFrom(graph: FlowGraph, start: string): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of graph.edges) if (e.source === id) stack.push(e.target)
  }
  return seen
}

// Regras de estrutura e de dados. Lista vazia = grafo válido.
export function validateGraph(graph: FlowGraph): string[] {
  const errors: string[] = []
  const ref = (id: string) => nodeRef(graph, id)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  if (graph.nodes.length > MAX_FLOW_NODES) errors.push(`O fluxo tem ${graph.nodes.length} nós; o limite é ${MAX_FLOW_NODES}.`)
  if (byId.size !== graph.nodes.length) errors.push('Há nós com identificador repetido.')

  const triggers = graph.nodes.filter((n) => n.type === 'trigger')
  if (triggers.length === 0) errors.push('O fluxo precisa de um Gatilho.')
  if (triggers.length > 1) errors.push('O fluxo só pode ter um Gatilho.')

  const edgeKeys = new Set<string>()
  for (const e of graph.edges) {
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    if (!source || !target) {
      errors.push('Há uma ligação apontando para um nó que não existe.')
      continue
    }
    if (e.source === e.target) errors.push(`${ref(e.source)} está ligado a ele mesmo.`)
    if (target.type === 'trigger') errors.push('O Gatilho não pode receber ligações.')
    if (source.type === 'output') errors.push(`${ref(e.source)} é uma Saída e não pode ter ligações saindo dela.`)
    if (source.type === 'condition' && e.conditionValue === null)
      errors.push(`Ligação de ${ref(e.source)} precisa sair por "Sim" ou "Não".`)
    if (source.type !== 'condition' && e.conditionValue !== null)
      errors.push(`Ligação de ${ref(e.source)} não pode ter valor de condição.`)
    const key = `${e.source}>${e.target}>${e.conditionValue}`
    if (edgeKeys.has(key)) errors.push(`Ligação repetida entre ${ref(e.source)} e ${ref(e.target)}.`)
    edgeKeys.add(key)
  }

  const { cyclic } = topologicalOrder(graph)
  if (cyclic.length > 0) errors.push(`Há um ciclo envolvendo: ${cyclic.map(ref).join(', ')}.`)

  if (triggers.length === 1) {
    const reachable = reachableFrom(graph, triggers[0]!.id)
    const loose = graph.nodes.filter((n) => !reachable.has(n.id))
    if (loose.length > 0) errors.push(`Não ligados ao Gatilho: ${loose.map((n) => ref(n.id)).join(', ')}.`)
  }

  for (const n of graph.nodes) {
    if (n.type === 'trigger' && n.data.mode === 'schedule' && !n.data.cron.trim())
      errors.push('Gatilho agendado precisa de um horário.')
    if ((n.type === 'agent' || n.type === 'promptgen' || n.type === 'delegate') && n.data.agentId === null) errors.push(`${ref(n.id)}: escolha um agente.`)
    if (n.type === 'memory' && n.data.mode === 'save' && !n.data.source.trim()) errors.push(`${ref(n.id)}: informe a fonte.`)
    if (n.type === 'condition' && !n.data.value) errors.push(`${ref(n.id)}: informe o texto a procurar.`)
    if (n.type === 'news' && !n.data.topic.trim()) errors.push(`${ref(n.id)}: informe o tema.`)
    if (n.type === 'claude-code' && !n.data.pasta.trim()) errors.push(`${ref(n.id)}: informe a pasta.`)
    if (n.type === 'claude-code' && !n.data.modelo.trim()) errors.push(`${ref(n.id)}: informe o modelo.`)
  }
  return errors
}
