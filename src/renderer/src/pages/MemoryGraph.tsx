import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import {
  defaultGraphConfig,
  type GraphConfig, type GraphGroup, type LigacaoTipo,
  type MemoryCategoria, type MemoryFato, type MemoryLigacao, type NodePosition
} from '@shared/types'
import { api, errorMessage } from '../api'
import { useToast } from '../toast'
import {
  chronologicalOrder, degreeMap, groupColorMap, hasConflictLink, hasEntityLink,
  isOrphan, labelAlpha, localGraph, neighborsOf, nodeRadius
} from './memoryGraphLogic'

interface GNode {
  id: number; fato: string; categoria: string; confianca: number
  status: string; confirmacoes: number; degree: number
  x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number
  color?: string
}
interface GLink { source: number | GNode; target: number | GNode; tipo: LigacaoTipo; id: number }

const LINK_LABEL: Record<LigacaoTipo, string> = {
  mesma_fonte: 'mesma fonte', mesma_entidade: 'mesma entidade',
  similar: 'similar', conflito: 'conflito', manual: 'manual'
}
const MAX_INITIAL = 300
const LOAD_MORE = 100

function sealLabel(f: { confianca: number; status: string }): string {
  if (f.status === 'arquivado') return 'Arquivado'
  if (f.status === 'conflito') return '⚠ Conflito'
  if (f.confianca >= 70) return '✓ Verificado'
  if (f.confianca >= 40) return '~ Provável'
  return '? Duvidoso'
}

// Força central própria (puxa para 0,0): interface compatível com d3-force.
function makeCenterForce(strength: number) {
  let nodes: GNode[] = []
  const force = ((alpha: number) => {
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue
      n.vx = (n.vx ?? 0) + (0 - n.x) * strength * alpha
      n.vy = (n.vy ?? 0) + (0 - n.y) * strength * alpha
    }
  }) as ((alpha: number) => void) & { initialize: (ns: GNode[]) => void }
  force.initialize = (ns: GNode[]) => { nodes = ns }
  return force
}

function linkEnds(link: GLink): [number, number] {
  const s = typeof link.source === 'object' ? link.source.id : link.source
  const t = typeof link.target === 'object' ? link.target.id : link.target
  return [s, t]
}

// ---- mini grafo local (vizinhos de um fato) ----

interface LocalProps {
  center: MemoryFato; fatos: MemoryFato[]; ligacoes: MemoryLigacao[]
  depth: number; onDepth: (d: number) => void
  colors: Map<number, string>; onSelect: (f: MemoryFato) => void
}

function LocalGraph({ center, fatos, ligacoes, depth, onDepth, colors, onSelect }: LocalProps) {
  const ref = useRef<ForceGraphMethods<GNode, GLink>>(null)
  const data = useMemo(() => {
    const local = localGraph(center.id, fatos, ligacoes, depth)
    const deg = degreeMap(local.links)
    const nodes: GNode[] = local.nodes.map((f) => ({
      id: f.id, fato: f.fato, categoria: f.categoria, confianca: f.confianca,
      status: f.status, confirmacoes: f.confirmacoes, degree: deg.get(f.id) ?? 0,
      color: colors.get(f.id) ?? '#888'
    }))
    const links: GLink[] = local.links.map((l) => ({ source: l.origemId, target: l.destinoId, tipo: l.tipo, id: l.id }))
    return { nodes, links }
  }, [center.id, fatos, ligacoes, depth, colors])

  useEffect(() => {
    const fg = ref.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-90)
    fg.d3Force('center', makeCenterForce(0.08))
    const t = setTimeout(() => fg.zoomToFit(300, 24), 350)
    return () => clearTimeout(t)
  }, [data])

  return (
    <div className="mg-local">
      <div className="mg-local-head">
        <strong className="small">Grafo local</strong>
        <span className="small muted">profundidade</span>
        {[1, 2, 3].map((d) => (
          <button key={d} className={d === depth ? 'mg-chip active' : 'mg-chip'} onClick={() => onDepth(d)}>{d}</button>
        ))}
      </div>
      <ForceGraph2D
        ref={ref}
        width={262}
        height={210}
        graphData={data}
        nodeId="id"
        backgroundColor="#1e1e1e"
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GNode
          const r = n.id === center.id ? nodeRadius(n.degree) + 1.5 : nodeRadius(n.degree)
          ctx.beginPath(); ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
          ctx.fillStyle = n.color ?? '#888'; ctx.fill()
          if (n.id === center.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke() }
          if (globalScale > 1.1 || n.id === center.id) {
            const label = n.fato.length > 26 ? n.fato.slice(0, 26) + '…' : n.fato
            ctx.font = `${Math.max(2.4, 9 / globalScale)}px sans-serif`
            ctx.fillStyle = 'rgba(235,235,235,0.92)'; ctx.textAlign = 'center'
            ctx.fillText(label, node.x!, node.y! + r + 3.4)
          }
        }}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={() => 'rgba(190,190,190,0.4)'}
        linkWidth={0.7}
        onNodeClick={(n) => { const f = fatos.find((x) => x.id === (n as GNode).id); if (f) onSelect(f) }}
        nodeLabel={(n) => (n as GNode).fato}
        cooldownTicks={90}
        enableNodeDrag
      />
      <div className="small muted">{data.nodes.length} nós · {data.links.length} links</div>
    </div>
  )
}

