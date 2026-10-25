import type { Db } from '../connection'

// ---- tipos públicos ----

export interface MemoryCategoria { id: number; nome: string; cor: string }

export interface MemorySource {
  id: number; fatoId: number; fonte: string
  tipo: 'usuario' | 'arquivo' | 'site' | 'modelo' | 'conversa'
  dateFonte: string | null; trecho: string | null; criadoEm: string
}

export interface MemoryFato {
  id: number; fato: string; categoria: string; confianca: number
  status: 'ativo' | 'conflito' | 'arquivado'
  confirmacoes: number; criadoEm: string; atualizadoEm: string
  fontes: MemorySource[]
}

export interface SaveFactInput {
  fato: string; categoria: string
  fonte: string; tipo: MemorySource['tipo']
  dateFonte?: string | null; trecho?: string | null
  confianca?: number
}

export interface MemoryFilters {
  query?: string; categoria?: string
  status?: 'ativo' | 'conflito' | 'arquivado'
  orderBy?: 'confianca' | 'criado_em'
}

export type LigacaoTipo = 'mesma_fonte' | 'mesma_entidade' | 'similar' | 'conflito' | 'manual'

export interface MemoryLigacao {
  id: number; origemId: number; destinoId: number
  tipo: LigacaoTipo; peso: number; criadoEm: string
}

export interface LigacoesFilters { tipo?: LigacaoTipo; categoria?: string }

export interface NodePosition { fatoId: number; x: number; y: number }

// ---- helpers internos ----

function now(): string { return new Date().toISOString() }

export function normalizeText(t: string): string {
  return t.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  const p = ` ${s} `
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3))
  return out
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(normalizeText(a))
  const tb = trigrams(normalizeText(b))
  if (ta.size === 0 && tb.size === 0) return 1
  let inter = 0
  for (const g of ta) if (tb.has(g)) inter++
  return inter / (ta.size + tb.size - inter)
}

const CONFIDENCE_BASE: Record<MemorySource['tipo'], number> = {
  usuario: 80, arquivo: 75, site: 70, conversa: 60, modelo: 40
}
const NEWS_EXPIRY_DAYS = 30
const GENERAL_DECAY_DAYS = 90

export function calcConfidence(tipo: MemorySource['tipo'], confirmacoes: number, criadoEm: string, categoria: string): number {
  const base = CONFIDENCE_BASE[tipo]
  const ageMs = Date.now() - new Date(criadoEm).getTime()
  const ageDays = ageMs / 86_400_000
  const decayDays = categoria === 'Notícias' ? NEWS_EXPIRY_DAYS : GENERAL_DECAY_DAYS
  const agePenalty = Math.max(0, Math.floor((ageDays / decayDays) * 20))
  const confirmBonus = Math.min(20, (confirmacoes - 1) * 5)
  return Math.max(0, Math.min(100, base + confirmBonus - agePenalty))
}

// ---- ligações internas ----

function upsertLigacao(db: Db, origemId: number, destinoId: number, tipo: LigacaoTipo, peso: number): void {
  const [a, b] = origemId < destinoId ? [origemId, destinoId] : [destinoId, origemId]
  // Só sobrescreve se o tipo existente não for 'conflito' (não faz downgrade de severidade)
  db.prepare(
    `INSERT INTO memoria_ligacoes(origem_id,destino_id,tipo,peso,criado_em) VALUES(?,?,?,?,?)
     ON CONFLICT(origem_id,destino_id) DO UPDATE SET tipo=excluded.tipo, peso=excluded.peso
     WHERE memoria_ligacoes.tipo != 'conflito' OR excluded.tipo = 'conflito'`
  ).run(a, b, tipo, peso, now())
}

function autoLink(db: Db, newId: number, input: { fato: string; categoria: string; fonte: string }): void {
  const n = now()
  // mesma_fonte: outros fatos que têm exatamente a mesma string de fonte
  interface IdRow { fato_id: number }
  const sameSrc = db.prepare(
    `SELECT DISTINCT fato_id FROM memoria_fontes WHERE fonte=? AND fato_id!=?`
  ).all(input.fonte, newId) as unknown as IdRow[]
  for (const r of sameSrc) upsertLigacao(db, newId, r.fato_id, 'mesma_fonte', 1.0)

  // similar (0,60–0,84): candidatos FTS5 não já marcados como duplicados
  interface FtsRow { rowid: number }
  interface FatoRow2 { id: number; fato: string }
  const words = normalizeText(input.fato).split(' ').filter(Boolean)
  if (words.length > 0) {
    const hits = db.prepare(
      `SELECT rowid FROM memoria_fatos_fts WHERE memoria_fatos_fts MATCH ? ORDER BY rank LIMIT 20`
    ).all(words.map((w) => `"${w}"`).join(' OR ')) as unknown as FtsRow[]
    if (hits.length > 0) {
      const rows = db.prepare(
        `SELECT id, fato FROM memoria_fatos WHERE id IN (${hits.map(() => '?').join(',')}) AND id!=? AND status!='arquivado'`
      ).all(...hits.map((h) => h.rowid), newId) as unknown as FatoRow2[]
      for (const row of rows) {
        const sim = trigramSimilarity(input.fato, row.fato)
        if (sim >= 0.6 && sim < 0.85) upsertLigacao(db, newId, row.id, 'similar', sim)
      }
    }
  }
  void n
}

