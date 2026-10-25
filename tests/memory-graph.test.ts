import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { saveFact, listLigacoes } from '../src/main/db/repos/memoria'

function db() { return openDatabase(':memory:') }

describe('Grafo de Memória', () => {
  it('dois fatos com a mesma fonte geram ligação mesma_fonte', () => {
    const d = db()
    const r1 = saveFact(d, { fato: 'O projeto Alpha usa Redis para cache', categoria: 'Projetos', fonte: 'https://wiki.empresa.com/alpha', tipo: 'site' })
    const r2 = saveFact(d, { fato: 'O projeto Alpha tem 3 microsserviços', categoria: 'Projetos', fonte: 'https://wiki.empresa.com/alpha', tipo: 'site' })
    expect(r1.action).toBe('created')
    expect(r2.action).toBe('created')
    const ligacoes = listLigacoes(d)
    const link = ligacoes.find((l) =>
      (l.origemId === r1.fatoId && l.destinoId === r2.fatoId) ||
      (l.origemId === r2.fatoId && l.destinoId === r1.fatoId)
    )
    expect(link).toBeDefined()
    expect(link!.tipo).toBe('mesma_fonte')
  })

  it('fatos em conflito aparecem com link tipo conflito', () => {
    const d = db()
    // strings com similaridade 0,5–0,85: mesmo prefixo, diferente final
    const r1 = saveFact(d, { fato: 'O banco de dados primario usa PostgreSQL versao 14', categoria: 'Infra/Servidores', fonte: 'doc infra v1', tipo: 'arquivo' })
    const r2 = saveFact(d, { fato: 'O banco de dados primario usa MySQL versao 8', categoria: 'Infra/Servidores', fonte: 'doc infra v2', tipo: 'arquivo' })
    expect(r1.action).toBe('created')
    expect(r2.action).toBe('conflict')
    const ligacoes = listLigacoes(d)
    const conflito = ligacoes.find((l) => l.tipo === 'conflito')
    expect(conflito).toBeDefined()
  })

  it('filtro por categoria em listLigacoes exclui ligações de outras categorias', () => {
    const d = db()
    // dois fatos na mesma fonte, categorias diferentes
    saveFact(d, { fato: 'João trabalha no time de plataforma', categoria: 'Pessoas', fonte: 'reuniao 2024-01', tipo: 'conversa' })
    saveFact(d, { fato: 'Time de plataforma usa Kubernetes', categoria: 'Infra/Servidores', fonte: 'reuniao 2024-01', tipo: 'conversa' })
    // mais dois na mesma fonte, categoria Projetos
    saveFact(d, { fato: 'Projeto Beta é prioridade Q1', categoria: 'Projetos', fonte: 'sprint review', tipo: 'conversa' })
    saveFact(d, { fato: 'Projeto Beta tem deadline em março', categoria: 'Projetos', fonte: 'sprint review', tipo: 'conversa' })

    const all = listLigacoes(d)
    const projetos = listLigacoes(d, { categoria: 'Projetos' })
    // filtrado deve ter menos (ou igual) ligações que o total
    expect(projetos.length).toBeLessThanOrEqual(all.length)
    // todas as ligações retornadas devem envolver ao menos um fato de Projetos
    for (const l of projetos) {
      const origemCat = (d.prepare('SELECT categoria FROM memoria_fatos WHERE id=?').get(l.origemId) as { categoria: string } | undefined)?.categoria
      const destinoCat = (d.prepare('SELECT categoria FROM memoria_fatos WHERE id=?').get(l.destinoId) as { categoria: string } | undefined)?.categoria
      expect(origemCat === 'Projetos' || destinoCat === 'Projetos').toBe(true)
    }
  })
})
