import { describe, it, expect } from 'vitest'
import { executeFlow, buildAgentPrompt, type EngineActions } from '../src/main/flows/engine'
import type { FlowGraph } from '@shared/flows'

const fakeActions = (onPrompt?: (nodeId: string, prompt: string) => void): EngineActions => ({
  runAgent: async ({ prompt, agentId }) => {
    onPrompt?.(String(agentId), prompt)
    return `SAIDA-DE-${agentId}:${prompt.slice(0, 20)}`
  },
  saveMarkdown: async () => 'file.md',
  notify: () => {},
  fetchNews: async () => 'NOTICIAS',
  generatePrompt: async () => 'prompt-gerado',
  memorySave: async () => 'salvo',
  memorySearch: async () => '',
  delegateTask: async () => ''
})

describe('buildAgentPrompt', () => {
  it('substitui {{entrada}} quando presente', () => {
    expect(buildAgentPrompt('Resuma: {{entrada}}', 'texto')).toBe('Resuma: texto')
  })
  it('anexa abaixo quando não há {{entrada}}', () => {
    const r = buildAgentPrompt('Instrução', 'dados')
    expect(r).toContain('Instrução')
    expect(r).toContain('dados')
  })
  it('retorna só a entrada quando refinePrompt vazio', () => {
    expect(buildAgentPrompt('', 'dados')).toBe('dados')
  })
})

describe('executeFlow – 3 nós lineares', () => {
  it('cada nó recebe só a saída do predecessor, sem duplicação', async () => {
    const nodeInputs: Record<string, string> = {}
    const graph: FlowGraph = {
      nodes: [
        { id: 't', type: 'trigger', data: { mode: 'manual', cron: '', input: 'GATILHO' }, position: { x: 0, y: 0 } },
        { id: 'a', type: 'agent', data: { agentId: 1, refinePrompt: '', timeoutSec: 30, includeAllInputs: false }, position: { x: 1, y: 0 } },
        { id: 'b', type: 'agent', data: { agentId: 2, refinePrompt: '', timeoutSec: 30, includeAllInputs: false }, position: { x: 2, y: 0 } }
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a', conditionValue: null },
        { id: 'e2', source: 'a', target: 'b', conditionValue: null }
      ]
    }
    const result = await executeFlow(graph, {
      flowName: 'test',
      actions: fakeActions(),
      onStep: (u) => { if (u.status === 'running') nodeInputs[u.nodeId] = u.input }
    })
    expect(result.status).toBe('ok')
    // nó a recebe só a saída do gatilho
    expect(nodeInputs['a']).toBe('GATILHO')
    // nó b recebe só a saída de a, não a entrada do gatilho diretamente
    expect(nodeInputs['b']).toBe(result.outputs['a'])
    expect(nodeInputs['b']).not.toBe('GATILHO')
  })
})
