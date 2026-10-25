import { useCallback, useEffect, useState } from 'react'
import type { Agent, Routine, RoutineRun } from '@shared/types'
import { api, formatDateTime } from '../api'
import { useToast } from '../toast'

interface Props {
  agents: Agent[]
  onOpenChat: (agentId: number, conversationId: number | null) => void
}

const statusLabels = { running: 'Rodando', ok: 'Concluída', error: 'Erro' } as const

function duration(run: RoutineRun): string {
  if (!run.finishedAt) return '—'
  const s = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`
}

export function RunsPage({ agents, onOpenChat }: Props) {
  const toast = useToast()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [runs, setRuns] = useState<RoutineRun[]>([])
  const [filter, setFilter] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [r, list] = await Promise.all([api.routines.list(), api.routines.runs(filter)])
    setRoutines(r)
    setRuns(list)
  }, [filter])

  useEffect(() => {
    load().catch(toast.error)
    return api.routines.onRunsChanged(() => void load().catch(() => undefined))
  }, [load, toast.error])

  const routineOf = (id: number) => routines.find((r) => r.id === id)
  const agentExists = (id: number | null | undefined) => id != null && agents.some((a) => a.id === id)

  return (
    <div className="page">
      <div className="pane-header">
        <h2>Execuções</h2>
        <select value={filter ?? ''} onChange={(e) => setFilter(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Todas as rotinas</option>
          {routines.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {runs.length === 0 ? (
        <p className="muted pad">Nenhuma execução registrada.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Rotina</th>
              <th>Início</th>
              <th>Duração</th>
              <th>Status</th>
              <th>Conversas</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const routine = routineOf(run.routineId)
              return (
                <tr key={run.id}>
                  <td>{routine?.name ?? `#${run.routineId}`}</td>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{duration(run)}</td>
                  <td>
                    <span className={`status status-${run.status}`}>{statusLabels[run.status]}</span>
                    {run.error && <div className="error-text">{run.error}</div>}
                  </td>
                  <td className="links">
                    {run.sourceConversationId !== null && agentExists(routine?.sourceAgentId) && (
                      <button className="link" onClick={() => onOpenChat(routine!.sourceAgentId, run.sourceConversationId)}>
                        origem
                      </button>
                    )}
                    {run.targetConversationId !== null && agentExists(routine?.targetAgentId) && (
                      <button className="link" onClick={() => onOpenChat(routine!.targetAgentId!, run.targetConversationId)}>
                        destino
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
