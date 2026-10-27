import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph'
import {
  buildAgentPrompt,
  evaluateCondition,
  type EngineActions,
  type StepUpdate
} from './engine'
import { nodeRef, triggerOf, validateGraph, type FlowGraph, type FlowNode, type StepStatus } from '@shared/flows'
import type { SqliteCheckpointer } from './langgraphCheckpointer'

const MAX_STEPS = 25
const NODE_TIMEOUT_SEC = 60

// Estado compartilhado entre os nós do LangGraph
const FlowState = Annotation.Root({
  messages: Annotation<string[]>({ reducer: (x, y) => [...x, ...y], default: () => [] }),
  vars: Annotation<Record<string, string>>({ reducer: (x, y) => ({ ...x, ...y }), default: () => ({}) }),
  ultimoResultado: Annotation<string>({ default: () => '' }),
  // campos internos para roteamento
  _branch: Annotation<string>({ default: () => '' }),
  _activeNodeId: Annotation<string>({ default: () => '' }),
  _error: Annotation<string>({ default: () => '' })
})

type FlowStateType = typeof FlowState.State

export interface LangGraphRunOptions {
  flowName: string
  threadId: string
  actions: EngineActions
  checkpointer: SqliteCheckpointer
  onStep: (update: StepUpdate) => void
  onInterrupt: (value: InterruptValue) => Promise<boolean>
  cancelSignal?: AbortSignal
}

export interface InterruptValue {
  nodeId: string
  nodeType: string
  description: string
}

// Nós que requerem aprovação antes de executar
const DANGEROUS_TYPES = new Set(['output', 'delegate', 'mcp-tool', 'claude-code'])

function isDangerous(node: FlowNode): boolean {
  if (node.type === 'output' && node.data.action === 'notify') return false
  return DANGEROUS_TYPES.has(node.type)
}

function withTimeout<T>(seconds: number, cancelSignal: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(); reject(new Error(`Tempo esgotado (${seconds}s)`)) }, seconds * 1000)
    const onAbort = () => { clearTimeout(timer); controller.abort(); reject(new Error('Execução cancelada')) }
    cancelSignal?.addEventListener('abort', onAbort, { once: true })
    fn(controller.signal).then(resolve, reject).finally(() => {
      clearTimeout(timer)
      cancelSignal?.removeEventListener('abort', onAbort)
    })
  })
}

// Erros que impedem a execução: as regras do editor mais a que o LangGraph exige. Só a Condição pode ter duas saídas;
// nos demais o grafo liga uma só, e a outra ficaria inalcançável (UNREACHABLE_NODE) ou seria ignorada em silêncio.
export function graphProblems(graph: FlowGraph): string[] {
  const outCount = new Map<string, number>()
  for (const e of graph.edges) outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1)
  const fanOut = graph.nodes
    .filter((n) => n.type !== 'condition' && (outCount.get(n.id) ?? 0) > 1)
    .map((n) => `${nodeRef(graph, n.id)} tem mais de uma saída; o executor só segue uma. Use uma Condição para ramificar.`)
  return [...validateGraph(graph), ...fanOut]
}

