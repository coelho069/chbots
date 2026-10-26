import { createHash } from 'node:crypto'
import type { Agent } from '@shared/types'
import type { Db } from '../db/connection'
import { now } from '../db/connection'
import type { ClientFactory } from '../llm'
import type { ChatTurn } from '../llm/provider'
import type { SecretStore } from '../secrets'
import { getProvider } from '../db/repos/providers'

const URL_RE = /https?:\/\/[^\s\)"'<>]+/g
const FETCH_TIMEOUT_MS = 10_000
const MAX_CLAIMS = 10
const SNIPPET_LEN = 2000

type Veredito = 'CORRETO' | 'ERRADO' | 'SEM_SUPORTE' | 'FONTE_INACESSIVEL'

interface Evidence { url: string | null; snippet: string }

function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])]
}

function splitClaims(text: string): string[] {
  // Sentences ending in . ! ?; keep max MAX_CLAIMS non-trivial ones
  return text
    .replace(/```[\s\S]*?```/g, '') // strip code blocks
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, MAX_CLAIMS)
}

async function fetchUrl(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CH-BOTS-Verificador/1.0' }
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text')) return null
    const text = await res.text()
    // Crude HTML→text strip
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, SNIPPET_LEN)
  } catch {
    return null
  }
}

async function getCachedContent(db: Db, url: string): Promise<string | null> {
  const hash = createHash('sha256').update(url).digest('hex')
  const row = db.prepare('SELECT conteudo, cached_at FROM verificacao_url_cache WHERE url_hash = ?').get(hash) as
    | { conteudo: string; cached_at: string }
    | undefined
  // Cache valid for 1 hour
  if (row && Date.now() - new Date(row.cached_at).getTime() < 3_600_000) return row.conteudo
  const content = await fetchUrl(url)
  if (content) {
    db.prepare(
      `INSERT OR REPLACE INTO verificacao_url_cache (url_hash, url, conteudo, cached_at) VALUES (?, ?, ?, ?)`
    ).run(hash, url, content, now())
  }
  return content
}

