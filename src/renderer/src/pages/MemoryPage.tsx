import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryCategoria, MemoryFato, MemoryFilters } from '@shared/types'
import { api, errorMessage } from '../api'
import { useDebounce } from '../hooks'
import { useToast } from '../toast'

const MemoryGraph = lazy(() => import('./MemoryGraph').then((m) => ({ default: m.MemoryGraph })))

// ---- selo de confiança ----
function Badge({ confianca, status }: { confianca: number; status: string }) {
  if (status === 'arquivado') return <span className="tag">Arquivado</span>
  if (status === 'conflito') return <span className="tag" style={{ color: '#e55039', borderColor: '#e55039' }}>⚠ Conflito</span>
  if (confianca >= 70) return <span className="tag" style={{ color: '#1d9a6c', borderColor: '#1d9a6c' }}>✓ Verificado</span>
  if (confianca >= 40) return <span className="tag" style={{ color: '#e2a400', borderColor: '#e2a400' }}>~ Provável</span>
  return <span className="tag" style={{ color: '#cf3f3f', borderColor: '#cf3f3f' }}>? Duvidoso</span>
}

export function MemoryPage() {
  const toast = useToast()
  const [tab, setTab] = useState<'lista' | 'grafo'>('lista')
  const [fatos, setFatos] = useState<MemoryFato[]>([])
  const [categorias, setCategorias] = useState<MemoryCategoria[]>([])
  const [selected, setSelected] = useState<MemoryFato | null>(null)
  const [filters, setFilters] = useState<MemoryFilters>({})
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editFato, setEditFato] = useState('')
  const [editCat, setEditCat] = useState('')
  const [editConf, setEditConf] = useState(50)

  // Nova categoria
  const [newCatNome, setNewCatNome] = useState('')
  const [newCatCor, setNewCatCor] = useState('#888888')
  const [showCatForm, setShowCatForm] = useState(false)

  // Importar
  const fileRef = useRef<HTMLInputElement>(null)

  const debouncedQuery = useDebounce(filters.query, 300)
  const effectiveFilters = { ...filters, query: debouncedQuery }

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [fs, cs] = await Promise.all([api.memory.list(effectiveFilters), api.memory.categoriesList()])
      setFatos(fs)
      setCategorias(cs)
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setLoading(false) }
  }, [JSON.stringify(effectiveFilters), toast]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void reload() }, [reload])

  function openDetail(f: MemoryFato) {
    setSelected(f); setEditMode(false)
    setEditFato(f.fato); setEditCat(f.categoria); setEditConf(f.confianca)
  }

  async function doEdit() {
    if (!selected) return
    try {
      await api.memory.edit(selected.id, { fato: editFato, categoria: editCat, confianca: editConf })
      toast.error('Fato atualizado')
      setEditMode(false)
      await reload()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  async function doAction(fn: () => Promise<unknown>, msg: string) {
    try { await fn(); toast.error(msg); setSelected(null); await reload() }
    catch (e) { toast.error(errorMessage(e)) }
  }

  async function doExport() {
    try {
      const json = await api.memory.export()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'memoria.json'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(errorMessage(e)) }
  }

  async function doExportMd() {
    try {
      const fatos2 = await api.memory.list()
      const lines = fatos2.map((f) => `## ${f.categoria}: ${f.fato}\n**Confiança:** ${f.confianca} | **Status:** ${f.status}\n${f.fontes.map((s) => `- ${s.fonte} (${s.tipo})`).join('\n')}`)
      const md = `# Memória\n\n${lines.join('\n\n')}`
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'memoria.md'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error(errorMessage(e)) }
  }

  async function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const r = await api.memory.import(text)
      toast.error(`Importados: ${r.imported}, ignorados: ${r.skipped}`)
      await reload()
    } catch (err) { toast.error(errorMessage(err)) }
    e.target.value = ''
  }

  async function saveCat() {
    if (!newCatNome.trim()) return
    try {
      await api.memory.categoriesSave(newCatNome.trim(), newCatCor)
      setNewCatNome(''); setShowCatForm(false)
      await reload()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  async function deleteCat(nome: string) {
    const mergeTo = prompt(`Mesclar "${nome}" com qual categoria?`)
    if (!mergeTo?.trim()) return
    try {
      await api.memory.categoriesDelete(nome, mergeTo.trim())
      await reload()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      {/* Seletor de aba */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '6px 14px 0', gap: 2 }}>
        {(['lista', 'grafo'] as const).map((t) => (
          <button
            key={t}
            style={{
              border: 'none', background: 'none', padding: '4px 12px', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              fontWeight: tab === t ? 600 : 400
            }}
            onClick={() => setTab(t)}
          >
            {t === 'lista' ? '☰ Lista' : '⬡ Grafo'}
          </button>
        ))}
      </div>

      {tab === 'grafo' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Suspense fallback={<div className="splash">Carregando grafo…</div>}>
            <MemoryGraph categorias={categorias} />
          </Suspense>
        </div>
      )}

      {tab === 'lista' && <div className="split" style={{ flex: 1, overflow: 'hidden' }}>
      {/* Painel esquerdo: lista */}
      <div className="list-pane" style={{ width: 340 }}>
        <div className="pane-header column">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <h2 style={{ flex: 1 }}>Memória</h2>
            <button className="icon" title="Exportar JSON" onClick={doExport}>↓J</button>
            <button className="icon" title="Exportar MD" onClick={doExportMd}>↓M</button>
            <button className="icon" title="Importar" onClick={() => fileRef.current?.click()}>↑</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={doImport} />
          </div>
          <input
            placeholder="Buscar…"
            value={filters.query ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value || undefined }))}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select
              value={filters.categoria ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, categoria: e.target.value || undefined }))}
              style={{ flex: 1, minWidth: 100 }}
            >
              <option value="">Todas categorias</option>
              {categorias.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
            </select>
            <select
              value={filters.status ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || undefined) as MemoryFilters['status'] }))}
              style={{ flex: 1, minWidth: 90 }}
            >
              <option value="">Todos status</option>
              <option value="ativo">Ativo</option>
              <option value="conflito">Conflito</option>
              <option value="arquivado">Arquivado</option>
            </select>
            <select
              value={filters.orderBy ?? 'confianca'}
              onChange={(e) => setFilters((f) => ({ ...f, orderBy: e.target.value as MemoryFilters['orderBy'] }))}
            >
              <option value="confianca">Confiança</option>
              <option value="criado_em">Data</option>
            </select>
          </div>
        </div>

        {loading && <div className="muted small pad">Carregando…</div>}
        <ul className="item-list">
          {fatos.map((f) => (
            <li key={f.id} className="item-row">
              <button
                className={`item${selected?.id === f.id ? ' active' : ''}`}
                onClick={() => openDetail(f)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <span
                    className="dot"
                    style={{ background: categorias.find((c) => c.nome === f.categoria)?.cor ?? '#888' }}
                  />
                  <span className="item-title" style={{ flex: 1 }}>{f.fato}</span>
                  <Badge confianca={f.confianca} status={f.status} />
                </div>
                <div className="item-sub">{f.categoria}</div>
              </button>
            </li>
          ))}
          {!loading && fatos.length === 0 && (
            <li><div className="muted small pad">Nenhum fato encontrado.</div></li>
          )}
        </ul>

        {/* Categorias */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span className="small muted">Categorias</span>
            <button className="link small" onClick={() => setShowCatForm((v) => !v)}>+ Nova</button>
          </div>
          {showCatForm && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input placeholder="Nome" value={newCatNome} onChange={(e) => setNewCatNome(e.target.value)} style={{ flex: 1 }} />
              <input type="color" value={newCatCor} onChange={(e) => setNewCatCor(e.target.value)} style={{ width: 36, padding: 2 }} />
              <button onClick={saveCat}>OK</button>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {categorias.map((c) => (
              <span key={c.nome} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="dot" style={{ background: c.cor, width: 8, height: 8 }} />
                <span className="small">{c.nome}</span>
                <button className="link small" style={{ fontSize: 10, color: 'var(--muted)' }} onClick={() => deleteCat(c.nome)}>×</button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Painel direito: detalhe */}
      <div className="detail-pane">
        {!selected ? (
          <div className="empty-state">
            <p className="muted">Selecione um fato para ver detalhes.</p>
          </div>
        ) : editMode ? (
          <div className="form">
            <h3>Editar fato</h3>
            <label>Fato<textarea rows={3} value={editFato} onChange={(e) => setEditFato(e.target.value)} /></label>
            <label>Categoria
              <select value={editCat} onChange={(e) => setEditCat(e.target.value)}>
                {categorias.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
              </select>
            </label>
            <label>Confiança ({editConf})
              <input type="range" min={0} max={100} value={editConf} onChange={(e) => setEditConf(+e.target.value)} />
            </label>
            <div className="actions">
              <button className="primary" onClick={doEdit}>Salvar</button>
              <button onClick={() => setEditMode(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="form">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <h3 style={{ flex: 1 }}>{selected.fato}</h3>
              <Badge confianca={selected.confianca} status={selected.status} />
            </div>
            <div className="row">
              <span className="tag">{selected.categoria}</span>
              <span className="muted small">Confiança: {selected.confianca}</span>
              <span className="muted small">Confirmações: {selected.confirmacoes}</span>
            </div>

            <div>
              <strong className="small">Fontes</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                {selected.fontes.map((s) => (
                  <li key={s.id} className="small" style={{ marginBottom: 4 }}>
                    {/^https?:\/\//.test(s.fonte) ? (
                      <a href={s.fonte} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{s.fonte}</a>
                    ) : (
                      <span>{s.fonte}</span>
                    )}
                    {' '}
                    <span className="muted">({s.tipo}{s.dateFonte ? `, ${s.dateFonte}` : ''})</span>
                    {s.trecho && <div className="muted" style={{ marginLeft: 8, fontStyle: 'italic' }}>"{s.trecho}"</div>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="actions" style={{ flexWrap: 'wrap' }}>
              <button onClick={() => setEditMode(true)}>Editar</button>
              <button onClick={() => doAction(() => api.memory.confirm(selected.id), 'Fato confirmado')}>✓ Confirmar</button>
              <button onClick={() => doAction(() => api.memory.archive(selected.id), 'Arquivado')}>Arquivar</button>
              <button className="danger" onClick={() => {
                if (confirm('Apagar este fato?')) void doAction(() => api.memory.delete(selected.id), 'Apagado')
              }}>Apagar</button>
            </div>

            <div className="muted small">
              Criado: {new Date(selected.criadoEm).toLocaleString('pt-BR')} · Atualizado: {new Date(selected.atualizadoEm).toLocaleString('pt-BR')}
            </div>
          </div>
        )}
      </div>
      </div>}
    </div>
  )
}
