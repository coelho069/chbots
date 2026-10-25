import {
  MAX_FLOW_NODES,
  topologicalOrder,
  triggerOf,
  validateGraph,
  type ConditionBranch,
  type FlowGraph,
  type FlowNode,
  type NewsLanguage,
  type StepStatus
} from '@shared/flows'

// Ações com efeito colateral, injetadas: no app usam Electron e o ChatService; nos testes, falsos.
export interface EngineActions {
  runAgent(args: { agentId: number; prompt: string; flowName: string; signal: AbortSignal }): Promise<string>
  saveMarkdown(args: { folder: string; fileName: string; content: string; signal: AbortSignal }): Promise<string>
  notify(args: { title: string; body: string }): void
  fetchNews(args: { topic: string; language: NewsLanguage; count: number; signal: AbortSignal }): Promise<string>
  generatePrompt(args: { agentId: number; idea: string; signal: AbortSignal }): Promise<string>
  memorySave(args: { text: string; source: string; categories: string[] }): Promise<string>
  memorySearch(args: { query: string; categories: string[]; limit: number }): Promise<string>
  delegateTask(args: { agentId: number; task: string; flowName: string }): Promise<string>
  mcpCallTool(args: { serverName: string; toolName: string; args: Record<string, unknown>; signal: AbortSignal }): Promise<string>
}

export interface StepUpdate {
  nodeId: string
  status: StepStatus
  input: string
  output: string | null
  error: string | null
}

export interface ExecuteOptions {
  flowName: string
  actions: EngineActions
  onStep?: (update: StepUpdate) => void
  // segundos; nós sem timeout próprio (gatilho, condição) usam este
  defaultTimeoutSec?: number
  // sinal externo para cancelar toda a execução
  cancelSignal?: AbortSignal
}

export interface ExecuteResult {
  status: 'ok' | 'error'
  // nós executados (com sucesso ou erro), na ordem em que rodaram
  path: string[]
  outputs: Record<string, string>
  error: string | null
}

export class FlowValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
    this.name = 'FlowValidationError'
  }
}

export const joinSeparator = '\n\n---\n\n'

export function buildAgentPrompt(refinePrompt: string, input: string): string {
  const refine = refinePrompt.trim()
  const data = input.trim()
  // {{entrada}} permite posicionar a entrada explicitamente no prompt
  if (refine.includes('{{entrada}}')) return refine.replace('{{entrada}}', data)
  if (refine && data) return `${refine}\n\n--- Entrada ---\n${data}`
  return refine || data
}

export function evaluateCondition(
  data: { operator: 'contains' | 'not_contains'; value: string; caseSensitive: boolean },
  input: string
): ConditionBranch {
  const haystack = data.caseSensitive ? input : input.toLocaleLowerCase()
  const needle = data.caseSensitive ? data.value : data.value.toLocaleLowerCase()
  const contains = haystack.includes(needle)
  return (data.operator === 'contains' ? contains : !contains) ? 'true' : 'false'
}

export const cancelledMessage = 'Execução cancelada'

async function withTimeout<T>(seconds: number, cancel: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onCancel: (() => void) | undefined
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`Tempo esgotado (${seconds}s)`))
    }, seconds * 1000)
    onCancel = () => {
      controller.abort()
      reject(new Error(cancelledMessage))
    }
    cancel?.addEventListener('abort', onCancel, { once: true })
  })
  try {
    return await Promise.race([task(controller.signal), stop])
  } finally {
    clearTimeout(timer)
    if (onCancel) cancel?.removeEventListener('abort', onCancel)
  }
}

