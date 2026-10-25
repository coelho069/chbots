import { useCallback, useEffect, useState } from 'react'
import type { Agent, BlackBoxEntry, BlackBoxFilters } from '@shared/types'
import { api, formatDateTime } from '../api'
import { useDebounce, useDebouncedCallback } from '../hooks'
import { useToast } from '../toast'

interface Props {
  agents: Agent[]
}

const statusLabels: Record<string, string> = { running: 'rodando', ok: 'ok', error: 'erro' }

export function BlackBoxPage({ agents }: Props) {
  const toast = useToast()
  const [entries, setEntries] = useState<BlackBoxEntry[]>([])
  const [filters, setFilters] = useState<BlackBoxFilters>({})
  const [busca, setBusca] = useState('')

  const buscaDebounced = useDebounce(busca, 300)

  const load = useCallback(() => {
    const f: BlackBoxFilters = { ...filters }
    if (buscaDebounced.trim()) f.busca = buscaDebounced.trim()
    api.blackbox.list(f).then(setEntries).catch(toast.error)
  }, [filters, buscaDebounced, toast.error])

  useEffect(() => { load() }, [load])

  const loadDebounced = useDebouncedCallback(load, 100)

  // Atualiza ao receber eventos de runs (agrupado a cada 100 ms)
  useEffect(() => {
    const u1 = api.flows.onRunsChanged(loadDebounced)
    const u2 = api.routines.onRunsChanged(loadDebounced)
    return () => { u1(); u2() }
  }, [loadDebounced])

  async function exportCsv() {
    try {
      const f: BlackBoxFilters = { ...filters }
      if (busca.trim()) f.busca = busca.trim()
      const csv = await api.blackbox.exportCsv(f)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `caixa-preta-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page scroll">
      <div className="pane-header">
        <h2>Caixa-Preta</h2>
        <button onClick={() => void exportCsv()}>Exportar CSV</button>
      </div>

      <div className="bb-filters">
        <select
          value={filters.tipo ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, tipo: (e.target.value as BlackBoxFilters['tipo']) || undefined }))}
        >
          <option value="">Todos os tipos</option>
          <option value="fluxo">Fluxo</option>
          <option value="rotina">Rotina</option>
        </select>

        <select
          value={filters.agentId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, agentId: e.target.value ? Number(e.target.value) : undefined }))}
        >
          <option value="">Todos os agentes</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <label className="check">
          <input
            type="checkbox"
            checked={filters.apenasErros ?? false}
            onChange={(e) => setFilters((f) => ({ ...f, apenasErros: e.target.checked || undefined }))}
          />
          Só erros
        </label>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou erro…"
          className="bb-search"
        />
      </div>

      {entries.length === 0 && <p className="muted pad">Nenhuma execução encontrada.</p>}

      <table className="bb-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Nome</th>
            <th>Status</th>
            <th>Início</th>
            <th>Fim</th>
            <th>Erro</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.tipo}-${e.execucaoId}`} className={e.status === 'error' ? 'bb-row-error' : e.status === 'running' ? 'bb-row-running' : ''}>
              <td><span className="tag">{e.tipo}</span></td>
              <td>{e.nome}</td>
              <td>{statusLabels[e.status] ?? e.status}</td>
              <td className="muted small">{formatDateTime(e.iniciadoEm)}</td>
              <td className="muted small">{e.finalizadoEm ? formatDateTime(e.finalizadoEm) : '—'}</td>
              <td className="muted small">{e.erro ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
