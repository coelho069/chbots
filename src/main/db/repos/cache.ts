import type { Db } from '../connection'

interface CacheRow {
  chave_hash: string
  provedor: string
  modelo: string
  resposta: string
  tokens_in: number
  tokens_out: number
  criado_em: string
  expira_em: string
  hits: number
}

export interface CacheEntry {
  resposta: string
  tokensIn: number
  tokensOut: number
}

export function getCacheEntry(db: Db, hash: string): CacheEntry | undefined {
  const now = new Date().toISOString()
  const row = db.prepare('SELECT * FROM cache_respostas WHERE chave_hash=? AND expira_em > ?').get(hash, now) as CacheRow | undefined
  if (!row) return undefined
  db.prepare('UPDATE cache_respostas SET hits=hits+1 WHERE chave_hash=?').run(hash)
  return { resposta: row.resposta as string, tokensIn: row.tokens_in as number, tokensOut: row.tokens_out as number }
}

export function setCacheEntry(db: Db, data: {
  hash: string; provedor: string; modelo: string
  resposta: string; tokensIn: number; tokensOut: number; ttlSec: number
}): void {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + data.ttlSec * 1000).toISOString()
  db.prepare(`
    INSERT INTO cache_respostas(chave_hash, provedor, modelo, resposta, tokens_in, tokens_out, criado_em, expira_em, hits)
    VALUES (?,?,?,?,?,?,?,?,0)
    ON CONFLICT(chave_hash) DO UPDATE SET
      resposta=excluded.resposta, tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
      criado_em=excluded.criado_em, expira_em=excluded.expira_em, hits=0
  `).run(data.hash, data.provedor, data.modelo, data.resposta, data.tokensIn, data.tokensOut, now.toISOString(), expiresAt)
}

export function deleteCacheByModel(db: Db, provedor: string, modelo: string): void {
  db.prepare('DELETE FROM cache_respostas WHERE provedor=? AND modelo=?').run(provedor, modelo)
}

export function clearExpiredCache(db: Db): number {
  const r = db.prepare("DELETE FROM cache_respostas WHERE expira_em < datetime('now')").run()
  return Number(r.changes)
}

export function clearAllCache(db: Db): void {
  db.prepare('DELETE FROM cache_respostas').run()
}

export interface CacheStats {
  dbSizeMb: number
  cacheRows: number
  cacheHits: number
  cacheMisses: number
  tokensSaved: number
  oldestEntry: string | null
}

export function getCacheStats(db: Db, dbPath: string): CacheStats {
  const { statSync } = require('node:fs') as typeof import('node:fs')
  let dbSizeMb = 0
  try { dbSizeMb = Math.round(statSync(dbPath).size / 1024 / 1024 * 10) / 10 } catch {}

  type StatsRow = { n: number; hits: number; tokens: number; oldest: string | null }
  const rows = db.prepare(
    `SELECT COUNT(*) as n, COALESCE(SUM(hits),0) as hits,
     COALESCE(SUM(tokens_in+tokens_out),0) as tokens, MIN(criado_em) as oldest
     FROM cache_respostas`
  ).get() as StatsRow

  const missed = db.prepare(
    `SELECT (SELECT COUNT(*) FROM messages WHERE role='assistant') - COALESCE(SUM(hits),0) as n FROM cache_respostas`
  ).get() as { n: number } | undefined

  return {
    dbSizeMb,
    cacheRows: Number(rows.n),
    cacheHits: Number(rows.hits),
    cacheMisses: Math.max(0, Number(missed?.n ?? 0)),
    tokensSaved: Number(rows.tokens),
    oldestEntry: rows.oldest as string | null
  }
}
