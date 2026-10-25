import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import {
  MAX_FLOW_NODES,
  defaultNodeData,
  flowNodeLabels,
  nodeRef,
  validateGraph,
  wouldCreateCycle,
  type FlowDetail,
  type FlowNodeDataMap,
  type FlowNodeType,
  type FlowRun,
  type FlowRunStep,
  type StepStatus
} from '@shared/flows'
import type { Agent } from '@shared/types'
import { api } from '../api'
import { CloseButton } from '../CloseContext'
import { useToast } from '../toast'
import { edgeView, fromRf, newId, toRf, type RFNode } from './convert'
import { Inspector } from './Inspector'
import { autoLayout } from './layout'
import { FlowViewContext, nodeTypes } from './nodes'
import { RunPanel, StepModal } from './RunViews'

type Mode = 'edit' | 'run'

interface Props {
  flow: FlowDetail
  agents: Agent[]
  onSaved: (flow: FlowDetail) => void
  onDirtyChange: (dirty: boolean) => void
  onDelete: () => void
  // grafo vindo de modelo, ainda não salvo (pode estar incompleto, ex.: sem agente)
  startDirty?: boolean
  // permite ao Ctrl+B salvar antes de fechar
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>
}

const addable: FlowNodeType[] = ['news', 'promptgen', 'agent', 'condition', 'output']
const structural = (c: { type: string }) => c.type !== 'select' && c.type !== 'dimensions'

// Map problems to affected node IDs by searching for nodeRef strings in the message
function buildNodeProblems(graph: ReturnType<typeof fromRf>, problems: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const problem of problems) {
    for (const node of graph.nodes) {
      const label = nodeRef(graph, node.id)
      if (problem.includes(label)) {
        result[node.id] = (result[node.id] ? result[node.id] + '\n' : '') + problem
      }
    }
  }
  // Also flag agent nodes with no agentId
  for (const node of graph.nodes) {
    if (node.type === 'agent' && node.data.agentId === null) {
      const msg = 'Escolha um agente para este nó.'
      result[node.id] = result[node.id] ? result[node.id] + '\n' + msg : msg
    }
  }
  // Flag condition nodes with empty value
  for (const node of graph.nodes) {
    if (node.type === 'condition' && !node.data.value) {
      const msg = 'Informe o texto a procurar.'
      result[node.id] = result[node.id] ? result[node.id] + '\n' + msg : msg
    }
  }
  return result
}