// Executa o grafo em ordem topológica, um nó por vez. A saída de cada nó vira a entrada
// dos seguintes; se um nó tem várias entradas ativas, elas são concatenadas.
export async function executeFlow(graph: FlowGraph, opts: ExecuteOptions): Promise<ExecuteResult> {
  const problems = validateGraph(graph)
  if (problems.length > 0) throw new FlowValidationError(problems)
  if (graph.nodes.length > MAX_FLOW_NODES) throw new FlowValidationError([`Limite de ${MAX_FLOW_NODES} nós excedido.`])

  const { actions, onStep, flowName } = opts
  const fallbackTimeout = opts.defaultTimeoutSec ?? 30
  const cancel = opts.cancelSignal
  if (cancel?.aborted) throw new Error(cancelledMessage)
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const trigger = triggerOf(graph)!
  const { order } = topologicalOrder(graph)

  const outputs: Record<string, string> = {}
  const branches: Record<string, ConditionBranch> = {}
  const succeeded = new Set<string>()
  const path: string[] = []
  let failure: string | null = null

  const emit = (u: StepUpdate) => onStep?.(u)

  for (const id of order) {
    const node = nodes.get(id)!
    const incoming = graph.edges.filter((e) => e.target === id)
    const taken = incoming.filter(
      (e) => succeeded.has(e.source) && (e.conditionValue === null || branches[e.source] === e.conditionValue)
    )

    if (failure === null && cancel?.aborted) failure = cancelledMessage

    // Depois de um erro ou cancelamento, ou fora do caminho escolhido pelas condições: ignorado.
    if (failure !== null || (id !== trigger.id && taken.length === 0)) {
      emit({ nodeId: id, status: 'skipped', input: '', output: null, error: null })
      continue
    }

    const allInputs = taken.map((e) => outputs[e.source] ?? '')
    const useAll = node.type !== 'agent' || node.data.includeAllInputs
    const input = id === trigger.id ? '' : useAll ? allInputs.join(joinSeparator) : (allInputs[allInputs.length - 1] ?? '')
    emit({ nodeId: id, status: 'running', input, output: null, error: null })
    path.push(id)

    try {
      const timeoutSec = 'timeoutSec' in node.data ? node.data.timeoutSec : fallbackTimeout
      const output = await withTimeout(timeoutSec, cancel, (signal) => runNode(node, input, signal))
      outputs[id] = output.text
      if (output.branch) branches[id] = output.branch
      succeeded.add(id)
      emit({ nodeId: id, status: 'success', input, output: output.text, error: null })
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)
      emit({ nodeId: id, status: 'error', input, output: null, error: failure })
    }
  }

  return { status: failure === null ? 'ok' : 'error', path, outputs, error: failure }

  async function runNode(node: FlowNode, input: string, signal: AbortSignal): Promise<{ text: string; branch?: ConditionBranch }> {
    switch (node.type) {
      case 'trigger':
        return { text: node.data.input }
      case 'news': {
        const { topic, language, count } = node.data
        return { text: await actions.fetchNews({ topic, language, count, signal }) }
      }
      case 'promptgen': {
        if (!input.trim()) throw new Error('Gerador de Prompt sem ideia: ligue um nó com texto antes dele')
        return { text: await actions.generatePrompt({ agentId: node.data.agentId!, idea: input, signal }) }
      }
      case 'agent': {
        const prompt = buildAgentPrompt(node.data.refinePrompt, input)
        if (!prompt) throw new Error('Agente sem prompt de refinamento e sem entrada')
        const text = await actions.runAgent({ agentId: node.data.agentId!, prompt, flowName, signal })
        return { text }
      }
      case 'condition': {
        const branch = evaluateCondition(node.data, input)
        // repassa a entrada intacta pelo lado escolhido
        return { text: input, branch }
      }
      case 'output': {
        if (node.data.action === 'notify') {
          actions.notify({ title: node.data.title.trim() || flowName, body: input })
          return { text: 'Notificação exibida' }
        }
        const file = await actions.saveMarkdown({
          folder: node.data.folder,
          fileName: node.data.fileName,
          content: input,
          signal
        })
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
        if (!input.trim()) throw new Error('Nó Delegar sem entrada: ligue um nó com texto antes dele')
        const text = await actions.delegateTask({ agentId: node.data.agentId!, task: input, flowName })
        return { text }
      }
      case 'mcp-tool': {
        const rawArgs = node.data.args.replace(/\{\{entrada\}\}/g, input.trim())
        let parsedArgs: Record<string, unknown>
        try { parsedArgs = JSON.parse(rawArgs) as Record<string, unknown> } catch { throw new Error('Nó Ferramenta MCP: JSON de argumentos inválido') }
        const text = await actions.mcpCallTool({ serverName: node.data.serverName, toolName: node.data.toolName, args: parsedArgs, signal })
        return { text }
      }
    }
  }
}
