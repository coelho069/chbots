import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultNodeData,
  validateGraph,
  wouldCreateCycle,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type FlowNodeDataMap,
  type FlowNodeType
} from '../src/shared/flows'
import { openDatabase } from '../src/main/db/connection'
import {
  deleteFlow,
  getFlowGraph,
  insertFlow,
  listFlowRuns,
  listFlows,
  listSteps,
  saveFlow
} from '../src/main/db/repos/flows'
import { createSaveMarkdown, renderFileName, resolveInside } from '../src/main/flows/actions'
import { buildAgentPrompt, executeFlow, FlowValidationError, joinSeparator, type EngineActions, type StepUpdate } from '../src/main/flows/engine'
import { FlowRunner } from '../src/main/flows/runner'
import { setup } from './helpers'

// ---- Montagem de grafos para os testes ----

function node<T extends FlowNodeType>(id: string, type: T, data: Partial<FlowNodeDataMap[T]> = {}): FlowNode {
  return { id, type, data: { ...defaultNodeData(type), ...data }, position: { x: 0, y: 0 } } as unknown as FlowNode
}
const edge = (source: string, target: string, conditionValue: FlowEdge['conditionValue'] = null): FlowEdge => ({
  id: `${source}-${target}-${conditionValue}`,
  source,
  target,
  conditionValue
})

// Ações falsas: o agente responde "[agente N] <prompt>", e tudo fica registrado.
function fakeActions(overrides: Partial<EngineActions> = {}) {
  const calls = { agent: [] as { agentId: number; prompt: string }[], saved: [] as string[], notified: [] as string[] }
  const actions: EngineActions = {
    runAgent: async ({ agentId, prompt }) => {
      calls.agent.push({ agentId, prompt })
      return `[agente ${agentId}] ${prompt}`
    },
    saveMarkdown: async ({ content }) => {
      calls.saved.push(content)
      return 'C:\\fake\\saida.md'
    },
    notify: ({ body }) => {
      calls.notified.push(body)
    },
    fetchNews: async ({ topic }) => `notícias sobre ${topic}`,
    generatePrompt: async ({ idea }) => `prompt para ${idea}`,
    memorySave: async () => 'salvo',
    memorySearch: async () => '',
    delegateTask: async () => '',
    ...overrides
  }
  return { actions, calls }
}

const linear: FlowGraph = {
  nodes: [
    node('t', 'trigger', { input: 'tema: café' }),
    node('a1', 'agent', { agentId: 1, refinePrompt: 'Pesquise' }),
    node('a2', 'agent', { agentId: 2, refinePrompt: 'Resuma' }),
    node('o', 'output', { action: 'save_md' })
  ],
  edges: [edge('t', 'a1'), edge('a1', 'a2'), edge('a2', 'o')]
}

const branching = (word: string): FlowGraph => ({
  nodes: [
    node('t', 'trigger', { input: word }),
    node('c', 'condition', { operator: 'contains', value: 'aprovado' }),
    node('yes', 'output', { action: 'save_md' }),
    node('no', 'output', { action: 'notify' })
  ],
  edges: [edge('t', 'c'), edge('c', 'yes', 'true'), edge('c', 'no', 'false')]
})

afterEach(() => vi.useRealTimers())

