import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { buildCacheHash, checkCache, shouldUseCache, storeCache } from '../src/main/services/llmCache'

function makeDb() {
  const db = new DatabaseSync(':memory:') as any
  db.exec(`
    CREATE TABLE cache_respostas (
      chave_hash TEXT PRIMARY KEY,
      provedor   TEXT NOT NULL,
      modelo     TEXT NOT NULL,
      resposta   TEXT NOT NULL,
      tokens_in  INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      criado_em  TEXT NOT NULL,
      expira_em  TEXT NOT NULL,
      hits       INTEGER NOT NULL DEFAULT 0
    )
  `)
  return db
}

const baseOpts = {
  provedor: 'openai',
  modelo: 'gpt-4',
  system: 'Você é um assistente.',
  messages: [{ role: 'user' as const, content: 'Olá' }],
  temperature: 0.2,
  ttlSec: 3600,
  forceEnabled: false
}

describe('shouldUseCache', () => {
  it('ativa para temperatura <= 0.3', () => {
    expect(shouldUseCache({ temperature: 0.3, forceEnabled: false })).toBe(true)
    expect(shouldUseCache({ temperature: 0.4, forceEnabled: false })).toBe(false)
  })
  it('ativa com forceEnabled independente da temperatura', () => {
    expect(shouldUseCache({ temperature: 1.5, forceEnabled: true })).toBe(true)
  })
})

describe('checkCache / storeCache', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => { db = makeDb() })

  it('retorna undefined quando vazio', () => {
    expect(checkCache(db, baseOpts)).toBeUndefined()
  })

  it('armazena e recupera resposta', () => {
    storeCache(db, baseOpts, { resposta: 'Olá!', tokensIn: 10, tokensOut: 5 })
    const hit = checkCache(db, baseOpts)
    expect(hit?.resposta).toBe('Olá!')
    expect(hit?.tokensIn).toBe(10)
  })

  it('não armazena quando temperatura alta e forceEnabled false', () => {
    const opts = { ...baseOpts, temperature: 1.0, forceEnabled: false }
    storeCache(db, opts, { resposta: 'x', tokensIn: 1, tokensOut: 1 })
    expect(checkCache(db, opts)).toBeUndefined()
  })

  it('expira entradas com TTL passado', () => {
    // Insere com TTL de -1 seg (já expirado)
    storeCache(db, { ...baseOpts, ttlSec: -1 }, { resposta: 'velho', tokensIn: 1, tokensOut: 1 })
    // Para simular expiração, sobrescreve expira_em manualmente
    const hash = buildCacheHash(baseOpts)
    db.prepare("UPDATE cache_respostas SET expira_em = datetime('now', '-1 second') WHERE chave_hash = ?").run(hash)
    expect(checkCache(db, baseOpts)).toBeUndefined()
  })
})