export function FlowEditor({ flow, agents, onSaved, onDirtyChange, onDelete, startDirty = false, saveRef }: Props) {
  const toast = useToast()
  const rf = useReactFlow<RFNode>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const initial = useMemo(() => toRf(flow.graph), [flow.graph])

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges)
  const [name, setName] = useState(flow.name)
  const [description, setDescription] = useState(flow.description)
  const [dirty, setDirtyState] = useState(startDirty)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<Mode>('edit')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [steps, setSteps] = useState<Record<string, FlowRunStep>>({})
  const [modalNodeId, setModalNodeId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [flowFullscreen, setFlowFullscreen] = useState(false)

  // Undo/redo: keep history of { nodes, edges } snapshots
  type Snapshot = { nodes: RFNode[]; edges: Edge[] }
  const pastRef = useRef<Snapshot[]>([])
  const futureRef = useRef<Snapshot[]>([])
  const clipboard = useRef<Snapshot | null>(null)

  const setDirty = useCallback(
    (value: boolean) => {
      setDirtyState(value)
      onDirtyChange(value)
    },
    [onDirtyChange]
  )

  useEffect(() => {
    if (startDirty) onDirtyChange(true)
  }, [startDirty, onDirtyChange])

  const graph = useMemo(() => fromRf(nodes, edges), [nodes, edges])
  const problems = useMemo(() => validateGraph(graph), [graph])
  const nodeProblems = useMemo(() => buildNodeProblems(graph, problems), [graph, problems])
  const running = runs.some((r) => r.status === 'running')
  const currentRun = runs.find((r) => r.id === selectedRunId) ?? null

  // ---- Undo/redo helpers ----
  const pushHistory = useCallback(() => {
    pastRef.current.push({ nodes, edges })
    if (pastRef.current.length > 50) pastRef.current.shift()
    futureRef.current = []
  }, [nodes, edges])

  const applySnapshot = useCallback(
    (snap: Snapshot) => {
      setNodes(snap.nodes)
      setEdges(snap.edges)
      setDirty(true)
    },
    [setNodes, setEdges, setDirty]
  )

  // ---- Execuções ----
  const selectedRunRef = useRef(selectedRunId)
  selectedRunRef.current = selectedRunId

  const loadSteps = useCallback(async (runId: number) => {
    const list = await api.flows.steps(runId)
    if (selectedRunRef.current === runId) setSteps(Object.fromEntries(list.map((s) => [s.nodeId, s])))
  }, [])

  const loadRuns = useCallback(async () => setRuns(await api.flows.runs(flow.id)), [flow.id])

  useEffect(() => {
    loadRuns().catch(toast.error)
  }, [loadRuns, toast.error])

  useEffect(() => {
    setSteps({})
    if (selectedRunId !== null) loadSteps(selectedRunId).catch(toast.error)
  }, [selectedRunId, loadSteps, toast.error])

  useEffect(() => {
    const offStep = api.flows.onStep((e) => {
      if (e.flowId !== flow.id) return
      if (e.runId === selectedRunRef.current) setSteps((s) => ({ ...s, [e.step.nodeId]: e.step }))
      if (e.step.status === 'success' || e.step.status === 'error') {
        setProgress((p) => p ? { ...p, done: p.done + 1 } : null)
      }
    })
    const offRuns = api.flows.onRunsChanged((flowId) => {
      if (flowId !== flow.id) return
      void loadRuns().catch(() => undefined)
      if (selectedRunRef.current !== null) void loadSteps(selectedRunRef.current).catch(() => undefined)
    })
    return () => {
      offStep()
      offRuns()
    }
  }, [flow.id, loadRuns, loadSteps])

  const statuses = useMemo<Record<string, StepStatus>>(
    () => (mode === 'run' ? Object.fromEntries(Object.values(steps).map((s) => [s.nodeId, s.status])) : {}),
    [mode, steps]
  )

  const shownEdges = useMemo(() => {
    if (mode !== 'run') return edges
    return edges.map((e) => {
      const from = steps[e.source]?.status
      const to = steps[e.target]?.status
      const active = from === 'success' && to !== undefined && to !== 'skipped'
      return active ? { ...e, className: `${e.className ?? ''} fedge-active`, animated: to === 'running' } : e
    })
  }, [mode, edges, steps])

  // ---- Autosave ----
  useEffect(() => {
    if (!dirty || problems.length > 0) return
    const timer = setTimeout(() => {
      void save()
    }, 2000)
    return () => clearTimeout(timer)
  }, [dirty, nodes, edges, name, description, problems]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFlowFullscreen(false); return }
      const active = document.activeElement
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
      if (e.key === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey && !typing) {
        e.preventDefault()
        setPanelOpen((v) => !v)
        return
      }
      if (!e.ctrlKey) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const prev = pastRef.current.pop()
        if (!prev) return
        futureRef.current.unshift({ nodes, edges })
        applySnapshot(prev)
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault()
        const next = futureRef.current.shift()
        if (!next) return
        pastRef.current.push({ nodes, edges })
        applySnapshot(next)
      } else if (e.key === 'c') {
        const selected = nodes.filter((n) => n.selected)
        if (selected.length === 0) return
        const ids = new Set(selected.map((n) => n.id))
        clipboard.current = {
          nodes: selected,
          edges: edges.filter((e2) => ids.has(e2.source) && ids.has(e2.target))
        }
      } else if (e.key === 'v') {
        if (!clipboard.current) return
        e.preventDefault()
        const idMap = new Map(clipboard.current.nodes.map((n) => [n.id, newId()]))
        const newNodes: RFNode[] = clipboard.current.nodes.map((n) => ({
          ...n,
          id: idMap.get(n.id)!,
          position: { x: n.position.x + 32, y: n.position.y + 32 },
          selected: true,
          deletable: true
        }))
        const newEdges: Edge[] = clipboard.current.edges.map((e2) => ({
          ...e2,
          id: newId(),
          source: idMap.get(e2.source)!,
          target: idMap.get(e2.target)!
        }))
        pushHistory()
        setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes])
        setEdges((es) => [...es, ...newEdges])
        setDirty(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodes, edges, applySnapshot, pushHistory, setNodes, setEdges, setDirty])

  // ---- Edição ----
  const handleNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      onNodesChange(changes)
      if (changes.some(structural)) {
        pushHistory()
        setDirty(true)
      }
      for (const c of changes) if (c.type === 'remove' && c.id === selectedId) setSelectedId(null)
    },
    [onNodesChange, setDirty, selectedId, pushHistory]
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes)
      if (changes.some(structural)) {
        pushHistory()
        setDirty(true)
      }
    },
    [onEdgesChange, setDirty, pushHistory]
  )

  const typeOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.type, [nodes])

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      if (typeOf(c.source) === 'output' || typeOf(c.target) === 'trigger') return false
      if (edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))
        return false
      return !wouldCreateCycle(edges, c.source, c.target)
    },
    [edges, typeOf]
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const conditionValue = typeOf(c.source) === 'condition' && (c.sourceHandle === 'true' || c.sourceHandle === 'false') ? c.sourceHandle : null
      pushHistory()
      setEdges((eds) => [...eds, edgeView({ id: newId(), source: c.source, target: c.target, conditionValue })])
      setDirty(true)
    },
    [setEdges, setDirty, typeOf, pushHistory]
  )

  function addNode(type: FlowNodeType) {
    if (nodes.length >= MAX_FLOW_NODES) {
      toast.error(new Error(`Limite de ${MAX_FLOW_NODES} nós por fluxo`))
      return
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    const center = rf.screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 600) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 400) / 2
    })
    const jitter = (nodes.length % 5) * 24
    const node: RFNode = {
      id: newId(),
      type,
      position: { x: Math.round(center.x - 100 + jitter), y: Math.round(center.y - 40 + jitter) },
      data: { cfg: defaultNodeData(type) },
      deletable: type !== 'trigger',
      selected: true
    }
    pushHistory()
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node])
    setSelectedId(node.id)
    setDirty(true)
  }

  function addNodeAt(type: FlowNodeType, x: number, y: number) {
    if (nodes.length >= MAX_FLOW_NODES) {
      toast.error(new Error(`Limite de ${MAX_FLOW_NODES} nós por fluxo`))
      return
    }
    const node: RFNode = {
      id: newId(),
      type,
      position: { x: Math.round(x), y: Math.round(y) },
      data: { cfg: defaultNodeData(type) },
      deletable: type !== 'trigger',
      selected: true
    }
    pushHistory()
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node])
    setSelectedId(node.id)
    setDirty(true)
  }

  function updateCfg(id: string, patch: Partial<FlowNodeDataMap[FlowNodeType]>) {
    pushHistory()
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { cfg: { ...n.data.cfg, ...patch } as RFNode['data']['cfg'] } } : n)))
    setDirty(true)
  }

  function deleteNode(id: string) {
    pushHistory()
    setNodes((ns) => ns.filter((n) => n.id !== id))
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
    setSelectedId(null)
    setDirty(true)
  }

  function doLayout() {
    const laid = autoLayout(graph)
    pushHistory()
    setNodes((ns) =>
      ns.map((n) => {
        const pos = laid.nodes.find((ln) => ln.id === n.id)?.position
        return pos ? { ...n, position: pos } : n
      })
    )
    setDirty(true)
    setTimeout(() => rf.fitView({ padding: 0.25 }), 50)
  }

  if (saveRef) saveRef.current = save

  async function save(): Promise<boolean> {
    setSaving(true)
    try {
      const saved = await api.flows.save(flow.id, { name, description, graph })
      setDirty(false)
      onSaved(saved)
      return true
    } catch (err) {
      toast.error(err)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    if (dirty && !(await save())) return
    try {
      const total = graph.nodes.filter((n) => n.type !== 'trigger').length + 1
      setProgress({ done: 0, total })
      const run = await api.flows.run(flow.id)
      setSelectedRunId(run.id)
      setMode('run')
      setModalNodeId(null)
      await loadRuns()
    } catch (err) {
      toast.error(err)
      setProgress(null)
    }
  }

  async function cancelRun() {
    if (!currentRun) return
    try {
      await api.flows.cancel(currentRun.id)
    } catch (err) {
      toast.error(err)
    }
  }

  // Drag from sidebar
  function onDragStart(e: React.DragEvent, type: FlowNodeType) {
    e.dataTransfer.setData('application/ch-bots-node', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/ch-bots-node') as FlowNodeType
    if (!type) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pos = rf.screenToFlowPosition({ x: e.clientX - rect.left + (canvasRef.current?.offsetLeft ?? 0), y: e.clientY - rect.top + (canvasRef.current?.offsetTop ?? 0) })
    addNodeAt(type, pos.x, pos.y)
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  // Export
  function exportJson() {
    const data = JSON.stringify({ name, description, graph }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/\s+/g, '-').toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import
  const importRef = useRef<HTMLInputElement>(null)
  function importJson(file: File) {
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as { name?: string; description?: string; graph?: unknown }
        if (!parsed.graph || typeof parsed.graph !== 'object') throw new Error('JSON inválido: campo "graph" ausente')
        const g = parsed.graph as Parameters<typeof validateGraph>[0]
        const probs = validateGraph(g)
        if (probs.length > 0) throw new Error('Grafo inválido:\n' + probs.join('\n'))
        pushHistory()
        const rf2 = toRf(g)
        setNodes(rf2.nodes)
        setEdges(rf2.edges)
        if (parsed.name) setName(parsed.name)
        if (parsed.description) setDescription(parsed.description)
        setDirty(true)
        toast.error(new Error('Fluxo importado. Revise os agentes e salve.'))
      } catch (err) {
        toast.error(err)
      }
    }
    reader.readAsText(file)
  }


  const selectedNode = mode === 'edit' && selectedId ? nodes.find((n) => n.id === selectedId) : undefined
  const modalNode = modalNodeId ? nodes.find((n) => n.id === modalNodeId) : undefined
  const hasTrigger = nodes.some((n) => n.type === 'trigger')

  return (
    <div className={`flow-editor${flowFullscreen ? ' flow-fs' : ''}`}>
      <div className="flow-toolbar">
        <div className="seg" role="group" aria-label="Modo">
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            Editar
          </button>
          <button
            className={mode === 'run' ? 'active' : ''}
            onClick={() => {
              setMode('run')
              if (selectedRunId === null && runs[0]) setSelectedRunId(runs[0].id)
            }}
          >
            Execução
          </button>
        </div>

        {mode === 'edit' && (
          <>
            <div className="undo-redo">
              <button title="Desfazer (Ctrl+Z)" onClick={() => {
                const prev = pastRef.current.pop()
                if (!prev) return
                futureRef.current.unshift({ nodes, edges })
                applySnapshot(prev)
              }} disabled={pastRef.current.length === 0}>↩</button>
              <button title="Refazer (Ctrl+Y)" onClick={() => {
                const next = futureRef.current.shift()
                if (!next) return
                pastRef.current.push({ nodes, edges })
                applySnapshot(next)
              }} disabled={futureRef.current.length === 0}>↪</button>
            </div>
            <button onClick={doLayout} title="Organizar nós automaticamente">Organizar ↓</button>
            <button onClick={exportJson} title="Exportar fluxo como JSON">⬇ JSON</button>
            <button onClick={() => importRef.current?.click()} title="Importar fluxo de JSON">⬆ JSON</button>
            <input ref={importRef} type="file" accept=".json" className="sr-only" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
            <span className="muted small">{nodes.length}/{MAX_FLOW_NODES} nós</span>
          </>
        )}

        {mode === 'run' && progress && (
          <div className="flow-progress">
            <div className="flow-progress-bar">
              <div className="flow-progress-fill" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
            <span>{progress.done} / {progress.total} nós</span>
          </div>
        )}

        <div className="toolbar-right">
          <button
            className="icon"
            title={panelOpen ? 'Recolher painel (F)' : 'Expandir painel (F)'}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? '⊟' : '⊞'}
          </button>
          <button
            className="icon"
            title={flowFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
            onClick={() => setFlowFullscreen((v) => !v)}
          >
            {flowFullscreen ? '⊡' : '⛶'}
          </button>
          {problems.length > 0 && (
            <span className="problems-badge" title={problems.join('\n')}>
              {problems.length} {problems.length === 1 ? 'problema' : 'problemas'}
            </span>
          )}
          <button onClick={() => void save()} disabled={saving || !dirty || mode !== 'edit' || problems.length > 0}
            title={problems.length > 0 ? problems.join('\n') : undefined}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          {running ? (
            <button onClick={() => void cancelRun()}>Cancelar</button>
          ) : (
            <button className="primary" onClick={() => void runNow()} disabled={problems.length > 0}>
              Rodar agora
            </button>
          )}
          <CloseButton label="Fechar fluxo" />
        </div>
      </div>

      <div className="flow-body" style={{
        display: 'grid',
        gridTemplateColumns: mode === 'edit'
          ? `160px 1fr${panelOpen ? ' 300px' : ''}`
          : `1fr${panelOpen ? ' 300px' : ''}`
      }}>
        {mode === 'edit' && (
          <aside className="flow-sidebar">
            <h4>Nós</h4>
            {!hasTrigger && (
              <div className="drag-item" draggable onDragStart={(e) => onDragStart(e, 'trigger')} onClick={() => addNode('trigger')}>
                <span>⚡</span> {flowNodeLabels.trigger}
              </div>
            )}
            {addable.map((t) => (
              <div
                key={t}
                className="drag-item"
                draggable={nodes.length < MAX_FLOW_NODES}
                aria-disabled={nodes.length >= MAX_FLOW_NODES}
                onDragStart={(e) => onDragStart(e, t)}
                onClick={() => addNode(t)}
              >
                <span>{t === 'news' ? '📰' : t === 'promptgen' ? '📝' : t === 'agent' ? '🤖' : t === 'condition' ? '◇' : '📤'}</span> {flowNodeLabels[t]}
              </div>
            ))}
          </aside>
        )}

        <div className={`flow-canvas mode-${mode}`} ref={canvasRef} onDrop={onDrop} onDragOver={onDragOver}>
          <FlowViewContext.Provider value={{ agents, statuses, nodeProblems: mode === 'edit' ? nodeProblems : {} }}>
            <ReactFlow<RFNode>
              nodes={nodes}
              edges={shownEdges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => (mode === 'edit' ? setSelectedId(node.id) : setModalNodeId(node.id))}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable={mode === 'edit'}
              nodesConnectable={mode === 'edit'}
              edgesFocusable={mode === 'edit'}
              deleteKeyCode={mode === 'edit' ? ['Delete', 'Backspace'] : null}
              snapToGrid
              snapGrid={[16, 16]}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
              minZoom={0.3}
              maxZoom={2}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} className="flow-bg" />
              <Controls showInteractive={false} className="flow-controls" />
              <MiniMap zoomable pannable className="react-flow__minimap" />
            </ReactFlow>
          </FlowViewContext.Provider>
        </div>

        {panelOpen && <aside className="flow-side">
          {mode === 'edit' && selectedNode && (
            <Inspector
              node={selectedNode}
              agents={agents}
              onChange={(patch) => updateCfg(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
            />
          )}

          {mode === 'edit' && !selectedNode && (
            <div className="form">
              <h3>Fluxo</h3>
              <label>
                Nome
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => {
                    setName(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label>
                Descrição
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              {problems.length > 0 ? (
                <div className="problems">
                  <strong>Antes de salvar:</strong>
                  <ul>
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted small">Grafo válido.</p>
              )}
              <p className="muted small">
                Arraste nós da barra lateral ou clique neles. Ligue os pontos para criar setas. Delete remove o item selecionado.
              </p>
              <div className="actions">
                <button className="danger" onClick={onDelete} disabled={running}>
                  Excluir fluxo
                </button>
              </div>
            </div>
          )}

          {mode === 'run' && (
            <div className="run-side">
              <h3>Execuções</h3>
              <p className="muted small">Clique num nó para ver a entrada e a saída.</p>
              <RunPanel runs={runs} selectedRunId={selectedRunId} graph={graph} onSelect={setSelectedRunId} />
            </div>
          )}
        </aside>}
      </div>

      {modalNode && (
        <StepModal
          label={nodeRef(graph, modalNode.id)}
          detail={
            'agentId' in modalNode.data.cfg
              ? (agents.find((a) => a.id === (modalNode.data.cfg as FlowNodeDataMap['agent']).agentId)?.name ?? 'agente removido')
              : null
          }
          step={steps[modalNode.id]}
          onClose={() => setModalNodeId(null)}
        />
      )}
    </div>
  )
}
