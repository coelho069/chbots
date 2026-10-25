import dagre from '@dagrejs/dagre'
import type { FlowGraph } from '@shared/flows'

export function autoLayout(graph: FlowGraph, nodeW = 220, nodeH = 90): FlowGraph {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of graph.nodes) g.setNode(n.id, { width: nodeW, height: nodeH })
  for (const e of graph.edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const { x, y } = g.node(n.id)
      return { ...n, position: { x: Math.round(x - nodeW / 2), y: Math.round(y - nodeH / 2) } }
    })
  }
}
