import type { Db } from '../db/connection'
import { getAgent } from '../db/repos/agents'
import { saveFact, searchFacts, type SaveFactInput } from '../db/repos/memoria'
import type { LlmClient } from '../llm/provider'

export interface MemoryServiceDeps {
  db: Db
  clientFor: (providerId: number) => LlmClient
}

const EXTRACT_SYSTEM = `Você é um extrator de fatos. Analise o texto e retorne SOMENTE um array JSON com até 10 fatos objetivos. Formato:
[{"fato":"texto curto","categoria":"Pessoas|Projetos|Infra/Servidores|Segurança|Notícias|Preferências|Tarefas|Outros","fonte":"origem obrigatória","data_fonte":"AAAA-MM-DD ou null","confianca":70}]
Regras: fato sem fonte não inclua. Se não houver fatos, retorne [].`

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  buildContextSection(query: string): string {
    const fatos = searchFacts(this.deps.db, query, 10)
    if (fatos.length === 0) return ''
    const lines = fatos.map((f) => {
      const src = f.fontes[0]?.fonte ?? '?'
      return `- ${f.fato} (fonte: ${src}, confiança: ${f.confianca})`
    })
    return `\n\n--- Memória relevante ---\n${lines.join('\n')}\n\nRegra: cite a fonte ao afirmar. Se não souber, diga que não sabe.`
  }

  extractAndSaveAsync(agentId: number, text: string, source: string): void {
    void this._extract(agentId, text, source).catch(() => {})
  }

  private async _extract(agentId: number, text: string, source: string): Promise<void> {
    const agent = getAgent(this.deps.db, agentId)
    if (!agent) return
    const client = this.deps.clientFor(agent.providerId)
    let raw = ''
    await client.chat(
      { model: agent.model, system: EXTRACT_SYSTEM, messages: [{ role: 'user', content: text.slice(0, 8000) }], temperature: 0.1 },
      (d) => { raw += d }
    )
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return
    const items = JSON.parse(match[0]) as Array<{ fato?: string; categoria?: string; fonte?: string; data_fonte?: string; confianca?: number }>
    for (const item of items) {
      if (!item.fato?.trim() || !item.fonte?.trim()) continue
      const input: SaveFactInput = {
        fato: item.fato.trim().slice(0, 500),
        categoria: item.categoria?.trim() || 'Outros',
        fonte: item.fonte.trim() || source,
        tipo: 'conversa',
        dateFonte: item.data_fonte ?? null,
        confianca: item.confianca
      }
      saveFact(this.deps.db, input)
    }
  }
}
