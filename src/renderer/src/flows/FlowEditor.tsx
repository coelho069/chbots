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
import type { Agent, FlowInterruptEvent, FlowRunState } from '@shared/types'
import { api } from '../api'
import { CloseButton } from '../CloseContext'
import { useToast } from '../toast'
import { edgeView, fromRf, newId, toRf, type RFNode } from './convert'
import { Inspector } from './Inspector'
import { autoLayout } from './layout'
import { FlowViewContext, nodeTypes } from './nodes'
import { RunPanel, StepModal } from './RunViews'

// ---- localStorage helpers ----
function loadPref<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? (JSON.parse(v) as T) : def } catch { return def }
}
function savePref<T>(key: string, v: T): void {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch {}
}

// ---- Palette groups ----
const paletteIcons: Partial<Record<FlowNodeType, string>> = {
  trigger: '⚡', agent: '🤖', promptgen: '✍', delegate: '↗',
  'mcp-tool': '🔧', news: '📰', condition: '◇', memory: '💾', output: '📤'
}
const paletteGroups: { label: string; types: FlowNodeType[] }[] = [
  { label: 'Agentes', types: ['agent', 'promptgen', 'delegate'] },
  { label: 'Ferramentas', types: ['mcp-tool', 'news'] },
  { label: 'Lógica', types: ['condition', 'memory'] },
  { label: 'Saída', types: ['output'] }
]

interface Props {
  flow: FlowDetail
  agents: Agent[]
  onSaved: (flow: FlowDetail) => void
  onDirtyChange: (dirty: boolean) => void
  onDelete: () => void
  startDirty?: boolean
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>
}

const structural = (c: { type: string }) => c.type !== 'select' && c.type !== 'dimensions'