describe('validação do grafo', () => {
  it('aceita um grafo bem formado', () => {
    expect(validateGraph(linear)).toEqual([])
    expect(validateGraph(branching('x'))).toEqual([])
  })

  it('detecta ciclo', () => {
    const g: FlowGraph = { ...linear, edges: [...linear.edges.slice(0, 2), edge('a2', 'a1')] }
    expect(validateGraph(g).join(' ')).toMatch(/ciclo envolvendo: Agente 1, Agente 2/)
  })

  it('aplica o limite de 10 nós', () => {
    const extra = Array.from({ length: 10 }, (_, i) => node(`x${i}`, 'agent', { agentId: 1 }))
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), ...extra],
      edges: extra.map((n, i) => edge(i === 0 ? 't' : `x${i - 1}`, n.id))
    }
    expect(validateGraph(g).join(' ')).toContain('11 nós; o limite é 10')
  })

  it('exige exatamente um gatilho', () => {
    expect(validateGraph({ nodes: [node('a', 'agent', { agentId: 1 })], edges: [] })).toContain('O fluxo precisa de um Gatilho.')
    expect(validateGraph({ nodes: [node('t1', 'trigger'), node('t2', 'trigger')], edges: [] })).toContain(
      'O fluxo só pode ter um Gatilho.'
    )
  })

  it('aponta nós soltos, saídas de condição e ligações proibidas', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('c', 'condition', { value: 'x' }), node('o', 'output'), node('solto', 'agent', { agentId: 1 })],
      edges: [edge('t', 'c'), edge('c', 'o'), edge('o', 't')]
    }
    const msg = validateGraph(g).join(' | ')
    expect(msg).toContain('precisa sair por "Sim" ou "Não"')
    expect(msg).toContain('Gatilho não pode receber')
    expect(msg).toContain('Saída e não pode ter ligações saindo')
    expect(msg).toContain('Não ligados ao Gatilho: Agente')
  })

  it('exige agente escolhido e texto na condição', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('a', 'agent'), node('c', 'condition')],
      edges: [edge('t', 'a'), edge('a', 'c')]
    }
    expect(validateGraph(g)).toEqual(['Agente: escolha um agente.', 'Condição: informe o texto a procurar.'])
  })

  it('wouldCreateCycle enxerga caminhos indiretos', () => {
    const edges = [edge('a', 'b'), edge('b', 'c')]
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true)
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(false)
    expect(wouldCreateCycle(edges, 'x', 'x')).toBe(true)
  })
})

describe('motor de execução', () => {
  it('injeta a saída de cada nó na entrada do seguinte', async () => {
    const { actions, calls } = fakeActions()
    const steps: StepUpdate[] = []
    const result = await executeFlow(linear, { flowName: 'F', actions, onStep: (s) => steps.push(s) })

    expect(result).toMatchObject({ status: 'ok', path: ['t', 'a1', 'a2', 'o'], error: null })
    expect(calls.agent[0]!.prompt).toBe(buildAgentPrompt('Pesquise', 'tema: café'))
    expect(calls.agent[1]!.prompt).toBe(buildAgentPrompt('Resuma', `[agente 1] ${calls.agent[0]!.prompt}`))
    expect(calls.saved[0]).toBe(result.outputs.a2)
    expect(result.outputs.o).toBe('Arquivo salvo: C:\\fake\\saida.md')
    expect(steps.map((s) => `${s.nodeId}:${s.status}`)).toEqual([
      't:running', 't:success', 'a1:running', 'a1:success', 'a2:running', 'a2:success', 'o:running', 'o:success'
    ])
  })

  it('segue só o lado escolhido pela condição e marca o outro como ignorado', async () => {
    const yes = fakeActions()
    const r1 = await executeFlow(branching('Status: APROVADO'), { flowName: 'F', actions: yes.actions })
    expect(r1.path).toEqual(['t', 'c', 'yes'])
    expect(yes.calls.saved).toEqual(['Status: APROVADO'])
    expect(yes.calls.notified).toEqual([])

    const no = fakeActions()
    const steps: StepUpdate[] = []
    const r2 = await executeFlow(branching('reprovado? não'), { flowName: 'F', actions: no.actions, onStep: (s) => steps.push(s) })
    expect(r2.path).toEqual(['t', 'c', 'no'])
    expect(no.calls.notified).toEqual(['reprovado? não'])
    expect(steps.find((s) => s.nodeId === 'yes')?.status).toBe('skipped')
  })

  it('"não contém" e diferenciação de maiúsculas', async () => {
    const g = branching('APROVADO')
    ;(g.nodes[1] as Extract<FlowNode, { type: 'condition' }>).data = { operator: 'not_contains', value: 'aprovado', caseSensitive: true }
    const { actions } = fakeActions()
    expect((await executeFlow(g, { flowName: 'F', actions })).path).toEqual(['t', 'c', 'yes'])
  })

  it('junta as entradas quando um nó recebe de dois caminhos', async () => {
    const g: FlowGraph = {
      nodes: [
        node('t', 'trigger', { input: 'base' }),
        node('a', 'agent', { agentId: 1, refinePrompt: 'A' }),
        node('b', 'agent', { agentId: 2, refinePrompt: 'B' }),
        node('o', 'output')
      ],
      edges: [edge('t', 'a'), edge('t', 'b'), edge('a', 'o'), edge('b', 'o')]
    }
    const { actions, calls } = fakeActions()
    const r = await executeFlow(g, { flowName: 'F', actions })
    expect(r.path).toEqual(['t', 'a', 'b', 'o'])
    expect(calls.saved[0]).toBe(`${r.outputs.a}${joinSeparator}${r.outputs.b}`)
  })

  it('para no primeiro erro e ignora o resto', async () => {
    const { actions } = fakeActions({
      runAgent: async ({ agentId }) => {
        if (agentId === 2) throw new Error('cota excedida')
        return 'ok'
      }
    })
    const steps: StepUpdate[] = []
    const r = await executeFlow(linear, { flowName: 'F', actions, onStep: (s) => steps.push(s) })
    expect(r).toMatchObject({ status: 'error', path: ['t', 'a1', 'a2'], error: 'cota excedida' })
    expect(steps.filter((s) => s.nodeId === 'o').map((s) => s.status)).toEqual(['skipped'])
  })

  it('aplica o tempo limite do nó e cancela a chamada', async () => {
    vi.useFakeTimers()
    let aborted = false
    const { actions } = fakeActions({
      runAgent: ({ signal }) =>
        new Promise<string>(() => {
          signal.addEventListener('abort', () => (aborted = true))
        })
    })
    const g: FlowGraph = {
      nodes: [node('t', 'trigger', { input: 'x' }), node('a', 'agent', { agentId: 1, timeoutSec: 5 })],
      edges: [edge('t', 'a')]
    }
    const pending = executeFlow(g, { flowName: 'F', actions })
    await vi.advanceTimersByTimeAsync(5_000)
    const r = await pending
    expect(r).toMatchObject({ status: 'error', error: 'Tempo esgotado (5s)' })
    expect(aborted).toBe(true)
  })

  it('recusa grafo inválido antes de executar qualquer nó', async () => {
    const { actions, calls } = fakeActions()
    const g: FlowGraph = { ...linear, edges: [...linear.edges, edge('a2', 'a1')] }
    await expect(executeFlow(g, { flowName: 'F', actions })).rejects.toBeInstanceOf(FlowValidationError)
    expect(calls.agent).toEqual([])
  })
})

