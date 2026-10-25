import type {
  Flow,
  FlowDetail,
  FlowEdge,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  FlowRun,
  FlowRunStatus,
  FlowRunStep,
  FlowSummary,
  StepStatus
} from '@shared/flows'
import { now, transaction, type Db } from '../connection'

interface FlowRow {
  id: number
  name: string
  description: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: string
  type: FlowNodeType
  data_json: string
  position_x: number
  position_y: number
}

interface EdgeRow {
  id: string
  source_node: string
  target_node: string
  condition_value: 'true' | 'false' | null
}

interface RunRow {
  id: number
  flow_id: number
  trigger: 'manual' | 'schedule'
  started_at: string
  finished_at: string | null
  status: FlowRunStatus
  path_json: string
  error: string | null
}

interface StepRow {
  id: number
  run_id: number
  node_id: string
  status: StepStatus
  input: string
  output: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

const toFlow = (r: FlowRow): Flow => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toRun = (r: RunRow): FlowRun => ({
  id: r.id,
  flowId: r.flow_id,
  trigger: r.trigger,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  path: JSON.parse(r.path_json) as string[],
  error: r.error
})

const toStep = (r: StepRow): FlowRunStep => ({
  id: r.id,
  runId: r.run_id,
  nodeId: r.node_id,
  status: r.status,
  input: r.input,
  output: r.output,
  error: r.error,
  startedAt: r.started_at,
  finishedAt: r.finished_at
})

// ---- Fluxos e grafo ----

export function getFlow(db: Db, id: number): Flow | null {
  const row = db.prepare('SELECT * FROM flows WHERE id = ?').get(id) as FlowRow | undefined
  return row ? toFlow(row) : null
}

export function getFlowGraph(db: Db, flowId: number): FlowGraph {
  const nodes = (db.prepare('SELECT * FROM flow_nodes WHERE flow_id = ? ORDER BY rowid').all(flowId) as unknown as NodeRow[]).map(
    (r) => ({ id: r.id, type: r.type, data: JSON.parse(r.data_json), position: { x: r.position_x, y: r.position_y } }) as FlowNode
  )
  const edges = (db.prepare('SELECT * FROM flow_edges WHERE flow_id = ? ORDER BY rowid').all(flowId) as unknown as EdgeRow[]).map(
    (r): FlowEdge => ({ id: r.id, source: r.source_node, target: r.target_node, conditionValue: r.condition_value })
  )
  return { nodes, edges }
}

export function getFlowDetail(db: Db, id: number): FlowDetail | null {
  const flow = getFlow(db, id)
  return flow ? { ...flow, graph: getFlowGraph(db, id) } : null
}

export function listFlows(db: Db): FlowSummary[] {
  const rows = db.prepare('SELECT * FROM flows ORDER BY name COLLATE NOCASE').all() as unknown as FlowRow[]
  return rows.map((r) => {
    const graph = getFlowGraph(db, r.id)
    const trigger = graph.nodes.find((n) => n.type === 'trigger')
    const schedule = trigger?.type === 'trigger' && trigger.data.mode === 'schedule' ? trigger.data.cron : null
    return { ...toFlow(r), nodeCount: graph.nodes.length, schedule }
  })
}

export function insertFlow(db: Db, meta: { name: string; description: string }, graph: FlowGraph): FlowDetail {
  return transaction(db, () => {
    const ts = now()
    const { lastInsertRowid } = db
      .prepare('INSERT INTO flows (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(meta.name, meta.description, ts, ts)
    const id = Number(lastInsertRowid)
    writeGraph(db, id, graph)
    return getFlowDetail(db, id)!
  })
}

// Substitui o grafo inteiro numa transação: ou salva tudo, ou nada.
export function saveFlow(db: Db, id: number, meta: { name: string; description: string }, graph: FlowGraph): FlowDetail {
  return transaction(db, () => {
    db.prepare('UPDATE flows SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
      meta.name,
      meta.description,
      now(),
      id
    )
    db.prepare('DELETE FROM flow_edges WHERE flow_id = ?').run(id)
    db.prepare('DELETE FROM flow_nodes WHERE flow_id = ?').run(id)
    writeGraph(db, id, graph)
    return getFlowDetail(db, id)!
  })
}

function writeGraph(db: Db, flowId: number, graph: FlowGraph): void {
  const insertNode = db.prepare(
    'INSERT INTO flow_nodes (id, flow_id, type, data_json, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?)'
  )
  for (const n of graph.nodes)
    insertNode.run(n.id, flowId, n.type, JSON.stringify(n.data), n.position.x, n.position.y)
  const insertEdge = db.prepare(
    'INSERT INTO flow_edges (id, flow_id, source_node, target_node, condition_value) VALUES (?, ?, ?, ?, ?)'
  )
  for (const e of graph.edges) insertEdge.run(e.id, flowId, e.source, e.target, e.conditionValue)
}

export function deleteFlow(db: Db, id: number): void {
  db.prepare('DELETE FROM flows WHERE id = ?').run(id)
}

// ---- Execuções ----

export function insertFlowRun(db: Db, flowId: number, trigger: FlowRun['trigger']): FlowRun {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO flow_runs (flow_id, trigger, started_at, status) VALUES (?, ?, ?, 'running')")
    .run(flowId, trigger, now())
  return getFlowRun(db, Number(lastInsertRowid))!
}

export function getFlowRun(db: Db, id: number): FlowRun | null {
  const row = db.prepare('SELECT * FROM flow_runs WHERE id = ?').get(id) as RunRow | undefined
  return row ? toRun(row) : null
}

export function finishFlowRun(db: Db, id: number, status: Exclude<FlowRunStatus, 'running'>, path: string[], error: string | null): FlowRun {
  db.prepare('UPDATE flow_runs SET status = ?, path_json = ?, error = ?, finished_at = ? WHERE id = ?').run(
    status,
    JSON.stringify(path),
    error,
    now(),
    id
  )
  return getFlowRun(db, id)!
}

export function listFlowRuns(db: Db, flowId: number, limit = 100): FlowRun[] {
  const rows = db.prepare('SELECT * FROM flow_runs WHERE flow_id = ? ORDER BY id DESC LIMIT ?').all(flowId, limit)
  return (rows as unknown as RunRow[]).map(toRun)
}

export function failStaleFlowRuns(db: Db): void {
  const ts = now()
  db.prepare(
    "UPDATE flow_runs SET status = 'error', error = 'Interrompida (app fechado)', finished_at = ? WHERE status = 'running'"
  ).run(ts)
  db.prepare("UPDATE flow_run_steps SET status = 'error', error = 'Interrompida', finished_at = ? WHERE status = 'running'").run(ts)
}

export function insertStep(db: Db, runId: number, nodeId: string, status: StepStatus, input: string): FlowRunStep {
  const ts = now()
  const { lastInsertRowid } = db
    .prepare('INSERT INTO flow_run_steps (run_id, node_id, status, input, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, nodeId, status, input, ts, status === 'running' ? null : ts)
  return getStep(db, Number(lastInsertRowid))!
}

export function finishStep(db: Db, id: number, status: StepStatus, output: string | null, error: string | null): FlowRunStep {
  db.prepare('UPDATE flow_run_steps SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?').run(
    status,
    output,
    error,
    now(),
    id
  )
  return getStep(db, id)!
}

function getStep(db: Db, id: number): FlowRunStep | null {
  const row = db.prepare('SELECT * FROM flow_run_steps WHERE id = ?').get(id) as StepRow | undefined
  return row ? toStep(row) : null
}

export function listSteps(db: Db, runId: number): FlowRunStep[] {
  return (db.prepare('SELECT * FROM flow_run_steps WHERE run_id = ? ORDER BY id').all(runId) as unknown as StepRow[]).map(toStep)
}