function findRelevantSnippet(claim: string, evidences: Evidence[]): Evidence | null {
  if (evidences.length === 0) return null
  const claimLower = claim.toLowerCase()
  const words = claimLower.split(/\s+/).filter((w) => w.length > 4)
  // Score by keyword overlap
  let best: Evidence | null = null
  let bestScore = 0
  for (const ev of evidences) {
    const snip = ev.snippet.toLowerCase()
    const score = words.reduce((n, w) => n + (snip.includes(w) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = ev }
  }
  return bestScore > 0 ? best : evidences[0]!
}

export interface VerificadorDeps {
  db: Db
  secrets: SecretStore
  createClient: ClientFactory
  onUpdated: (messageId: number) => void
}

export class VerificadorService {
  constructor(private readonly deps: VerificadorDeps) {}

  verificarAsync(
    messageId: number,
    text: string,
    toolHistory: ChatTurn[],
    agent: Agent
  ): void {
    if (!agent.verificarFontes || !agent.verificadorProviderId || !agent.verificadorModel) return
    // Fire and forget
    this.verificar(messageId, text, toolHistory, agent).catch((err) => {
      console.error('[Verificador] erro:', err instanceof Error ? err.message : String(err))
    })
  }

  private async verificar(
    messageId: number,
    text: string,
    toolHistory: ChatTurn[],
    agent: Agent
  ): Promise<void> {
    const { db, secrets, createClient, onUpdated } = this.deps
    console.info(`[Verificador] iniciando verificação para msg ${messageId}`)

    // Collect evidence
    const evidences: Evidence[] = []

    // Tool results already fetched
    for (const turn of toolHistory) {
      if (turn.role === 'tool' && typeof turn.content === 'string' && turn.content.length > 10) {
        const urls = extractUrls(turn.content)
        const url = urls[0] ?? null
        evidences.push({ url, snippet: turn.content.slice(0, SNIPPET_LEN) })
        console.info(`[Verificador] evidência de ferramenta: url=${url}, snippet_len=${turn.content.length}`)
      }
    }

    // Fetch URLs found in text
    const textUrls = extractUrls(text)
    for (const url of textUrls.slice(0, 5)) {
      const content = await getCachedContent(db, url)
      if (content) evidences.push({ url, snippet: content })
    }

    console.info(`[Verificador] total de evidências: ${evidences.length}`)
    if (evidences.length === 0) {
      console.warn(`[Verificador] nenhuma evidência encontrada, retornando`)
      return // no sources, nothing to verify
    }

    const claims = splitClaims(text)
    if (claims.length === 0) return

    // Build LLM client for verifier
    const providerRow = getProvider(db, agent.verificadorProviderId!)
    if (!providerRow) return
    const apiKey = providerRow.keyRef ? secrets.get(providerRow.keyRef) : null
    const client = createClient({ kind: providerRow.kind, baseUrl: providerRow.baseUrl, apiKey })

    for (const claim of claims) {
      const ev = findRelevantSnippet(claim, evidences)
      let veredito: Veredito
      let sourceUrl: string | null = null
      let sourceSnippet: string | null = null

      if (!ev) {
        veredito = 'FONTE_INACESSIVEL'
      } else {
        sourceUrl = ev.url
        sourceSnippet = ev.snippet.slice(0, 500)
        try {
          const prompt = `Afirmação: "${claim}"\n\nEvidência: "${ev.snippet.slice(0, SNIPPET_LEN)}"\n\nResponda com EXATAMENTE uma das palavras: CORRETO, ERRADO, SEM_SUPORTE, FONTE_INACESSIVEL`
          const result = await client.chat({
            model: agent.verificadorModel!,
            system: 'Você é um verificador de fatos. Responda apenas com a palavra do veredito, sem mais nada.',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            streaming: false
          })
          const word = result.text.trim().toUpperCase().split(/\s+/)[0]
          veredito = (word === 'CORRETO' || word === 'ERRADO' || word === 'SEM_SUPORTE' || word === 'FONTE_INACESSIVEL')
            ? word : 'SEM_SUPORTE'
        } catch {
          veredito = 'FONTE_INACESSIVEL'
        }
      }

      db.prepare(
        `INSERT INTO verificacoes (message_id, claim_text, source_url, source_snippet, veredito, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(messageId, claim, sourceUrl, sourceSnippet, veredito, now())
    }

    onUpdated(messageId)
  }

  listSummary(messageId: number) {
    const rows = this.deps.db.prepare(
      `SELECT id, message_id, claim_text, source_url, source_snippet, veredito, created_at
       FROM verificacoes WHERE message_id = ? ORDER BY id`
    ).all(messageId) as {
      id: number; message_id: number; claim_text: string
      source_url: string | null; source_snippet: string | null
      veredito: Veredito; created_at: string
    }[]

    if (rows.length === 0) return null

    const items = rows.map((r) => ({
      id: r.id,
      messageId: r.message_id,
      claimText: r.claim_text,
      sourceUrl: r.source_url,
      sourceSnippet: r.source_snippet,
      veredito: r.veredito,
      createdAt: r.created_at
    }))

    const judged = items.filter((i) => i.veredito !== 'FONTE_INACESSIVEL')
    const correto = items.filter((i) => i.veredito === 'CORRETO').length
    const errado = items.filter((i) => i.veredito === 'ERRADO').length
    const semSuporte = items.filter((i) => i.veredito === 'SEM_SUPORTE').length
    const inacessivel = items.filter((i) => i.veredito === 'FONTE_INACESSIVEL').length
    const score = judged.length > 0 ? Math.round((correto / judged.length) * 100) : null

    return { messageId, total: items.length, correto, errado, semSuporte, inacessivel, score, items }
  }
}