describe('ações de saída', () => {
  it('monta nomes de arquivo seguros', () => {
    const d = new Date(2026, 9, 24, 9, 5)
    expect(renderFileName('{fluxo}-{data}.md', 'Boletim', d)).toBe('Boletim-2026-10-24_09-05.md')
    expect(renderFileName('..\\..\\Windows\\x', 'F', d)).toBe('x.md')
    // "c:" vira prefixo de unidade e é descartado; o resto dos caracteres proibidos vira "_"
    expect(renderFileName('c:b*c?.txt', 'F', d)).toBe('b_c_.txt.md')
    expect(renderFileName('a|b<c>.md', 'F', d)).toBe('a_b_c_.md')
    expect(renderFileName('', 'Meu: fluxo', d)).toBe('Meu_ fluxo-2026-10-24_09-05.md')
    expect(() => resolveInside('C:\\pasta', '..\\fora.md')).toThrow('inválido')
  })

  it('grava o .md sem sobrescrever arquivos existentes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilotos-md-'))
    const save = createSaveMarkdown(dir, () => new Date(2026, 0, 2, 3, 4))
    const first = await save({ folder: '', fileName: 'nota.md', content: 'um', flowName: 'F' })
    const second = await save({ folder: '', fileName: 'nota.md', content: 'dois', flowName: 'F' })
    expect(readdirSync(dir).sort()).toEqual(['nota-2.md', 'nota.md'])
    expect(readFileSync(first, 'utf8')).toBe('um')
    expect(readFileSync(second, 'utf8')).toBe('dois')
  })
})

