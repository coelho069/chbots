import { describe, expect, it } from 'vitest'
import { graphProblems, runWithLangGraph } from '../src/main/flows/langgraphRunner'
import { SqliteCheckpointer } from '../src/main/flows/langgraphCheckpointer'
import type { FlowGraph } from '../src/shared/flows'

const edge = (source: string, target: string, conditionValue: string | null = null) => ({ id: `${source}-${target}`, source, target, conditionValue })
const agent = (id: string) => ({ id, type: 'agent', data: { agentId: 1, refinePrompt: '', timeoutSec: 30 } })
const trigger = { id: 't', type: 'trigger', data: { mode: 'manual', cron: '', input: 'oi' } }
const save = { id: 'o', type: 'output', data: { action: 'save_md', folder: 'x', fileName: 'y.md', title: '', timeoutSec: 30 } }
const graph = (nodes: object[], edges: ReturnType<typeof edge>[]) => ({ nodes, edges }) as unknown as FlowGraph

describe('graphProblems', () => {
  it('aceita um fluxo linear', () => {
    expect(graphProblems(graph([trigger, agent('a'), save], [edge('t', 'a'), edge('a', 'o')]))).toEqual([])
  })

  it('recusa nó comum com duas saídas (o executor só seguiria uma)', () => {
    const g = graph([trigger, agent('a'), agent('b')], [edge('t', 'a'), edge('t', 'b')])
    expect(graphProblems(g).join(' ')).toMatch(/mais de uma saída/)
  })

  it('aceita a Condição com duas saídas', () => {
    const cond = { id: 'c', type: 'condition', data: { operator: 'contains', value: 'x', caseSensitive: false } }
    const g = graph([trigger, cond, agent('a'), agent('b')], [edge('t', 'c'), edge('c', 'a', 'true'), edge('c', 'b', 'false')])
    expect(graphProblems(g)).toEqual([])
  })
})

describe('runWithLangGraph (execução real)', () => {
  const run = (g: FlowGraph, approve = true) => {
    const steps: string[] = []
    const saved: string[] = []
    const actions = {
      runAgent: async ({ prompt }: { prompt: string }) => `resposta:${prompt}`,
      saveMarkdown: async ({ content }: { content: string }) => { saved.push(content); return 'x/y.md' }
    }
    return runWithLangGraph(g, {
      flowName: 'f',
      threadId: `t-${Math.random()}`,
      actions: actions as never,
      checkpointer: new SqliteCheckpointer(),
      onStep: (u) => steps.push(`${u.nodeId}:${u.status}`),
      onInterrupt: async () => approve
    }).then((r) => ({ r, steps, saved }))
  }
  const linear = graph([trigger, agent('a'), save], [edge('t', 'a'), edge('a', 'o')])

  it('executa o fluxo e pede aprovação na saída', async () => {
    const { r, steps, saved } = await run(linear)
    expect(r).toEqual({ status: 'ok', error: null })
    expect(steps).toContain('o:success')
    expect(saved).toEqual(['resposta:oi'])
  })

  it('não salva quando a aprovação é negada', async () => {
    const { steps, saved } = await run(linear, false)
    expect(steps).toContain('o:skipped')
    expect(saved).toEqual([])
  })

  it('fluxo inválido falha antes de executar qualquer nó', async () => {
    const { r, steps } = await run(graph([trigger, agent('a'), agent('b')], [edge('t', 'a'), edge('t', 'b')]))
    expect(r.status).toBe('error')
    expect(r.error).toMatch(/mais de uma saída/)
    expect(steps).toEqual([])
  })
})
