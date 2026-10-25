import { createHash } from 'node:crypto'
import type { ChatTurn } from '../llm/provider'
import type { Db } from '../db/connection'
import { getCacheEntry, setCacheEntry, type CacheEntry } from '../db/repos/cache'

export interface LlmCacheOptions {
  provedor: string
  modelo: string
  system: string
  messages: ChatTurn[]
  temperature: number
  ttlSec: number
  // true quando o agente tem "usar_cache" ligado (sobrescreve verificação de temperatura)
  forceEnabled: boolean
}

export function shouldUseCache(opts: Pick<LlmCacheOptions, 'temperature' | 'forceEnabled'>): boolean {
  return opts.forceEnabled || opts.temperature <= 0.3
}

export function buildCacheHash(opts: Omit<LlmCacheOptions, 'ttlSec' | 'forceEnabled'>): string {
  const payload = JSON.stringify({
    p: opts.provedor,
    m: opts.modelo,
    s: opts.system,
    msgs: opts.messages,
    t: opts.temperature
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function checkCache(db: Db, opts: LlmCacheOptions): CacheEntry | undefined {
  if (!shouldUseCache(opts)) return undefined
  const hash = buildCacheHash(opts)
  return getCacheEntry(db, hash)
}

export function storeCache(db: Db, opts: LlmCacheOptions, result: CacheEntry): void {
  if (!shouldUseCache(opts)) return
  const hash = buildCacheHash(opts)
  setCacheEntry(db, {
    hash,
    provedor: opts.provedor,
    modelo: opts.modelo,
    resposta: result.resposta,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    ttlSec: opts.ttlSec
  })
}