describe('persistência e execução registrada', () => {
  it('salva e relê o grafo, e apaga em cascata', () => {
    const db = openDatabase(':memory:')
    const flow = insertFlow(db, { name: 'F', description: 'd' }, linear)
    expect(getFlowGraph(db, flow.id)).toEqual(linear)

    const updated = saveFlow(db, flow.id, { name: 'F2', description: '' }, branching('x'))
    expect(updated.name).toBe('F2')
    expect(updated.graph).toEqual(branching('x'))
    expect(listFlows(db)[0]).toMatchObject({ nodeCount: 4, schedule: null })

    deleteFlow(db, flow.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM flow_nodes').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM flow_edges').get()).toEqual({ n: 0 })
  })

  function runnerWith(graph: FlowGraph, actions = fakeActions().actions) {
    const { db } = setup()
    const flow = insertFlow(db, { name: 'Fluxo teste', description: '' }, graph)
    const events: string[] = []
    const scheduled: string[] = []
    const runner = new FlowRunner({
      db,
      actionsFor: () => actions,
      onStep: (e) => events.push(`${e.step.nodeId}:${e.step.status}`),
      onRunsChanged: () => undefined,
      schedule: ((expr: string) => {
        scheduled.push(expr)
        return { destroy: () => undefined } as never
      }) as never
    })
    return { db, flow, runner, events, scheduled }
  }

  it('registra execução, passos com entrada/saída e o caminho percorrido', async () => {
    const { db, flow, runner, events } = runnerWith(branching('pedido aprovado'))
    const { run, done } = runner.start(flow.id, 'manual')
    expect(run.status).toBe('running')
    expect(runner.isRunning(flow.id)).toBe(true)
    const finished = await done

    expect(finished).toMatchObject({ status: 'ok', path: ['t', 'c', 'yes'], trigger: 'manual' })
    expect(finished.finishedAt).not.toBeNull()
    expect(listFlowRuns(db, flow.id)).toHaveLength(1)
    const steps = listSteps(db, run.id)
    expect(steps.map((s) => [s.nodeId, s.status])).toEqual([
      ['t', 'success'],
      ['c', 'success'],
      ['yes', 'success'],
      ['no', 'skipped']
    ])
    expect(steps[1]).toMatchObject({ input: 'pedido aprovado', output: 'pedido aprovado' })
    expect(events).toContain('yes:running')
    expect(runner.isRunning(flow.id)).toBe(false)
  })

  it('não deixa o mesmo fluxo rodar duas vezes ao mesmo tempo', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { actions } = fakeActions({ runAgent: async () => (await gate, 'ok') })
    const { flow, runner } = runnerWith(linear, actions)
    const first = runner.start(flow.id, 'manual')
    expect(() => runner.start(flow.id, 'manual')).toThrow('já está em execução')
    release()
    await first.done
  })

  it('Cancelar interrompe o nó em andamento e ignora o resto', async () => {
    let started!: () => void
    const agentStarted = new Promise<void>((r) => (started = r))
    let aborted = false
    const { actions, calls } = fakeActions({
      runAgent: ({ signal }) =>
        new Promise<string>(() => {
          signal.addEventListener('abort', () => (aborted = true))
          started()
        })
    })
    const { db, flow, runner } = runnerWith(linear, actions)
    const { run, done } = runner.start(flow.id, 'manual')
    await agentStarted
    runner.cancel(run.id)
    const finished = await done

    expect(finished).toMatchObject({ status: 'error', error: 'Execução cancelada', path: ['t', 'a1'] })
    expect(aborted).toBe(true)
    expect(calls.saved).toEqual([])
    expect(listSteps(db, run.id).map((s) => [s.nodeId, s.status])).toEqual([
      ['t', 'success'],
      ['a1', 'error'],
      ['a2', 'skipped'],
      ['o', 'skipped']
    ])
    expect(runner.isRunning(flow.id)).toBe(false)
  })

  it('cancelar uma execução que já terminou não faz nada', async () => {
    const { flow, runner } = runnerWith(linear)
    const { run, done } = runner.start(flow.id, 'manual')
    await done
    expect(() => runner.cancel(run.id)).not.toThrow()
  })

  it('registra erro de validação como execução com falha', async () => {
    const { db, flow, runner } = runnerWith(linear)
    // corrompe o grafo direto no banco: liga a saída de volta ao gatilho
    db.prepare("INSERT INTO flow_edges (id, flow_id, source_node, target_node) VALUES ('x', ?, 'o', 'a1')").run(flow.id)
    const result = await runner.start(flow.id, 'manual').done
    expect(result.status).toBe('error')
    expect(result.error).toContain('ciclo')
  })

  it('agenda só fluxos com gatilho por horário válido', () => {
    const { db, runner, scheduled } = runnerWith(linear)
    const scheduledGraph: FlowGraph = {
      ...linear,
      nodes: linear.nodes.map((n) => (n.type === 'trigger' ? node(`${n.id}2`, 'trigger', { mode: 'schedule', cron: '30 7 * * 1-5' }) : { ...n, id: `${n.id}2` })),
      edges: linear.edges.map((e) => ({ ...e, id: `${e.id}2`, source: `${e.source}2`, target: `${e.target}2` }))
    }
    insertFlow(db, { name: 'Agendado', description: '' }, scheduledGraph)
    runner.startScheduling()
    expect(scheduled).toEqual(['30 7 * * 1-5'])
    expect(runner.scheduledCount).toBe(1)
  })
})
