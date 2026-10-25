import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { saveFact, searchFacts, normalizeText, trigramSimilarity } from '../src/main/db/repos/memoria'

function db() {
  return openDatabase(':memory:')
}

describe('Memória', () => {
  it('duplicado não cria registro novo — soma confirmações', () => {
    const d = db()
    const r1 = saveFact(d, { fato: 'O servidor web principal roda na porta 80 do ambiente de producao', categoria: 'Infra/Servidores', fonte: 'manual', tipo: 'usuario' })
    const r2 = saveFact(d, { fato: 'O servidor web principal roda na porta 80 do ambiente de producao', categoria: 'Infra/Servidores', fonte: 'segundo aviso', tipo: 'site' })
    expect(r1.action).toBe('created')
    expect(r2.action).toBe('duplicate')
    expect(r2.fatoId).toBe(r1.fatoId)
    const row = d.prepare('SELECT confirmacoes FROM memoria_fatos WHERE id=?').get(r1.fatoId) as { confirmacoes: number } | undefined
    expect(row?.confirmacoes).toBe(2)
  })

  it('fato sem fonte é rejeitado (fatoId === -1)', () => {
    const d = db()
    const r = saveFact(d, { fato: 'Informação importante', categoria: 'Outros', fonte: '', tipo: 'modelo' })
    expect(r.fatoId).toBe(-1)
    const count = d.prepare('SELECT COUNT(*) as n FROM memoria_fatos').get() as { n: number } | undefined
    expect(count?.n).toBe(0)
  })

  it('contradição é marcada como conflito — nenhum fato é apagado', () => {
    const d = db()
    const r1 = saveFact(d, { fato: 'O budget do projeto X é de R$ 50.000', categoria: 'Projetos', fonte: 'reunião', tipo: 'usuario' })
    const r2 = saveFact(d, { fato: 'O budget do projeto X é de R$ 80.000', categoria: 'Projetos', fonte: 'email', tipo: 'arquivo' })
    expect(r1.action).toBe('created')
    expect(r2.action).toBe('conflict')
    const rows = d.prepare('SELECT id, status FROM memoria_fatos ORDER BY id').all() as unknown as { id: number; status: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'conflito')).toBe(true)
  })

  it('busca retorna fato com fonte', () => {
    const d = db()
    saveFact(d, { fato: 'João é o gerente de TI', categoria: 'Pessoas', fonte: 'https://empresa.com/org', tipo: 'site' })
    const results = searchFacts(d, 'gerente TI')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.fontes.length).toBeGreaterThan(0)
    expect(results[0]!.fontes[0]!.fonte).toBe('https://empresa.com/org')
  })
})