// ---- leitura interna ----

interface FatoRow { id: number; fato: string; categoria: string; confianca: number; status: string; confirmacoes: number; criado_em: string; atualizado_em: string }
interface FonteRow { id: number; fato_id: number; fonte: string; tipo: string; data_fonte: string | null; trecho: string | null; criado_em: string }

function toFato(row: FatoRow, fontes: FonteRow[]): MemoryFato {
  return {
    id: row.id, fato: row.fato, categoria: row.categoria,
    confianca: row.confianca, status: row.status as MemoryFato['status'],
    confirmacoes: row.confirmacoes, criadoEm: row.criado_em, atualizadoEm: row.atualizado_em,
    fontes: fontes.filter((f) => f.fato_id === row.id).map((f) => ({
      id: f.id, fatoId: f.fato_id, fonte: f.fonte, tipo: f.tipo as MemorySource['tipo'],
      dateFonte: f.data_fonte, trecho: f.trecho, criadoEm: f.criado_em
    }))
  }
}

function loadFontes(db: Db, ids: number[]): FonteRow[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`SELECT * FROM memoria_fontes WHERE fato_id IN (${placeholders}) ORDER BY criado_em`).all(...ids) as unknown as FonteRow[]
}

// ---- salvar fato ----

export function saveFact(db: Db, input: SaveFactInput): { action: 'created' | 'duplicate' | 'conflict'; fatoId: number } {
  if (!input.fonte.trim()) return { action: 'created', fatoId: -1 } // descarta sem fonte (fatoId -1 = rejeitado)

  const n = now()

  // Busca candidatos por FTS5 (top 10)
  interface FtsRow { rowid: number }
  const candidates = db.prepare(
    `SELECT rowid FROM memoria_fatos_fts WHERE memoria_fatos_fts MATCH ? ORDER BY rank LIMIT 10`
  ).all(normalizeText(input.fato).split(' ').filter(Boolean).map((w) => `"${w}"`).join(' OR ') || '""') as unknown as FtsRow[]

  if (candidates.length > 0) {
    const rows = db.prepare(
      `SELECT * FROM memoria_fatos WHERE id IN (${candidates.map(() => '?').join(',')}) AND status != 'arquivado'`
    ).all(...candidates.map((c) => c.rowid)) as unknown as FatoRow[]

    for (const row of rows) {
      const sim = trigramSimilarity(input.fato, row.fato)
      if (sim >= 0.85) {
        // duplicado: adiciona fonte, incrementa confirmações, recalcula confiança
        db.prepare('INSERT INTO memoria_fontes(fato_id,fonte,tipo,data_fonte,trecho,criado_em) VALUES(?,?,?,?,?,?)')
          .run(row.id, input.fonte, input.tipo, input.dateFonte ?? null, input.trecho ?? null, n)
        const newConf = calcConfidence(input.tipo, row.confirmacoes + 1, row.criado_em, row.categoria)
        db.prepare('UPDATE memoria_fatos SET confirmacoes=confirmacoes+1, confianca=?, atualizado_em=? WHERE id=?')
          .run(newConf, n, row.id)
        return { action: 'duplicate', fatoId: row.id }
      }
      if (sim >= 0.5 && row.categoria === input.categoria) {
        // contradição potencial: marca ambos como conflito se ainda ativos
        if (row.status === 'ativo') {
          db.prepare(`UPDATE memoria_fatos SET status='conflito', atualizado_em=? WHERE id=?`).run(n, row.id)
        }
        // cria o novo fato já como conflito
        const conf = input.confianca ?? calcConfidence(input.tipo, 1, n, input.categoria)
        const { lastInsertRowid } = db.prepare(
          `INSERT INTO memoria_fatos(fato,categoria,confianca,status,confirmacoes,criado_em,atualizado_em) VALUES(?,?,?,'conflito',1,?,?)`
        ).run(input.fato, input.categoria, conf, n, n)
        const newId = Number(lastInsertRowid)
        db.prepare('INSERT INTO memoria_fontes(fato_id,fonte,tipo,data_fonte,trecho,criado_em) VALUES(?,?,?,?,?,?)')
          .run(newId, input.fonte, input.tipo, input.dateFonte ?? null, input.trecho ?? null, n)
        upsertLigacao(db, newId, row.id, 'conflito', 1.0)
        autoLink(db, newId, input)
        return { action: 'conflict', fatoId: newId }
      }
    }
  }

  // Novo fato
  const conf = input.confianca ?? calcConfidence(input.tipo, 1, n, input.categoria)
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO memoria_fatos(fato,categoria,confianca,status,confirmacoes,criado_em,atualizado_em) VALUES(?,?,?,'ativo',1,?,?)`
  ).run(input.fato, input.categoria, conf, n, n)
  const newId = Number(lastInsertRowid)
  db.prepare('INSERT INTO memoria_fontes(fato_id,fonte,tipo,data_fonte,trecho,criado_em) VALUES(?,?,?,?,?,?)')
    .run(newId, input.fonte, input.tipo, input.dateFonte ?? null, input.trecho ?? null, n)
  autoLink(db, newId, input)
  return { action: 'created', fatoId: newId }
}

// ---- busca ----

export function searchFacts(db: Db, query: string, limit = 10): MemoryFato[] {
  const q = normalizeText(query).split(' ').filter(Boolean)
  let rows: FatoRow[]
  if (q.length > 0) {
    interface FtsRow { rowid: number }
    const match = q.map((w) => `"${w}"`).join(' OR ')
    const hits = db.prepare(
      `SELECT rowid FROM memoria_fatos_fts WHERE memoria_fatos_fts MATCH ? ORDER BY rank LIMIT ?`
    ).all(match, limit) as unknown as FtsRow[]
    if (hits.length === 0) return []
    rows = db.prepare(
      `SELECT * FROM memoria_fatos WHERE id IN (${hits.map(() => '?').join(',')}) AND status != 'arquivado' ORDER BY confianca DESC`
    ).all(...hits.map((h) => h.rowid)) as unknown as FatoRow[]
  } else {
    rows = db.prepare(
      `SELECT * FROM memoria_fatos WHERE status != 'arquivado' ORDER BY confianca DESC LIMIT ?`
    ).all(limit) as unknown as FatoRow[]
  }
  const fontes = loadFontes(db, rows.map((r) => r.id))
  return rows.map((r) => toFato(r, fontes))
}

// ---- lista com filtros ----

export function listFacts(db: Db, filters: MemoryFilters = {}): MemoryFato[] {
  let rows: FatoRow[]
  const order = filters.orderBy === 'criado_em' ? 'criado_em DESC' : 'confianca DESC'

  if (filters.query?.trim()) {
    const q = normalizeText(filters.query).split(' ').filter(Boolean)
    interface FtsRow { rowid: number }
    const hits = db.prepare(
      `SELECT rowid FROM memoria_fatos_fts WHERE memoria_fatos_fts MATCH ? ORDER BY rank LIMIT 200`
    ).all(q.map((w) => `"${w}"`).join(' OR ')) as unknown as FtsRow[]
    if (hits.length === 0) return []
    const conditions: string[] = [`id IN (${hits.map(() => '?').join(',')})`]
    const params: (string | number | null)[] = hits.map((h) => h.rowid)
    if (filters.categoria) { conditions.push('categoria=?'); params.push(filters.categoria) }
    if (filters.status) { conditions.push('status=?'); params.push(filters.status) }
    rows = db.prepare(`SELECT * FROM memoria_fatos WHERE ${conditions.join(' AND ')} ORDER BY ${order}`).all(...params) as unknown as FatoRow[]
  } else {
    const conditions: string[] = ['1=1']
    const params: (string | number | null)[] = []
    if (filters.categoria) { conditions.push('categoria=?'); params.push(filters.categoria) }
    if (filters.status) { conditions.push('status=?'); params.push(filters.status) }
    rows = db.prepare(`SELECT * FROM memoria_fatos WHERE ${conditions.join(' AND ')} ORDER BY ${order}`).all(...params) as unknown as FatoRow[]
  }
  const fontes = loadFontes(db, rows.map((r) => r.id))
  return rows.map((r) => toFato(r, fontes))
}

// ---- categorias ----

export function listCategories(db: Db): MemoryCategoria[] {
  return db.prepare('SELECT id, nome, cor FROM memoria_categorias ORDER BY nome').all() as unknown as MemoryCategoria[]
}

export function saveCategory(db: Db, nome: string, cor: string): MemoryCategoria {
  const existing = db.prepare('SELECT id FROM memoria_categorias WHERE nome=?').get(nome) as { id: number } | undefined
  if (existing) {
    db.prepare('UPDATE memoria_categorias SET cor=? WHERE nome=?').run(cor, nome)
    return { id: existing.id, nome, cor }
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO memoria_categorias(nome,cor) VALUES(?,?)').run(nome, cor)
  return { id: Number(lastInsertRowid), nome, cor }
}

export function deleteCategory(db: Db, nome: string, mergeTo: string): void {
  // move fatos para mergeTo antes de deletar
  db.prepare(`UPDATE memoria_fatos SET categoria=? WHERE categoria=?`).run(mergeTo, nome)
  db.prepare(`DELETE FROM memoria_categorias WHERE nome=?`).run(nome)
}

// ---- CRUD de fatos ----

export function getFato(db: Db, id: number): MemoryFato | null {
  const row = db.prepare('SELECT * FROM memoria_fatos WHERE id=?').get(id) as FatoRow | undefined
  if (!row) return null
  const fontes = loadFontes(db, [id])
  return toFato(row, fontes)
}

export function editFato(db: Db, id: number, patch: { fato?: string; categoria?: string; confianca?: number }): void {
  const n = now()
  const sets: string[] = ['atualizado_em=?']
  const params: (string | number | null)[] = [n]
  if (patch.fato !== undefined) { sets.push('fato=?'); params.push(patch.fato) }
  if (patch.categoria !== undefined) { sets.push('categoria=?'); params.push(patch.categoria) }
  if (patch.confianca !== undefined) { sets.push('confianca=?'); params.push(patch.confianca) }
  params.push(id)
  db.prepare(`UPDATE memoria_fatos SET ${sets.join(',')} WHERE id=?`).run(...params)
}

export function archiveFato(db: Db, id: number): void {
  db.prepare(`UPDATE memoria_fatos SET status='arquivado', atualizado_em=? WHERE id=?`).run(now(), id)
}

export function deleteFato(db: Db, id: number): void {
  db.prepare('DELETE FROM memoria_fatos WHERE id=?').run(id)
}

export function confirmFato(db: Db, id: number): void {
  db.prepare(`UPDATE memoria_fatos SET status='ativo', confianca=MIN(100,confianca+20), atualizado_em=? WHERE id=?`).run(now(), id)
}

export function mergeFatos(db: Db, keepId: number, removeId: number): void {
  // move fontes do removido para o keeper
  db.prepare('UPDATE memoria_fontes SET fato_id=? WHERE fato_id=?').run(keepId, removeId)
  db.prepare('DELETE FROM memoria_fatos WHERE id=?').run(removeId)
  const n = now()
  db.prepare(`UPDATE memoria_fatos SET status='ativo', confirmacoes=(SELECT COUNT(*) FROM memoria_fontes WHERE fato_id=?), atualizado_em=? WHERE id=?`)
    .run(keepId, n, keepId)
}

// ---- export / import ----

export function exportFacts(db: Db): string {
  const fatos = db.prepare('SELECT * FROM memoria_fatos ORDER BY id').all() as unknown as FatoRow[]
  const fontes = db.prepare('SELECT * FROM memoria_fontes ORDER BY fato_id').all() as unknown as FonteRow[]
  return JSON.stringify({ fatos, fontes }, null, 2)
}

// ---- ligações (CRUD público) ----

interface LigacaoRow { id: number; origem_id: number; destino_id: number; tipo: string; peso: number; criado_em: string }

export function listLigacoes(db: Db, filters: LigacoesFilters = {}): MemoryLigacao[] {
  const conditions: string[] = ['1=1']
  const params: unknown[] = []
  if (filters.tipo) { conditions.push('l.tipo=?'); params.push(filters.tipo) }
  if (filters.categoria) {
    conditions.push('(fo.categoria=? OR fd.categoria=?)')
    params.push(filters.categoria, filters.categoria)
  }
  const sql = filters.categoria
    ? `SELECT l.* FROM memoria_ligacoes l
       JOIN memoria_fatos fo ON fo.id=l.origem_id
       JOIN memoria_fatos fd ON fd.id=l.destino_id
       WHERE ${conditions.join(' AND ')} ORDER BY l.criado_em DESC LIMIT 2000`
    : `SELECT * FROM memoria_ligacoes l WHERE ${conditions.join(' AND ')} ORDER BY l.criado_em DESC LIMIT 2000`
  const rows = db.prepare(sql).all(...(params as (string | number | null)[])) as unknown as LigacaoRow[]
  return rows.map((r) => ({ id: r.id, origemId: r.origem_id, destinoId: r.destino_id, tipo: r.tipo as LigacaoTipo, peso: r.peso, criadoEm: r.criado_em }))
}

export function saveLigacao(db: Db, origemId: number, destinoId: number): MemoryLigacao {
  upsertLigacao(db, origemId, destinoId, 'manual', 1.0)
  const [a, b] = origemId < destinoId ? [origemId, destinoId] : [destinoId, origemId]
  const row = db.prepare('SELECT * FROM memoria_ligacoes WHERE origem_id=? AND destino_id=?').get(a, b) as unknown as LigacaoRow
  return { id: row.id, origemId: row.origem_id, destinoId: row.destino_id, tipo: row.tipo as LigacaoTipo, peso: row.peso, criadoEm: row.criado_em }
}

export function deleteLigacao(db: Db, id: number): void {
  db.prepare('DELETE FROM memoria_ligacoes WHERE id=?').run(id)
}

// ---- posições de layout ----

export function listNodePositions(db: Db): NodePosition[] {
  interface Row { fato_id: number; x: number; y: number }
  return (db.prepare('SELECT fato_id, x, y FROM memoria_node_positions').all() as unknown as Row[])
    .map((r) => ({ fatoId: r.fato_id, x: r.x, y: r.y }))
}

export function saveNodePositions(db: Db, positions: NodePosition[]): void {
  const n = now()
  const stmt = db.prepare('INSERT INTO memoria_node_positions(fato_id,x,y,updated_em) VALUES(?,?,?,?) ON CONFLICT(fato_id) DO UPDATE SET x=excluded.x, y=excluded.y, updated_em=excluded.updated_em')
  for (const p of positions) stmt.run(p.fatoId, p.x, p.y, n)
}

// ---- grafo: grupos por consulta e configurações ----

export interface GraphGroup { id: number; nome: string; consulta: string; cor: string }

interface GraphGroupRow { id: number; nome: string; consulta: string; cor: string }

export function listGraphGroups(db: Db): GraphGroup[] {
  return db.prepare('SELECT id, nome, consulta, cor FROM memoria_graph_groups ORDER BY id').all() as unknown as GraphGroupRow[]
}

export function saveGraphGroup(db: Db, input: { id?: number; nome: string; consulta: string; cor: string }): GraphGroup {
  if (input.id != null) {
    db.prepare('UPDATE memoria_graph_groups SET nome=?, consulta=?, cor=? WHERE id=?').run(input.nome, input.consulta, input.cor, input.id)
    return { id: input.id, nome: input.nome, consulta: input.consulta, cor: input.cor }
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO memoria_graph_groups(nome,consulta,cor,criado_em) VALUES(?,?,?,?)')
    .run(input.nome, input.consulta, input.cor, now())
  return { id: Number(lastInsertRowid), nome: input.nome, consulta: input.consulta, cor: input.cor }
}

export function deleteGraphGroup(db: Db, id: number): void {
  db.prepare('DELETE FROM memoria_graph_groups WHERE id=?').run(id)
}

export function getGraphConfig(db: Db): unknown {
  const row = db.prepare('SELECT value FROM memoria_graph_settings WHERE key=?').get('config') as { value: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value) as unknown } catch { return null }
}

export function saveGraphConfig(db: Db, config: unknown): void {
  db.prepare('INSERT INTO memoria_graph_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('config', JSON.stringify(config))
}

export function importFacts(db: Db, json: string): { imported: number; skipped: number } {
  let imported = 0; let skipped = 0
  const data = JSON.parse(json) as { fatos?: unknown[]; fontes?: unknown[] }
  if (!Array.isArray(data.fatos)) return { imported: 0, skipped: 0 }
  const n = now()
  for (const f of data.fatos) {
    const r = f as Partial<FatoRow>
    if (!r.fato?.trim() || !r.categoria?.trim()) { skipped++; continue }
    const existing = db.prepare('SELECT id FROM memoria_fatos WHERE fato=? LIMIT 1').get(r.fato) as { id: number } | undefined
    if (existing) { skipped++; continue }
    db.prepare(
      `INSERT INTO memoria_fatos(fato,categoria,confianca,status,confirmacoes,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?)`
    ).run(r.fato, r.categoria, r.confianca ?? 50, r.status ?? 'ativo', r.confirmacoes ?? 1, r.criado_em ?? n, n)
    imported++
  }
  return { imported, skipped }
}