interface Filters { categoria?: string; seal?: string; tipo?: LigacaoTipo; desde?: string }
interface Props { categorias: MemoryCategoria[] }

export function MemoryGraph({ categorias }: Props) {
  const toast = useToast()
  const graphRef = useRef<ForceGraphMethods<GNode, GLink>>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const lastClickRef = useRef<{ id: number; at: number }>({ id: -1, at: 0 })
  const configLoadedRef = useRef(false)

  const [size, setSize] = useState({ w: 900, h: 620 })
  const [fatos, setFatos] = useState<MemoryFato[]>([])
  const [ligacoes, setLigacoes] = useState<MemoryLigacao[]>([])
  const [positions, setPositions] = useState<NodePosition[]>([])
  const [groups, setGroups] = useState<GraphGroup[]>([])
  const [config, setConfig] = useState<GraphConfig>(defaultGraphConfig)
  const [filters, setFilters] = useState<Filters>({})
  const [selected, setSelected] = useState<MemoryFato | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [limit, setLimit] = useState(MAX_INITIAL)
  const [linkManualMode, setLinkManualMode] = useState(false)
  const [linkFrom, setLinkFrom] = useState<number | null>(null)
  const [groupNome, setGroupNome] = useState('')
  const [groupConsulta, setGroupConsulta] = useState('categoria:Segurança')
  const [groupCor, setGroupCor] = useState('#e55039')
  const [revealed, setRevealed] = useState<number | null>(null)
  const [animPlaying, setAnimPlaying] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [fs, ls, ps, gs, cfg] = await Promise.all([
        api.memory.list({ orderBy: 'confianca' }),
        api.memory.ligacoesList(),
        api.memory.positionsList(),
        api.memory.graphGroupsList(),
        api.memory.graphConfigGet()
      ])
      setFatos(fs); setLigacoes(ls); setPositions(ps); setGroups(gs)
      if (cfg) setConfig({ ...defaultGraphConfig, ...cfg })
      configLoadedRef.current = true
    } catch (e) { toast.error(errorMessage(e)); configLoadedRef.current = true }
  }, [toast])

  useEffect(() => { void reload() }, [reload])

  // Salvar configurações no SQLite (debounce).
  useEffect(() => {
    if (!configLoadedRef.current) return
    const t = setTimeout(() => { void api.memory.graphConfigSave(config).catch(() => undefined) }, 450)
    return () => clearTimeout(t)
  }, [config])

  // Medir a área do canvas.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Pausar simulação quando a aba está oculta para economizar CPU.
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    const onVisibility = () => {
      if (document.hidden) fg.pauseAnimation()
      else fg.resumeAnimation()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const setCfg = useCallback((patch: Partial<GraphConfig>) => setConfig((c) => ({ ...c, ...patch })), [])

  const catColors = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of categorias) m[c.nome] = c.cor
    return m
  }, [categorias])

  const posMap = useMemo(() => {
    const m = new Map<number, NodePosition>()
    for (const p of positions) m.set(p.fatoId, p)
    return m
  }, [positions])

  // Fatos visíveis: filtros clássicos + órfãos/entidades/conflitos.
  const visibleFatos = useMemo(() => {
    let fs = fatos
    if (filters.categoria) fs = fs.filter((f) => f.categoria === filters.categoria)
    if (filters.seal) {
      fs = fs.filter((f) => {
        if (filters.seal === 'conflito') return f.status === 'conflito'
        if (filters.seal === 'arquivado') return f.status === 'arquivado'
        if (filters.seal === 'verificado') return f.confianca >= 70
        if (filters.seal === 'provavel') return f.confianca >= 40 && f.confianca < 70
        return f.confianca < 40
      })
    }
    if (filters.desde) {
      const t = new Date(filters.desde).getTime()
      fs = fs.filter((f) => new Date(f.criadoEm).getTime() >= t)
    }
    fs = fs.slice(0, limit)
    const ids = new Set(fs.map((f) => f.id))
    const inner = ligacoes.filter((l) => ids.has(l.origemId) && ids.has(l.destinoId))
    if (!config.showOrphans) fs = fs.filter((f) => !isOrphan(f.id, inner))
    if (!config.showEntities) fs = fs.filter((f) => !hasEntityLink(f.id, inner))
    if (!config.showConflicts) fs = fs.filter((f) => f.status !== 'conflito' && !hasConflictLink(f.id, inner))
    return fs
  }, [fatos, filters, limit, ligacoes, config.showOrphans, config.showEntities, config.showConflicts])

  const visibleIds = useMemo(() => new Set(visibleFatos.map((f) => f.id)), [visibleFatos])

  const visibleLigacoes = useMemo(() => {
    let ls = ligacoes.filter((l) => visibleIds.has(l.origemId) && visibleIds.has(l.destinoId))
    if (filters.tipo) ls = ls.filter((l) => l.tipo === filters.tipo)
    if (!config.showConflicts) ls = ls.filter((l) => l.tipo !== 'conflito')
    return ls
  }, [ligacoes, visibleIds, filters.tipo, config.showConflicts])

  // Animação cronológica: subconjunto revelado até agora.
  const chrono = useMemo(() => chronologicalOrder(visibleFatos), [visibleFatos])
  const shownFatos = useMemo(
    () => (revealed == null ? visibleFatos : chrono.slice(0, revealed)),
    [revealed, visibleFatos, chrono]
  )
  const shownIds = useMemo(() => new Set(shownFatos.map((f) => f.id)), [shownFatos])
  const shownLigacoes = useMemo(
    () => visibleLigacoes.filter((l) => shownIds.has(l.origemId) && shownIds.has(l.destinoId)),
    [visibleLigacoes, shownIds]
  )

  const colors = useMemo(
    () => groupColorMap(shownFatos, groups, catColors, shownLigacoes),
    [shownFatos, groups, catColors, shownLigacoes]
  )
  const allColors = useMemo(
    () => groupColorMap(fatos, groups, catColors, ligacoes),
    [fatos, groups, catColors, ligacoes]
  )

  const graphData = useMemo(() => {
    const deg = degreeMap(shownLigacoes)
    const nodes: GNode[] = shownFatos.map((f) => {
      const saved = posMap.get(f.id)
      return {
        id: f.id, fato: f.fato, categoria: f.categoria, confianca: f.confianca,
        status: f.status, confirmacoes: f.confirmacoes, degree: deg.get(f.id) ?? 0,
        color: colors.get(f.id) ?? '#888',
        ...(saved ? { x: saved.x, y: saved.y } : {})
      }
    })
    const links: GLink[] = shownLigacoes.map((l) => ({ source: l.origemId, target: l.destinoId, tipo: l.tipo, id: l.id }))
    return { nodes, links }
  }, [shownFatos, shownLigacoes, colors, posMap])

  const graphDataRef = useRef(graphData)
  graphDataRef.current = graphData

  const hoveredNeighbors = useMemo(
    () => (hovered == null ? null : neighborsOf(hovered, shownLigacoes)),
    [hovered, shownLigacoes]
  )

  const selectedLigacoes = useMemo(() => {
    if (!selected) return []
    return ligacoes.filter((l) => l.origemId === selected.id || l.destinoId === selected.id)
  }, [selected, ligacoes])

  // Forças ao vivo a partir dos sliders.
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-config.repelForce)
    const linkForce = fg.d3Force('link') as unknown as { distance: (n: number) => unknown; strength: (n: number) => unknown } | undefined
    linkForce?.distance(config.linkDistance)
    linkForce?.strength(config.linkForce / 100)
    fg.d3Force('center', makeCenterForce(config.centerForce / 500))
    fg.d3ReheatSimulation()
  }, [config.repelForce, config.linkDistance, config.linkForce, config.centerForce, graphData])

  // Timer da animação cronológica.
  useEffect(() => {
    if (!animPlaying || revealed == null) return
    const step = Math.max(1, Math.ceil(chrono.length / 120))
    const t = setInterval(() => {
      setRevealed((r) => {
        if (r == null) return r
        const next = Math.min(chrono.length, r + step)
        if (next >= chrono.length) setAnimPlaying(false)
        return next
      })
    }, 120)
    return () => clearInterval(t)
  }, [animPlaying, revealed, chrono.length])

  function saveAllPositions() {
    const pts = graphDataRef.current.nodes
      .filter((n) => n.x != null && n.y != null)
      .map((n) => ({ fatoId: n.id, x: n.x!, y: n.y! }))
    if (pts.length) void api.memory.positionsSave(pts).catch(() => undefined)
  }

  function doSearch() {
    if (!searchTerm.trim()) return
    const term = searchTerm.toLowerCase()
    const node = graphData.nodes.find((n) => n.fato.toLowerCase().includes(term))
    if (!node) { toast.error('Nó não encontrado'); return }
    graphRef.current?.centerAt(node.x ?? 0, node.y ?? 0, 600)
    graphRef.current?.zoom(3, 600)
    setSelected(fatos.find((f) => f.id === node.id) ?? null)
  }

  function onNodeClick(node: GNode) {
    const nowMs = Date.now()
    const isDouble = lastClickRef.current.id === node.id && nowMs - lastClickRef.current.at < 350
    lastClickRef.current = { id: node.id, at: nowMs }
    if (linkManualMode) {
      if (linkFrom == null) { setLinkFrom(node.id); toast.error('Clique no segundo nó para ligar') }
      else if (linkFrom !== node.id) {
        api.memory.ligacoesSave(linkFrom, node.id)
          .then(() => { toast.error('Ligação manual criada'); setLinkFrom(null); setLinkManualMode(false); return reload() })
          .catch((e) => toast.error(errorMessage(e)))
      }
      return
    }
    setSelected(fatos.find((f) => f.id === node.id) ?? null)
    if (isDouble) {
      graphRef.current?.centerAt(node.x ?? 0, node.y ?? 0, 600)
      graphRef.current?.zoom(4, 600)
    }
  }

  function expandNeighbors() {
    if (!selected) return
    const nb = neighborsOf(selected.id, ligacoes)
    const missing = [...nb].filter((id) => !visibleIds.has(id)).length
    if (missing === 0) { toast.error('Todos os vizinhos já estão visíveis'); return }
    setLimit((prev) => prev + missing + 20)
  }

  function exportPng() {
    const canvas = document.querySelector<HTMLCanvasElement>('.mg-canvas canvas')
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png'); a.download = 'memoria-grafo.png'; a.click()
  }

  function exportJson() {
    const json = JSON.stringify({ nodes: graphData.nodes, links: shownLigacoes }, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = 'memoria-grafo.json'; a.click()
  }

  async function createGroup() {
    if (!groupNome.trim() || !groupConsulta.trim()) { toast.error('Informe nome e consulta do grupo'); return }
    try {
      await api.memory.graphGroupsSave({ nome: groupNome.trim(), consulta: groupConsulta.trim(), cor: groupCor })
      setGroupNome('')
      await reload()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  function toggleAnimate() {
    if (revealed == null) { setRevealed(0); setAnimPlaying(true) }
    else if (revealed >= chrono.length) { setRevealed(0); setAnimPlaying(true) }
    else setAnimPlaying((p) => !p)
  }

  const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <label className="mg-slider">
      <span>{label}<span className="mg-slider-val">{value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  )

  return (
    <div className="mg-root">
      <div className="mg-main">
        <div ref={wrapRef} className="mg-canvas">
          <ForceGraph2D
            ref={graphRef}
            width={size.w}
            height={size.h}
            graphData={graphData}
            nodeId="id"
            backgroundColor="#1e1e1e"
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GNode
              const r = nodeRadius(n.degree, config.nodeSize / 100)
              const dim = hoveredNeighbors != null && !hoveredNeighbors.has(n.id)
              const isSel = selected?.id === n.id
              ctx.globalAlpha = dim ? 0.1 : 1
              ctx.beginPath(); ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
              ctx.fillStyle = n.color ?? '#888'; ctx.fill()
              if (isSel || hovered === n.id) { ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = isSel ? 1.8 : 1.2; ctx.stroke() }
              const highlighted = hovered === n.id || isSel || (hoveredNeighbors?.has(n.id) ?? false)
              const alpha = labelAlpha(globalScale, config.textFade, highlighted)
              if (alpha > 0) {
                const label = n.fato.length > 34 ? n.fato.slice(0, 34) + '…' : n.fato
                ctx.globalAlpha = dim ? 0 : alpha
                ctx.font = `${Math.max(2.2, 10 / globalScale)}px sans-serif`
                ctx.fillStyle = '#e8e8e8'; ctx.textAlign = 'center'
                ctx.fillText(label, node.x!, node.y! + r + 3.6)
              }
              ctx.globalAlpha = 1
            }}
            nodeCanvasObjectMode={() => 'replace'}
            linkColor={(l) => {
              const link = l as GLink
              const [s, t] = linkEnds(link)
              if (hoveredNeighbors) {
                return hoveredNeighbors.has(s) && hoveredNeighbors.has(t) ? 'rgba(225,225,225,0.75)' : 'rgba(160,160,160,0.07)'
              }
              if (link.tipo === 'conflito') return 'rgba(229,80,57,0.8)'
              return 'rgba(175,175,175,0.35)'
            }}
            linkWidth={(l) => {
              const link = l as GLink
              const [s, t] = linkEnds(link)
              const base = (link.tipo === 'conflito' ? 1.1 : 0.6) * (config.linkWidth / 100)
              if (hoveredNeighbors) return hoveredNeighbors.has(s) && hoveredNeighbors.has(t) ? base * 2.4 : base * 0.4
              return base
            }}
            linkLineDash={(l) => ((l as GLink).tipo === 'conflito' ? [4, 2] : undefined)}
            linkDirectionalArrowLength={config.showArrows ? 3.5 : 0}
            linkDirectionalArrowRelPos={1}
            onNodeClick={(n) => onNodeClick(n as GNode)}
            onNodeHover={(n) => setHovered(n ? (n as GNode).id : null)}
            onNodeDragEnd={(n) => {
              const node = n as GNode
              node.fx = undefined; node.fy = undefined
              if (node.x != null && node.y != null) {
                void api.memory.positionsSave([{ fatoId: node.id, x: node.x, y: node.y }]).catch(() => undefined)
              }
              graphRef.current?.d3ReheatSimulation()
            }}
            onBackgroundClick={() => setSelected(null)}
            onEngineStop={saveAllPositions}
            nodeLabel={(n) => (n as GNode).fato}
            enableNodeDrag
            enableZoomInteraction
            enablePanInteraction
            minZoom={0.2}
            maxZoom={12}
            cooldownTicks={160}
            warmupTicks={20}
            d3VelocityDecay={0.35}
          />

          <button
            className="mg-gear"
            title="Configurações do grafo"
            onClick={() => setCfg({ panelOpen: !config.panelOpen })}
          >⚙</button>

          {config.panelOpen && (
            <div className="mg-panel">
              <div className="mg-panel-head">
                <strong>Configurações do grafo</strong>
                <button className="mg-x" onClick={() => setCfg({ panelOpen: false })}>×</button>
              </div>

              <div className="mg-section">Filtros</div>
              <div className="mg-row">
                <input placeholder="Buscar nó…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
                <button onClick={doSearch}>Buscar</button>
              </div>
              <select value={filters.categoria ?? ''} onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value || undefined }))}>
                <option value="">Todas categorias</option>
                {categorias.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
              </select>
              <select value={filters.tipo ?? ''} onChange={(e) => setFilters((f) => ({ ...f, tipo: (e.target.value || undefined) as LigacaoTipo | undefined }))}>
                <option value="">Todos os tipos de ligação</option>
                {(Object.keys(LINK_LABEL) as LigacaoTipo[]).map((t) => <option key={t} value={t}>{LINK_LABEL[t]}</option>)}
              </select>
              <label className="mg-check"><input type="checkbox" checked={config.showOrphans} onChange={(e) => setCfg({ showOrphans: e.target.checked })} /> Mostrar órfãos</label>
              <label className="mg-check"><input type="checkbox" checked={config.showEntities} onChange={(e) => setCfg({ showEntities: e.target.checked })} /> Mostrar entidades</label>
              <label className="mg-check"><input type="checkbox" checked={config.showConflicts} onChange={(e) => setCfg({ showConflicts: e.target.checked })} /> Mostrar conflitos</label>

              <div className="mg-section">Grupos</div>
              <input placeholder="Nome do grupo" value={groupNome} onChange={(e) => setGroupNome(e.target.value)} />
              <div className="mg-row">
                <input placeholder="categoria:Segurança" value={groupConsulta} onChange={(e) => setGroupConsulta(e.target.value)} />
                <input type="color" className="mg-color" value={groupCor} onChange={(e) => setGroupCor(e.target.value)} />
              </div>
              <button onClick={() => void createGroup()}>+ Criar grupo</button>
              {groups.map((g) => (
                <div key={g.id} className="mg-group">
                  <span className="mg-swatch" style={{ background: g.cor }} />
                  <span className="mg-group-name">{g.nome}</span>
                  <span className="mg-group-q">{g.consulta}</span>
                  <button className="mg-x" title="Remover grupo" onClick={() => void api.memory.graphGroupsDelete(g.id).then(reload).catch((e) => toast.error(errorMessage(e)))}>×</button>
                </div>
              ))}
              <div className="mg-cats">
                {categorias.map((c) => (
                  <span key={c.nome} className="mg-cat"><span className="mg-swatch" style={{ background: c.cor }} />{c.nome}</span>
                ))}
              </div>

              <div className="mg-section">Exibição</div>
              <label className="mg-check"><input type="checkbox" checked={config.showArrows} onChange={(e) => setCfg({ showArrows: e.target.checked })} /> Setas nas ligações</label>
              {slider('Tamanho dos nós (%)', config.nodeSize, 50, 220, 5, (v) => setCfg({ nodeSize: v }))}
              {slider('Espessura das linhas (%)', config.linkWidth, 20, 300, 5, (v) => setCfg({ linkWidth: v }))}
              {slider('Limite p/ rótulos (zoom)', config.textFade, 0.5, 4, 0.1, (v) => setCfg({ textFade: v }))}

              <div className="mg-section">Forças</div>
              {slider('Força central', config.centerForce, 0, 100, 1, (v) => setCfg({ centerForce: v }))}
              {slider('Repulsão', config.repelForce, 10, 500, 5, (v) => setCfg({ repelForce: v }))}
              {slider('Força das ligações', config.linkForce, 0, 100, 1, (v) => setCfg({ linkForce: v }))}
              {slider('Distância das ligações', config.linkDistance, 10, 220, 2, (v) => setCfg({ linkDistance: v }))}

              <div className="mg-section">Ações</div>
              <div className="mg-row">
                <button onClick={toggleAnimate}>{revealed == null ? '▶ Animar' : animPlaying ? '⏸ Pausar' : '▶ Continuar'}</button>
                {revealed != null && <button onClick={() => { setRevealed(null); setAnimPlaying(false) }}>Parar</button>}
              </div>
              <button onClick={() => graphRef.current?.zoomToFit(500, 40)}>Ajustar à tela</button>
              <button onClick={expandNeighbors} disabled={!selected}>Expandir vizinhos</button>
              <button onClick={() => setLimit((l) => l + LOAD_MORE)}>+ {LOAD_MORE} nós</button>
              <button className={linkManualMode ? 'mg-active-btn' : ''} onClick={() => { setLinkManualMode((v) => !v); setLinkFrom(null) }}>
                {linkManualMode ? '✕ Cancelar link' : '+ Link manual'}
              </button>
              <div className="mg-row">
                <button onClick={exportPng}>Exportar PNG</button>
                <button onClick={exportJson}>Exportar JSON</button>
              </div>
              <div className="small" style={{ color: '#9a9a9a' }}>{graphData.nodes.length} nós · {graphData.links.length} links</div>
            </div>
          )}

          {revealed != null && (
            <div className="mg-progress">
              <div className="mg-progress-bar" style={{ width: `${chrono.length ? (revealed / chrono.length) * 100 : 0}%` }} />
              <span>{revealed}/{chrono.length} fatos em ordem cronológica</span>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <aside className="mg-side">
          <div className="mg-side-head">
            <strong className="small">Fato selecionado</strong>
            <button className="mg-x dark" onClick={() => setSelected(null)}>×</button>
          </div>
          <p className="mg-side-fato">{selected.fato}</p>
          <div className="small muted">{selected.categoria} · {sealLabel(selected)}</div>
          <div className="small muted">Confiança {selected.confianca} · {selected.confirmacoes} confirmação(ões)</div>
          {selected.fontes.length > 0 && (
            <ul className="mg-list">
              {selected.fontes.map((s) => (
                <li key={s.id} className="small">
                  {/^https?:\/\//.test(s.fonte)
                    ? <a href={s.fonte} target="_blank" rel="noreferrer">{s.fonte}</a>
                    : <span>{s.fonte}</span>}
                  <span className="muted"> ({s.tipo})</span>
                </li>
              ))}
            </ul>
          )}
          {selectedLigacoes.length > 0 && (
            <>
              <strong className="small">Ligações</strong>
              <ul className="mg-list">
                {selectedLigacoes.map((l) => {
                  const otherId = l.origemId === selected.id ? l.destinoId : l.origemId
                  const other = fatos.find((f) => f.id === otherId)
                  return (
                    <li key={l.id} className="small mg-lig">
                      <span className="mg-lig-type">{LINK_LABEL[l.tipo]}</span>
                      <button className="mg-lig-btn" onClick={() => other && setSelected(other)}>{other?.fato.slice(0, 42) ?? `#${otherId}`}</button>
                      {l.tipo === 'manual' && (
                        <button className="mg-x dark" title="Remover ligação" onClick={() => void api.memory.ligacoesDelete(l.id).then(reload).catch((e) => toast.error(errorMessage(e)))}>×</button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <div className="mg-actions">
            <button onClick={() => void api.memory.confirm(selected.id).then(reload).catch((e) => toast.error(errorMessage(e)))}>✓ Confirmar</button>
            <button onClick={() => void api.memory.archive(selected.id).then(() => { setSelected(null); return reload() }).catch((e) => toast.error(errorMessage(e)))}>Arquivar</button>
          </div>
          <LocalGraph
            center={selected}
            fatos={fatos}
            ligacoes={ligacoes}
            depth={config.localDepth}
            onDepth={(d) => setCfg({ localDepth: d })}
            colors={allColors}
            onSelect={setSelected}
          />
        </aside>
      )}
    </div>
  )
}