function buildNodeProblems(graph: ReturnType<typeof fromRf>, problems: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const problem of problems) {
    for (const node of graph.nodes) {
      const label = nodeRef(graph, node.id)
      if (problem.includes(label)) result[node.id] = (result[node.id] ? result[node.id] + '\n' : '') + problem
    }
  }
  for (const node of graph.nodes) {
    if (node.type === 'agent' && node.data.agentId === null) {
      const msg = 'Escolha um agente para este nó.'
      result[node.id] = result[node.id] ? result[node.id] + '\n' + msg : msg
    }
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [steps, setSteps] = useState<Record<string, FlowRunStep>>({})
  const [modalNodeId, setModalNodeId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [activeTab, setActiveTab] = useState<'props' | 'run'>('props')
  const [paletteSearch, setPaletteSearch] = useState('')
  const [pendingInterrupt, setPendingInterrupt] = useState<FlowInterruptEvent | null>(null)
  const [runState, setRunState] = useState<FlowRunState | null>(null)

  // Panel open/closed with localStorage
  const [leftOpen, setLeftOpenState] = useState(() => loadPref('flows.leftOpen', true))
  const [rightOpen, setRightOpenState] = useState(() => loadPref('flows.rightOpen', true))
  const [focusMode, setFocusModeState] = useState(false)
  const [showMinimap, setShowMinimap] = useState(() => loadPref('flows.minimap', true))

  const setLeftOpen = (v: boolean) => { setLeftOpenState(v); savePref('flows.leftOpen', v) }
  const setRightOpen = (v: boolean) => { setRightOpenState(v); savePref('flows.rightOpen', v) }
  const toggleFocus = () => setFocusModeState((f) => !f)

  // Undo/redo
  type Snapshot = { nodes: RFNode[]; edges: Edge[] }
  const pastRef = useRef<Snapshot[]>([])
  const futureRef = useRef<Snapshot[]>([])
  const clipboard = useRef<Snapshot | null>(null)

  const setDirty = useCallback((value: boolean) => { setDirtyState(value); onDirtyChange(value) }, [onDirtyChange])

  useEffect(() => { if (startDirty) onDirtyChange(true) }, [startDirty, onDirtyChange])

  const graph = useMemo(() => fromRf(nodes, edges), [nodes, edges])
  const problems = useMemo(() => validateGraph(graph), [graph])
  const nodeProblems = useMemo(() => buildNodeProblems(graph, problems), [graph, problems])
  const running = runs.some((r) => r.status === 'running')
  const currentRun = runs.find((r) => r.id === selectedRunId) ?? null
  const isEditMode = !running && activeTab === 'props'

  const pushHistory = useCallback(() => {
    pastRef.current.push({ nodes, edges })
    if (pastRef.current.length > 50) pastRef.current.shift()
    futureRef.current = []
  }, [nodes, edges])

  const applySnapshot = useCallback((snap: Snapshot) => {
    setNodes(snap.nodes); setEdges(snap.edges); setDirty(true)
  }, [setNodes, setEdges, setDirty])

  // ---- Execuções ----
  const selectedRunRef = useRef(selectedRunId)
  selectedRunRef.current = selectedRunId

  const loadSteps = useCallback(async (runId: number) => {
    const list = await api.flows.steps(runId)
    if (selectedRunRef.current === runId) setSteps(Object.fromEntries(list.map((s) => [s.nodeId, s])))
  }, [])

  const loadRuns = useCallback(async () => setRuns(await api.flows.runs(flow.id)), [flow.id])

  useEffect(() => { loadRuns().catch(toast.error) }, [loadRuns, toast.error])
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
        if (selectedRunRef.current !== null)
          void api.flows.status(selectedRunRef.current).then((s) => setRunState(s)).catch(() => undefined)
      }
    })
    const offRuns = api.flows.onRunsChanged((flowId) => {
      if (flowId !== flow.id) return
      void loadRuns().catch(() => undefined)
      if (selectedRunRef.current !== null) void loadSteps(selectedRunRef.current).catch(() => undefined)
    })
    const offInterrupt = api.flows.onInterrupt((ev) => {
      if (ev.flowId !== flow.id) return
      setPendingInterrupt(ev)
      setActiveTab('run')
      if (!rightOpen) setRightOpen(true)
    })
    return () => { offStep(); offRuns(); offInterrupt() }
  }, [flow.id, loadRuns, loadSteps, rightOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const statuses = useMemo<Record<string, StepStatus>>(
    () => (running || currentRun ? Object.fromEntries(Object.values(steps).map((s) => [s.nodeId, s.status])) : {}),
    [running, currentRun, steps]
  )

  const shownEdges = useMemo(() => {
    if (!running && !currentRun) return edges
    return edges.map((e) => {
      const from = steps[e.source]?.status
      const to = steps[e.target]?.status
      const active = from === 'success' && to !== undefined && to !== 'skipped'
      return active ? { ...e, className: `${e.className ?? ''} fedge-active`, animated: to === 'running' } : e
    })
  }, [running, currentRun, edges, steps])

  // Autosave
  useEffect(() => {
    if (!dirty || problems.length > 0) return
    const timer = setTimeout(() => { void save() }, 2000)
    return () => clearTimeout(timer)
  }, [dirty, nodes, edges, name, description, problems]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFocusModeState(false); return }
      const active = document.activeElement
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
      if (!typing) {
        // [ and ] toggle panels (avoids Ctrl+B conflict with global close shortcut)
        if (e.key === '[' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setLeftOpen(!leftOpen); return }
        if (e.key === ']' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setRightOpen(!rightOpen); return }
        if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFocus(); return }
        if (e.key === 'm' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShowMinimap((v) => !v); savePref('flows.minimap', !showMinimap); return }
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
        clipboard.current = { nodes: selected, edges: edges.filter((e2) => ids.has(e2.source) && ids.has(e2.target)) }
      } else if (e.key === 'v') {
        if (!clipboard.current) return
        e.preventDefault()
        const idMap = new Map(clipboard.current.nodes.map((n) => [n.id, newId()]))
        const newNodes: RFNode[] = clipboard.current.nodes.map((n) => ({
          ...n, id: idMap.get(n.id)!, position: { x: n.position.x + 32, y: n.position.y + 32 }, selected: true, deletable: true
        }))
        const newEdges: Edge[] = clipboard.current.edges.map((e2) => ({
          ...e2, id: newId(), source: idMap.get(e2.source)!, target: idMap.get(e2.target)!
        }))
        pushHistory()
        setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes])
        setEdges((es) => [...es, ...newEdges])
        setDirty(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodes, edges, leftOpen, rightOpen, showMinimap, applySnapshot, pushHistory, setNodes, setEdges, setDirty]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Edição ----
  const handleNodesChange = useCallback((changes: NodeChange<RFNode>[]) => {
    onNodesChange(changes)
    if (changes.some(structural)) { pushHistory(); setDirty(true) }
    for (const c of changes) if (c.type === 'remove' && c.id === selectedId) setSelectedId(null)
  }, [onNodesChange, setDirty, selectedId, pushHistory])

  const handleEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    onEdgesChange(changes)
    if (changes.some(structural)) { pushHistory(); setDirty(true) }
  }, [onEdgesChange, setDirty, pushHistory])

  const typeOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.type, [nodes])

  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false
    if (typeOf(c.source) === 'output' || typeOf(c.target) === 'trigger') return false
    if (edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))) return false
    return !wouldCreateCycle(edges, c.source, c.target)
  }, [edges, typeOf])

  const onConnect = useCallback((c: Connection) => {
    const conditionValue = typeOf(c.source) === 'condition' && (c.sourceHandle === 'true' || c.sourceHandle === 'false') ? c.sourceHandle : null
    pushHistory()
    setEdges((eds) => [...eds, edgeView({ id: newId(), source: c.source, target: c.target, conditionValue })])
    setDirty(true)
  }, [setEdges, setDirty, typeOf, pushHistory])

  function addNode(type: FlowNodeType) {
    if (nodes.length >= MAX_FLOW_NODES) { toast.error(new Error(`Limite de ${MAX_FLOW_NODES} nós por fluxo`)); return }
    const rect = canvasRef.current?.getBoundingClientRect()
    const center = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 600) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 400) / 2 })
    const jitter = (nodes.length % 5) * 24
    const node: RFNode = {
      id: newId(), type, position: { x: Math.round(center.x - 100 + jitter), y: Math.round(center.y - 40 + jitter) },
      data: { cfg: defaultNodeData(type) }, deletable: type !== 'trigger', selected: true
    }
    pushHistory()
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node])
    setSelectedId(node.id)
    setDirty(true)
  }

  function addNodeAt(type: FlowNodeType, x: number, y: number) {
    if (nodes.length >= MAX_FLOW_NODES) { toast.error(new Error(`Limite de ${MAX_FLOW_NODES} nós por fluxo`)); return }
    const node: RFNode = {
      id: newId(), type, position: { x: Math.round(x), y: Math.round(y) },
      data: { cfg: defaultNodeData(type) }, deletable: type !== 'trigger', selected: true
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
    setNodes((ns) => ns.map((n) => { const pos = laid.nodes.find((ln) => ln.id === n.id)?.position; return pos ? { ...n, position: pos } : n }))
    setDirty(true)
    setTimeout(() => rf.fitView({ padding: 0.25 }), 50)
  }

  if (saveRef) saveRef.current = save

  async function save(): Promise<boolean> {
    setSaving(true)
    try {
      const saved = await api.flows.save(flow.id, { name, description, graph })
      setDirty(false); onSaved(saved); return true
    } catch (err) { toast.error(err); return false } finally { setSaving(false) }
  }

  async function runNow() {
    if (dirty && !(await save())) return
    try {
      const total = graph.nodes.filter((n) => n.type !== 'trigger').length + 1
      setProgress({ done: 0, total }); setRunState(null); setPendingInterrupt(null)
      const run = await api.flows.run(flow.id)
      setSelectedRunId(run.id)
      setActiveTab('run')
      setModalNodeId(null)
      await loadRuns()
    } catch (err) { toast.error(err); setProgress(null) }
  }

  async function cancelRun() {
    if (!currentRun) return
    try { await api.flows.cancel(currentRun.id) } catch (err) { toast.error(err) }
  }

  async function respondInterrupt(approved: boolean) {
    if (!pendingInterrupt) return
    const runId = pendingInterrupt.runId
    setPendingInterrupt(null)
    try { await api.flows.interruptRespond(runId, approved) } catch (err) { toast.error(err) }
  }

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

  function exportJson() {
    const blob = new Blob([JSON.stringify({ name, description, graph }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${name.replace(/\s+/g, '-').toLowerCase()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

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
        const rf2 = toRf(g); setNodes(rf2.nodes); setEdges(rf2.edges)
        if (parsed.name) setName(parsed.name)
        if (parsed.description) setDescription(parsed.description)
        setDirty(true)
        toast.error(new Error('Fluxo importado. Revise os agentes e salve.'))
      } catch (err) { toast.error(err) }
    }
    reader.readAsText(file)
  }

  const hasTrigger = nodes.some((n) => n.type === 'trigger')
  const selectedNode = isEditMode && selectedId ? nodes.find((n) => n.id === selectedId) : undefined
  const modalNode = modalNodeId ? nodes.find((n) => n.id === modalNodeId) : undefined

  // Filtered palette items
  const filteredGroups = useMemo(() => {
    const q = paletteSearch.toLowerCase()
    return paletteGroups.map((g) => ({
      ...g,
      types: g.types.filter((t) => !q || flowNodeLabels[t].toLowerCase().includes(q))
    })).filter((g) => g.types.length > 0)
  }, [paletteSearch])

  return (
    <div className="flow-editor">
      {/* ── Top bar ── */}
      <div className="flow-topbar">
        <div className="topbar-left">
          <button
            className={`panel-tog ${leftOpen && !focusMode ? 'open' : ''}`}
            title={`${leftOpen ? 'Recolher' : 'Abrir'} paleta  [  `}
            onClick={() => setLeftOpen(!leftOpen)}
            disabled={focusMode}
            aria-label="Alternar paleta"
          >‹</button>
          <input
            className="flow-name-input"
            value={name}
            maxLength={80}
            onChange={(e) => { setName(e.target.value); setDirty(true) }}
            aria-label="Nome do fluxo"
          />
          {problems.length > 0 && (
            <span className="problems-badge" title={problems.join('\n')}>
              {problems.length} {problems.length === 1 ? 'problema' : 'problemas'}
            </span>
          )}
        </div>

        <div className="topbar-center">
          {progress && (
            <div className="flow-progress">
              <div className="flow-progress-bar">
                <div className="flow-progress-fill" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
              <span>{progress.done}/{progress.total}</span>
            </div>
          )}
        </div>

        <div className="topbar-right">
          <div className="topbar-edit-btns">
            <button title="Desfazer (Ctrl+Z)" onClick={() => { const p = pastRef.current.pop(); if (!p) return; futureRef.current.unshift({ nodes, edges }); applySnapshot(p) }} disabled={pastRef.current.length === 0}>↩</button>
            <button title="Refazer (Ctrl+Y)" onClick={() => { const n = futureRef.current.shift(); if (!n) return; pastRef.current.push({ nodes, edges }); applySnapshot(n) }} disabled={futureRef.current.length === 0}>↪</button>
            <button onClick={doLayout} title="Organizar nós">⤢</button>
            <button onClick={exportJson} title="Exportar JSON">↓</button>
            <button onClick={() => importRef.current?.click()} title="Importar JSON">↑</button>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
          </div>
          <button onClick={() => rf.fitView({ padding: 0.2 })} title="Zoom para caber">⊡</button>
          <button
            className={focusMode ? 'active' : ''}
            title="Modo foco (F)"
            onClick={toggleFocus}
          >⊞</button>
          <button
            onClick={() => void save()}
            disabled={saving || !dirty || problems.length > 0}
            title={problems.length > 0 ? problems.join('\n') : undefined}
          >{saving ? '…' : 'Salvar'}</button>
          {running ? (
            <button onClick={() => void cancelRun()} className="danger">Parar</button>
          ) : (
            <button className="primary" onClick={() => void runNow()} disabled={problems.length > 0}>Executar</button>
          )}
          <CloseButton label="Fechar" />
          <button
            className={`panel-tog ${rightOpen && !focusMode ? 'open' : ''}`}
            title={`${rightOpen ? 'Recolher' : 'Abrir'} painel  ]  `}
            onClick={() => setRightOpen(!rightOpen)}
            disabled={focusMode}
            aria-label="Alternar painel"
          >›</button>
        </div>
      </div>

      {/* ── Body: 3 colunas ── */}
      <div
        className="flow-body-3col"
        data-left={(!focusMode && leftOpen) ? 'open' : 'closed'}
        data-right={(!focusMode && rightOpen) ? 'open' : 'closed'}
      >
        {/* ── Paleta esquerda ── */}
        <aside className="flow-left-panel" aria-hidden={focusMode || !leftOpen}>
          <div className="palette-search">
            <input
              value={paletteSearch}
              onChange={(e) => setPaletteSearch(e.target.value)}
              placeholder="Buscar nós…"
              aria-label="Buscar nós"
            />
          </div>
          {!hasTrigger && !paletteSearch && (
            <div className="palette-group">
              <span className="palette-group-label">Início</span>
              <div
                className="drag-item"
                draggable
                onDragStart={(e) => onDragStart(e, 'trigger')}
                onClick={() => addNode('trigger')}
                title="Gatilho de início"
              >
                <span>⚡</span> Gatilho
              </div>
            </div>
          )}
          {filteredGroups.map((g) => (
            <div key={g.label} className="palette-group">
              <span className="palette-group-label">{g.label}</span>
              {g.types.map((t) => (
                <div
                  key={t}
                  className="drag-item"
                  draggable={nodes.length < MAX_FLOW_NODES}
                  aria-disabled={nodes.length >= MAX_FLOW_NODES}
                  onDragStart={(e) => onDragStart(e, t)}
                  onClick={() => addNode(t)}
                  title={flowNodeLabels[t]}
                >
                  <span>{paletteIcons[t] ?? '•'}</span>
                  {flowNodeLabels[t]}
                </div>
              ))}
            </div>
          ))}
          <div className="palette-footer muted small">
            {nodes.length}/{MAX_FLOW_NODES} nós · [/] recolher
          </div>
        </aside>

        {/* ── Canvas ── */}
        <div
          className={`flow-canvas mode-${isEditMode ? 'edit' : 'run'}`}
          ref={canvasRef}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        >
          <FlowViewContext.Provider value={{ agents, statuses, nodeProblems: isEditMode ? nodeProblems : {} }}>
            <ReactFlow<RFNode>
              nodes={nodes}
              edges={shownEdges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => isEditMode ? setSelectedId(node.id) : setModalNodeId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable={isEditMode}
              nodesConnectable={isEditMode}
              edgesFocusable={isEditMode}
              deleteKeyCode={isEditMode ? ['Delete', 'Backspace'] : null}
              snapToGrid
              snapGrid={[16, 16]}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
              minZoom={0.3}
              maxZoom={2}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} className="flow-bg" />
              <Controls showInteractive={false} className="flow-controls" />
              {showMinimap && <MiniMap zoomable pannable className="react-flow__minimap" />}
            </ReactFlow>
          </FlowViewContext.Provider>
        </div>

        {/* ── Painel direito ── */}
        <aside className="flow-right-panel" aria-hidden={focusMode || !rightOpen}>
          {/* Abas */}
          <div className="panel-tabs">
            <button
              className={activeTab === 'props' ? 'active' : ''}
              onClick={() => setActiveTab('props')}
            >Propriedades</button>
            <button
              className={activeTab === 'run' ? 'active' : ''}
              onClick={() => setActiveTab('run')}
            >Execução {running ? '⬤' : ''}</button>
          </div>

          <div className="panel-scroll">
            {/* Tab: Propriedades */}
            {activeTab === 'props' && (
              <>
                {selectedNode ? (
                  <Inspector
                    node={selectedNode}
                    agents={agents}
                    onChange={(patch) => updateCfg(selectedNode.id, patch)}
                    onDelete={() => deleteNode(selectedNode.id)}
                  />
                ) : (
                  <div className="form">
                    <h3>Fluxo</h3>
                    <label>
                      Descrição
                      <textarea rows={3} value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true) }} />
                    </label>
                    {problems.length > 0 ? (
                      <div className="problems">
                        <strong>Antes de salvar:</strong>
                        <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                      </div>
                    ) : (
                      <p className="muted small">Grafo válido.</p>
                    )}
                    <p className="muted small">Arraste nós da paleta ou clique. Delete remove o selecionado.</p>
                    <div className="actions">
                      <button className="danger" onClick={onDelete} disabled={running}>Excluir fluxo</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Tab: Execução */}
            {activeTab === 'run' && (
              <div className="run-side">
                {pendingInterrupt && (
                  <div className="interrupt-card">
                    <strong>Aprovação necessária</strong>
                    <p className="small" style={{ margin: '4px 0 0' }}>{pendingInterrupt.description}</p>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button className="primary" onClick={() => void respondInterrupt(true)}>Aprovar</button>
                      <button className="danger" onClick={() => void respondInterrupt(false)}>Rejeitar</button>
                    </div>
                  </div>
                )}
                {runState && (runState.ultimoResultado || Object.keys(runState.vars).length > 0) && (
                  <div className="run-state-panel">
                    <h4>Estado</h4>
                    {runState.ultimoResultado && (
                      <pre className="run-state-value">{runState.ultimoResultado.slice(0, 300)}</pre>
                    )}
                    {Object.keys(runState.vars).length > 0 && (
                      <details>
                        <summary className="muted small">Variáveis ({Object.keys(runState.vars).length})</summary>
                        <pre className="run-state-value">{JSON.stringify(runState.vars, null, 2).slice(0, 500)}</pre>
                      </details>
                    )}
                  </div>
                )}
                <p className="muted small">Clique num nó para ver a entrada e a saída.</p>
                <RunPanel runs={runs} selectedRunId={selectedRunId} graph={graph} onSelect={setSelectedRunId} />
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Modal de step (clique em nó no modo execução) */}
      {modalNode && (
        <StepModal
          label={nodeRef(graph, modalNode.id)}
          detail={'agentId' in modalNode.data.cfg ? (agents.find((a) => a.id === (modalNode.data.cfg as FlowNodeDataMap['agent']).agentId)?.name ?? 'agente removido') : null}
          step={steps[modalNode.id]}
          onClose={() => setModalNodeId(null)}
        />
      )}
    </div>
  )
}
