import { describe, expect, it } from 'vitest'
import {
  MAX_FLOW_NODES,
  defaultNodeData,
  validateGraph,
  wouldCreateCycle,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type FlowNodeDataMap,
  type FlowNodeType
} from '../src/shared/flows'

function node<T extends FlowNodeType>(id: string, type: T, data: Partial<FlowNodeDataMap[T]> = {}): FlowNode {
  return { id, type, data: { ...defaultNodeData(type), ...data }, position: { x: 0, y: 0 } } as unknown as FlowNode
}

const edge = (source: string, target: string, conditionValue: FlowEdge['conditionValue'] = null): FlowEdge => ({
  id: `${source}-${target}-${conditionValue ?? 'null'}`,
  source,
  target,
  conditionValue
})

const validMin = (): FlowGraph => ({
  nodes: [node('t', 'trigger'), node('a', 'agent', { agentId: 1 })],
  edges: [edge('t', 'a')]
})

describe('validateGraph', () => {
  it('aceita um grafo mínimo válido (gatilho → agente)', () => {
    expect(validateGraph(validMin())).toEqual([])
  })

  it('rejeita grafo sem nenhum gatilho', () => {
    const g: FlowGraph = { nodes: [node('a', 'agent', { agentId: 1 })], edges: [] }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('Gatilho'))).toBe(true)
  })

  it('rejeita grafo com dois gatilhos', () => {
    const g: FlowGraph = {
      nodes: [node('t1', 'trigger'), node('t2', 'trigger'), node('a', 'agent', { agentId: 1 })],
      edges: [edge('t1', 'a')]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('um Gatilho'))).toBe(true)
  })

  it('rejeita agente sem agentId', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('a', 'agent', { agentId: null })],
      edges: [edge('t', 'a')]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('agente'))).toBe(true)
  })

  it('rejeita condição sem valor', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('c', 'condition', { value: '' })],
      edges: [edge('t', 'c')]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('texto a procurar'))).toBe(true)
  })

  it('rejeita ciclo simples A→B→A', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('a', 'agent', { agentId: 1 }), node('b', 'agent', { agentId: 2 })],
      edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('ciclo'))).toBe(true)
  })

  it('rejeita nó solto não alcançável pelo gatilho', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('a', 'agent', { agentId: 1 }), node('b', 'agent', { agentId: 2 })],
      edges: [edge('t', 'a')]
      // 'b' não está conectado
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('Não ligados'))).toBe(true)
  })

  it('rejeita aresta saindo de nó Saída', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('o', 'output'), node('a', 'agent', { agentId: 1 })],
      edges: [edge('t', 'o'), edge('o', 'a')]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('Saída'))).toBe(true)
  })

  it('rejeita ligação chegando ao Gatilho', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('a', 'agent', { agentId: 1 })],
      edges: [edge('t', 'a'), edge('a', 't')]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('Gatilho não pode receber'))).toBe(true)
  })

  it('rejeita aresta de condição sem conditionValue', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('c', 'condition', { value: 'x' }), node('a', 'agent', { agentId: 1 })],
      edges: [edge('t', 'c'), { id: 'c-a', source: 'c', target: 'a', conditionValue: null }]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('"Sim" ou "Não"'))).toBe(true)
  })

  it('rejeita aresta de não-condição com conditionValue', () => {
    const g: FlowGraph = {
      nodes: [node('t', 'trigger'), node('a', 'agent', { agentId: 1 }), node('b', 'agent', { agentId: 2 })],
      edges: [edge('t', 'a'), { id: 'a-b', source: 'a', target: 'b', conditionValue: 'true' }]
    }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('valor de condição'))).toBe(true)
  })

  it('rejeita quando há mais nós que MAX_FLOW_NODES', () => {
    const nodes: FlowNode[] = [node('t', 'trigger')]
    for (let i = 0; i < MAX_FLOW_NODES; i++) nodes.push(node(`a${i}`, 'agent', { agentId: i + 1 }))
    const g: FlowGraph = { nodes, edges: [] }
    const errs = validateGraph(g)
    expect(errs.some((e) => e.includes('limite') || e.includes('Limite'))).toBe(true)
  })
})

describe('wouldCreateCycle', () => {
  it('detecta auto-referência', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true)
  })

  it('detecta ciclo direto A→B e tentativa B→A', () => {
    expect(wouldCreateCycle([{ source: 'a', target: 'b' }], 'b', 'a')).toBe(true)
  })

  it('detecta ciclo indireto A→B→C e tentativa C→A', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' }
    ]
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true)
  })

  it('permite ligação nova sem criar ciclo', () => {
    expect(wouldCreateCycle([{ source: 'a', target: 'b' }], 'a', 'c')).toBe(false)
  })
})
