import type { Routine, RoutineInput, RoutineRun, RunStatus } from '@shared/types'
import { now, type Db } from '../connection'

interface RoutineRow {
  id: number
  name: string
  cron: string
  source_agent_id: number
  task_prompt: string
  target_agent_id: number | null
  handoff_prompt: string | null
  enabled: number
  last_run_at: string | null
  created_at: string
  last_output_hash: string | null
  notify_only_when_changed: number
}

interface RunRow {
  id: number
  routine_id: number
  started_at: string
  finished_at: string | null
  status: RunStatus
  source_conversation_id: number | null
  target_conversation_id: number | null
  error: string | null
}

const toRoutine = (r: RoutineRow): Routine => ({
  id: r.id,
  name: r.name,
  cron: r.cron,
  sourceAgentId: r.source_agent_id,
  taskPrompt: r.task_prompt,
  targetAgentId: r.target_agent_id,
  handoffPrompt: r.handoff_prompt,
  enabled: r.enabled === 1,
  lastRunAt: r.last_run_at,
  createdAt: r.created_at,
  lastOutputHash: r.last_output_hash,
  notifyOnlyWhenChanged: r.notify_only_when_changed === 1
})

const toRun = (r: RunRow): RoutineRun => ({
  id: r.id,
  routineId: r.routine_id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  sourceConversationId: r.source_conversation_id,
  targetConversationId: r.target_conversation_id,
  error: r.error
})

export function listRoutines(db: Db): Routine[] {
  return (db.prepare('SELECT * FROM routines ORDER BY name COLLATE NOCASE').all() as unknown as RoutineRow[]).map(
    toRoutine
  )
}

export function getRoutine(db: Db, id: number): Routine | null {
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined
  return row ? toRoutine(row) : null
}

export function insertRoutine(db: Db, r: RoutineInput): Routine {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO routines (name, cron, source_agent_id, task_prompt, target_agent_id, handoff_prompt, enabled, notify_only_when_changed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(r.name, r.cron, r.sourceAgentId, r.taskPrompt, r.targetAgentId, r.handoffPrompt, r.enabled ? 1 : 0, r.notifyOnlyWhenChanged ? 1 : 0, now())
  return getRoutine(db, Number(lastInsertRowid))!
}

export function updateRoutine(db: Db, id: number, r: RoutineInput): Routine {
  db.prepare(
    `UPDATE routines SET name = ?, cron = ?, source_agent_id = ?, task_prompt = ?, target_agent_id = ?,
       handoff_prompt = ?, enabled = ?, notify_only_when_changed = ?
     WHERE id = ?`
  ).run(r.name, r.cron, r.sourceAgentId, r.taskPrompt, r.targetAgentId, r.handoffPrompt, r.enabled ? 1 : 0, r.notifyOnlyWhenChanged ? 1 : 0, id)
  return getRoutine(db, id)!
}

export function updateRoutineHash(db: Db, id: number, hash: string): void {
  db.prepare('UPDATE routines SET last_output_hash = ? WHERE id = ?').run(hash, id)
}

export function deleteRoutine(db: Db, id: number): void {
  db.prepare('DELETE FROM routines WHERE id = ?').run(id)
}

export function listRuns(db: Db, routineId: number | null, limit = 200): RoutineRun[] {
  const rows =
    routineId === null
      ? db.prepare('SELECT * FROM routine_runs ORDER BY id DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY id DESC LIMIT ?').all(routineId, limit)
  return (rows as unknown as RunRow[]).map(toRun)
}

export function getRun(db: Db, id: number): RoutineRun | null {
  const row = db.prepare('SELECT * FROM routine_runs WHERE id = ?').get(id) as RunRow | undefined
  return row ? toRun(row) : null
}

export function startRun(db: Db, routineId: number): RoutineRun {
  const ts = now()
  const { lastInsertRowid } = db
    .prepare("INSERT INTO routine_runs (routine_id, started_at, status) VALUES (?, ?, 'running')")
    .run(routineId, ts)
  db.prepare('UPDATE routines SET last_run_at = ? WHERE id = ?').run(ts, routineId)
  return getRun(db, Number(lastInsertRowid))!
}

export function updateRun(
  db: Db,
  id: number,
  patch: Partial<Pick<RoutineRun, 'status' | 'sourceConversationId' | 'targetConversationId' | 'error'>>
): RoutineRun {
  const current = getRun(db, id)!
  const next = { ...current, ...patch }
  db.prepare(
    `UPDATE routine_runs SET status = ?, source_conversation_id = ?, target_conversation_id = ?, error = ?,
       finished_at = ?
     WHERE id = ?`
  ).run(
    next.status,
    next.sourceConversationId,
    next.targetConversationId,
    next.error,
    next.status === 'running' ? null : now(),
    id
  )
  return getRun(db, id)!
}

// Execuções que ficaram "running" porque o app foi fechado no meio.
export function failStaleRuns(db: Db): void {
  db.prepare(
    "UPDATE routine_runs SET status = 'error', error = 'Interrompida (app fechado)', finished_at = ? WHERE status = 'running'"
  ).run(now())
}
