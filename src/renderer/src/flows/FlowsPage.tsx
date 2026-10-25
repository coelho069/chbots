import { useCallback, useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { FlowDetail, FlowSummary } from '@shared/flows'
import { describeSchedule } from '@shared/schedule'
import type { Agent } from '@shared/types'
import { api } from '../api'
import { useCloseHandler } from '../CloseContext'
import { confirmUnsaved } from '../closeCurrent'
import { useToast } from '../toast'
import { FlowEditor } from './FlowEditor'
import { flowTemplates } from './templates'
import './flows.css'

interface FlowsPageProps {
  agents: Agent[]
  onDirtyChange?: (dirty: boolean) => void
}

export function FlowsPage({ agents, onDirtyChange }: FlowsPageProps) {
  const toast = useToast()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [current, setCurrent] = useState<FlowDetail | null>(null)
  const dirtyRef = useRef(false)
  const [draftId, setDraftId] = useState<number | null>(null)
  const saveRef = useRef<(() => Promise<boolean>) | null>(null)

  function closeCurrent() {
    dirtyRef.current = false
    setDraftId(null)
    setCurrent(null)
    onDirtyChange?.(false)
  }

  useCloseHandler(async () => {
    if (!current) return 'nothing'
    if (dirtyRef.current) {
      const ok = await confirmUnsaved(
        api.app.askUnsaved,
        `O fluxo "${current.name}" tem alterações não salvas.`,
        async () => (await saveRef.current?.()) ?? false
      )
      if (!ok) return 'cancelled'
    }
    closeCurrent()
    return 'closed'
  })

  const loadList = useCallback(async () => setFlows(await api.flows.list()), [])

  useEffect(() => {
    loadList().catch(toast.error)
  }, [loadList, toast.error])

  const confirmLeave = () => !dirtyRef.current || confirm('Há alterações não salvas neste fluxo. Descartar?')

  async function open(id: number) {
    if (current?.id === id || !confirmLeave()) return
    try {
      dirtyRef.current = false
      onDirtyChange?.(false)
      setCurrent(await api.flows.get(id))
    } catch (err) {
      toast.error(err)
    }
  }

  async function create() {
    if (!confirmLeave()) return
    try {
      const flow = await api.flows.create({ name: `Fluxo ${flows.length + 1}`, description: '' })
      dirtyRef.current = false
      onDirtyChange?.(false)
      await loadList()
      setCurrent(flow)
    } catch (err) {
      toast.error(err)
    }
  }

  // O modelo abre como rascunho: os nós de Agente vêm sem agente, então só é salvo depois de escolhido.
  async function createFromTemplate(index: number) {
    const tpl = flowTemplates[index]
    if (!tpl || !confirmLeave()) return
    try {
      const flow = await api.flows.create({ name: tpl.name, description: tpl.description })
      dirtyRef.current = true
      onDirtyChange?.(true)
      setDraftId(flow.id)
      await loadList()
      setCurrent({ ...flow, graph: tpl.graph })
    } catch (err) {
      toast.error(err)
    }
  }

  function showTemplates() {
    if (!confirmLeave()) return
    dirtyRef.current = false
    setCurrent(null)
    onDirtyChange?.(false)
  }

  async function remove() {
    if (!current || !confirm(`Excluir o fluxo "${current.name}" e seu histórico?`)) return
    try {
      await api.flows.remove(current.id)
      closeCurrent()
      await loadList()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page split flows-page">
      <aside className="list-pane">
        <div className="pane-header">
          <h2>Fluxos</h2>
          <div className="row">
            <button onClick={showTemplates}>Modelos</button>
            <button onClick={() => void create()}>+ Novo</button>
          </div>
        </div>
        <ul className="item-list">
          {flows.map((f) => (
            <li key={f.id}>
              <button className={`item ${current?.id === f.id ? 'active' : ''}`} onClick={() => void open(f.id)}>
                <span className="item-title">{f.name}</span>
                <span className="item-sub">
                  {f.schedule ? describeSchedule(f.schedule) : 'Manual'} · {f.nodeCount} nós
                </span>
              </button>
            </li>
          ))}
          {flows.length === 0 && <li className="muted pad">Nenhum fluxo ainda.</li>}
        </ul>
      </aside>

      {current ? (
        <ReactFlowProvider key={current.id}>
          <FlowEditor
            flow={current}
            agents={agents}
            onSaved={(saved) => {
              setDraftId(null)
              setCurrent(saved)
              void loadList()
            }}
            onDirtyChange={(d) => { dirtyRef.current = d; onDirtyChange?.(d) }}
            onDelete={() => void remove()}
            startDirty={draftId === current.id}
            saveRef={saveRef}
          />
        </ReactFlowProvider>
      ) : (
        <div className="page empty-state">
          <h2>Fluxos visuais</h2>
          <p>
            Encadeie agentes, condições e saídas num grafo. Cada nó recebe a saída do anterior. Até 10 nós por fluxo.
          </p>
          <button className="primary" onClick={() => void create()}>
            Criar fluxo em branco
          </button>
          <h3 style={{ marginTop: 20 }}>Modelos prontos</h3>
          <div className="template-picker" style={{ maxWidth: 480 }}>
            {flowTemplates.map((tpl, i) => (
              <button key={tpl.name} className="template-btn" onClick={() => void createFromTemplate(i)}>
                {tpl.name}
                <div className="muted small" style={{ fontWeight: 400, marginTop: 2 }}>
                  {tpl.description}
                </div>
              </button>
            ))}
          </div>
          <p className="muted small">O modelo abre como rascunho: escolha o agente de cada nó Agente para salvar.</p>
        </div>
      )}
    </div>
  )
}
