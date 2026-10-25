import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { ConditionBranch, FlowEdge, FlowGraph, FlowNode, FlowNodeDataMap, FlowNodeType } from '@shared/flows'

// O React Flow exige `data` indexável; a configuração do nó fica em `cfg`.
export type NodeCfg = { cfg: FlowNodeDataMap[FlowNodeType] }
export type RFNode = Node<NodeCfg, FlowNodeType>

export const branchLabels: Record<ConditionBranch, string> = { true: 'Sim', false: 'Não' }

export function edgeView(e: Pick<FlowEdge, 'id' | 'source' | 'target' | 'conditionValue'>): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.conditionValue,
    type: 'smoothstep',
    label: e.conditionValue ? branchLabels[e.conditionValue] : undefined,
    className: e.conditionValue ? `fedge fedge-${e.conditionValue}` : 'fedge',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }
  }
}

export function toRf(graph: FlowGraph): { nodes: RFNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { cfg: n.data },
      // o gatilho é obrigatório: não pode ser apagado pelo teclado
      deletable: n.type !== 'trigger'
    })),
    edges: graph.edges.map(edgeView)
  }
}

export function fromRf(nodes: RFNode[], edges: Edge[]): FlowGraph {
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]))
  return {
    nodes: nodes.map(
      (n) =>
        ({
          id: n.id,
          type: n.type,
          data: n.data.cfg,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        }) as FlowNode
    ),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      conditionValue:
        typeOf.get(e.source) === 'condition' && (e.sourceHandle === 'true' || e.sourceHandle === 'false')
          ? e.sourceHandle
          : null
    }))
  }
}

export function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