export async function runWithLangGraph(graph: FlowGraph, opts: LangGraphRunOptions): Promise<{ status: 'ok' | 'error'; error: string | null }> {
  const { flowName, threadId, actions, checkpointer, onStep, onInterrupt, cancelSignal } = opts

  const problems = graphProblems(graph)
  if (problems.length > 0) return { status: 'error', error: problems.join(' ') }
  const trigger = triggerOf(graph)!

  // Monta o StateGraph
  const sg = new StateGraph(FlowState)

  // Adiciona um nó LangGraph para cada nó do fluxo
  for (const node of graph.nodes) {
    const nodeId = node.id
    const nodeType = node.type

    sg.addNode(nodeId, async (state: FlowStateType): Promise<Partial<FlowStateType>> => {
      if (cancelSignal?.aborted) return { _error: 'Execução cancelada' }

      const input = state.ultimoResultado

      // Aprovação prévia para nós perigosos
      if (isDangerous(node)) {
        const description = `Nó "${nodeType}" está prestes a executar com entrada: "${input.slice(0, 120)}${input.length > 120 ? '…' : ''}"`
        // interrupt() pausa o grafo; retorna o valor de resume quando retomado
        // O resume vai num objeto: o LangGraph descarta `resume: false` (checa só se é truthy) e acusa comando vazio.
        const { approved } = interrupt<InterruptValue, { approved: boolean }>({ nodeId, nodeType, description })
        if (!approved) {
          onStep({ nodeId, status: 'skipped', input, output: 'Rejeitado pelo usuário', error: null })
          return { ultimoResultado: 'Rejeitado pelo usuário', vars: { [nodeId]: 'Rejeitado' }, _activeNodeId: nodeId, _error: 'Rejeitado' }
        }
      }

      onStep({ nodeId, status: 'running', input, output: null, error: null })

      try {
        const result = await withTimeout(
          'timeoutSec' in node.data ? (node.data.timeoutSec as number) : NODE_TIMEOUT_SEC,
          cancelSignal,
          (sig) => runFlowNode(node, input, actions, flowName, sig)
        )

        onStep({ nodeId, status: 'success', input, output: result.text, error: null })

        return {
          ultimoResultado: result.text,
          vars: { [nodeId]: result.text },
          messages: [result.text],
          _branch: result.branch ?? '',
          _activeNodeId: nodeId
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onStep({ nodeId, status: 'error', input, output: null, error: msg })
        return { _error: msg, _activeNodeId: nodeId }
      }
    })
  }

  // Arestas: START → trigger
  sg.addEdge(START as '__start__', trigger.id)

  // Cria mapa de sucessores por nó
  const successors = new Map<string, Array<{ target: string; conditionValue: string | null }>>()
  for (const edge of graph.edges) {
    const list = successors.get(edge.source) ?? []
    list.push({ target: edge.target, conditionValue: edge.conditionValue })
    successors.set(edge.source, list)
  }

  // Adiciona arestas ou arestas condicionais
  for (const node of graph.nodes) {
    const nexts = successors.get(node.id) ?? []

    if (nexts.length === 0) {
      sg.addEdge(node.id, END as '__end__')
      continue
    }

    if (node.type === 'condition') {
      // Mapeia true/false → nó destino
      const pathMap: Record<string, string> = {}
      for (const n of nexts) {
        if (n.conditionValue) pathMap[n.conditionValue] = n.target
      }
      // Nós sem branch definido vão para END
      if (!pathMap.true) pathMap.true = END
      if (!pathMap.false) pathMap.false = END
      sg.addConditionalEdges(node.id, (state: FlowStateType) => state._branch || 'false', pathMap)
    } else {
      sg.addEdge(node.id, nexts[0]!.target)
    }
  }

  const compiled = sg.compile({ checkpointer })
  const config = { configurable: { thread_id: threadId }, recursionLimit: MAX_STEPS }

  let input: FlowStateType | Command = {
    messages: [],
    vars: {},
    ultimoResultado: trigger.data.input ?? '',
    _branch: '',
    _activeNodeId: '',
    _error: ''
  }

  // Loop de execução com suporte a interrupt
  for (let attempt = 0; attempt < MAX_STEPS; attempt++) {
    let interrupted = false
    let interruptValue: InterruptValue | undefined

    // Usa stream para detectar interrupções
    for await (const chunk of await compiled.stream(input, { ...config, streamMode: 'updates' })) {
      const c = chunk as Record<string, unknown>
      if ('__interrupt__' in c) {
        const interrupts = c.__interrupt__ as Array<{ value: unknown }>
        interruptValue = interrupts[0]?.value as InterruptValue | undefined
        interrupted = true
        break
      }
      // Extrai erro de qualquer nó que tenha _error
      for (const nodeOutput of Object.values(c)) {
        const out = nodeOutput as Partial<FlowStateType>
        if (out._error && out._error !== '') {
          return { status: 'error', error: out._error }
        }
      }
    }

    if (!interrupted) break

    if (!interruptValue) break

    // Aguarda aprovação do usuário
    const approved = await onInterrupt(interruptValue)
    input = new Command({ resume: { approved } })
  }

  // Busca estado final para checar erros
  const finalState = await compiled.getState(config)
  const error = ((finalState.values as Partial<FlowStateType>)._error) ?? ''

  return { status: error ? 'error' : 'ok', error: (error as string) || null }
}

// Executa a lógica de um nó individual (delegada do engine.ts para evitar duplicação)
async function runFlowNode(
  node: FlowNode,
  input: string,
  actions: EngineActions,
  flowName: string,
  signal: AbortSignal
): Promise<{ text: string; branch?: string }> {
  switch (node.type) {
    case 'trigger':
      return { text: node.data.input }
    case 'news': {
      const { topic, language, count } = node.data
      return { text: await actions.fetchNews({ topic, language, count, signal }) }
    }
    case 'promptgen': {
      if (!input.trim()) throw new Error('Gerador de Prompt sem ideia')
      return { text: await actions.generatePrompt({ agentId: node.data.agentId!, idea: input, signal }) }
    }
    case 'agent': {
      const prompt = buildAgentPrompt(node.data.refinePrompt, input)
      if (!prompt) throw new Error('Agente sem prompt e sem entrada')
      return { text: await actions.runAgent({ agentId: node.data.agentId!, prompt, flowName, signal }) }
    }
    case 'condition': {
      const branch = evaluateCondition(node.data, input)
      return { text: input, branch }
    }
    case 'output': {
      if (node.data.action === 'notify') {
        actions.notify({ title: node.data.title.trim() || flowName, body: input })
        return { text: 'Notificação exibida' }
      }
      const file = await actions.saveMarkdown({ folder: node.data.folder, fileName: node.data.fileName, content: input, signal })
      return { text: `Arquivo salvo: ${file}` }
    }
    case 'memory': {
      if (node.data.mode === 'save') {
        if (!input.trim()) return { text: 'Nada para salvar na memória' }
        return { text: await actions.memorySave({ text: input, source: node.data.source, categories: node.data.categories }) }
      }
      return { text: await actions.memorySearch({ query: input, categories: node.data.categories, limit: node.data.limit }) }
    }
    case 'delegate': {
      if (!input.trim()) throw new Error('Nó Delegar sem entrada')
      return { text: await actions.delegateTask({ agentId: node.data.agentId!, task: input, flowName }) }
    }
    case 'mcp-tool': {
      const rawArgs = node.data.args.replace(/\{\{entrada\}\}/g, input.trim())
      let parsedArgs: Record<string, unknown>
      try { parsedArgs = JSON.parse(rawArgs) as Record<string, unknown> } catch { throw new Error('Nó Ferramenta MCP: JSON inválido') }
      return { text: await actions.mcpCallTool({ serverName: node.data.serverName, toolName: node.data.toolName, args: parsedArgs, signal }) }
    }
    case 'claude-code': {
      const tarefa = node.data.tarefa.trim() ? node.data.tarefa.replace(/\{\{entrada\}\}/g, input.trim()) : input
      return { text: await actions.claudeCode({ tarefa, pasta: node.data.pasta, modelo: node.data.modelo, signal }) }
    }
  }
}

// Retorna o estado atual de uma execução (usado pelo IPC flows:status)
export async function getRunState(
  checkpointer: SqliteCheckpointer,
  threadId: string
): Promise<{ vars: Record<string, string>; ultimoResultado: string; activeNodeId: string } | null> {
  const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } })
  if (!tuple) return null
  // channel_values é onde o LangGraph serializa o estado dos canais no checkpoint
  const cv = (tuple.checkpoint as unknown as { channel_values?: Record<string, unknown> }).channel_values ?? {}
  return {
    vars: (cv.vars as Record<string, string>) ?? {},
    ultimoResultado: (cv.ultimoResultado as string) ?? '',
    activeNodeId: (cv._activeNodeId as string) ?? ''
  }
}
