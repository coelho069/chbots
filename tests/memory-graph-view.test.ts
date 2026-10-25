import { describe, expect, it } from 'vitest'
import type { MemoryFato, MemoryLigacao } from '../src/shared/types'
import {
  degreeMap, groupColorMap, labelAlpha, localGraph, matchGroupQuery,
  neighborsOf, nodeRadius, resolveNodeColor
} from '../src/renderer/src/pages/memoryGraphLogic'
import { openDatabase } from '../src/main/db/connection'
import {
  deleteGraphGroup, getGraphConfig, listGraphGroups, saveGraphConfig, saveGraphGroup
} from '../src/main/db/repos/memoria'

function fato(id: number, texto: string, categoria = 'Projetos', criadoEm = '2024-01-01T00:00:00.000Z'): MemoryFato {
  return {
    id, fato: texto, categoria, confianca: 80, status: 'ativo',
    confirmacoes: 1, criadoEm, atualizadoEm: criadoEm, fontes: []
  }
}
function lig(id: number, a: number, b: number, tipo: MemoryLigacao['tipo'] = 'similar'): MemoryLigacao {
  return { id, origemId: a, destinoId: b, tipo, peso: 1, criadoEm: '2024-01-01T00:00:00.000Z' }
}

// A(1)-B(2), A(1)-C(3), B(2)-D(4); E(5) isolado
const fatos = [fato(1, 'Alpha'), fato(2, 'Beta'), fato(3, 'Gama'), fato(4, 'Delta'), fato(5, 'Ômega isolado')]
const ligacoes = [lig(1, 1, 2), lig(2, 1, 3), lig(3, 2, 4)]

describe('Grafo de Memória — lógica da view', () => {
  it('hover destaca só os vizinhos diretos', () => {
    const lit = neighborsOf(1, ligacoes)
    expect([...lit].sort()).toEqual([1, 2, 3])
    expect(lit.has(4)).toBe(false) // D é vizinho de B, não de A
    expect(lit.has(5)).toBe(false)
    // todo o resto fica "dim": complementos fora do conjunto aceso
    const dim = fatos.map((f) => f.id).filter((id) => !lit.has(id))
    expect(dim).toEqual([4, 5])
  })

  it('tamanho do nó cresce com o número de ligações', () => {
    const deg = degreeMap(ligacoes)
    expect(deg.get(1)).toBe(2)
    expect(deg.get(4)).toBe(1)
    expect(nodeRadius(deg.get(1)!)).toBeGreaterThan(nodeRadius(deg.get(4)!))
    expect(nodeRadius(0)).toBeGreaterThan(0)
  })

  it('um filtro de grupo muda as cores dos nós', () => {
    const seg = fato(6, 'Senha do servidor', 'Segurança')
    const all = [...fatos, seg]
    const catColors = { Projetos: '#111111', Segurança: '#222222' }
    const semGrupo = groupColorMap(all, [], catColors, ligacoes)
    expect(semGrupo.get(6)).toBe('#222222')

    const groups = [{ id: 1, nome: 'Seg', consulta: 'categoria:Segurança', cor: '#ff0000' }]
    const comGrupo = groupColorMap(all, groups, catColors, ligacoes)
    expect(comGrupo.get(6)).toBe('#ff0000') // grupo vence a cor da categoria
    expect(comGrupo.get(1)).toBe('#111111') // quem não casa mantém a categoria

    expect(matchGroupQuery(seg, 'categoria:segurança')).toBe(true)
    expect(matchGroupQuery(seg, 'categoria:Projetos')).toBe(false)
    expect(matchGroupQuery(seg, 'senha')).toBe(true) // texto livre
    expect(resolveNodeColor(seg, groups, catColors, ligacoes)).toBe('#ff0000')
  })

  it('o grafo local mostra a profundidade certa', () => {
    const ids = (d: number) => localGraph(1, fatos, ligacoes, d).nodes.map((f) => f.id).sort()
    expect(ids(1)).toEqual([1, 2, 3])
    expect(ids(2)).toEqual([1, 2, 3, 4])
    expect(ids(3)).toEqual([1, 2, 3, 4]) // E(5) nunca entra: sem ligação
    const d1 = localGraph(1, fatos, ligacoes, 1)
    expect(d1.links.map((l) => l.id).sort()).toEqual([1, 2]) // sem o link B-D
    const d2 = localGraph(1, fatos, ligacoes, 2)
    expect(d2.links.map((l) => l.id).sort()).toEqual([1, 2, 3])
  })

  it('grupos e configurações do grafo persistem no SQLite', () => {
    const db = openDatabase(':memory:')
    expect(getGraphConfig(db)).toBeNull()
    saveGraphConfig(db, { repelForce: 200, textFade: 2 })
    expect(getGraphConfig(db)).toEqual({ repelForce: 200, textFade: 2 })

    const g = saveGraphGroup(db, { nome: 'Seg', consulta: 'categoria:Segurança', cor: '#ff0000' })
    expect(listGraphGroups(db)).toEqual([g])
    deleteGraphGroup(db, g.id)
    expect(listGraphGroups(db)).toEqual([])
  })

  it('rótulo só aparece acima do limite de zoom, com fade', () => {
    expect(labelAlpha(1.0, 1.5, false)).toBe(0)
    expect(labelAlpha(1.5, 1.5, false)).toBeGreaterThan(0)
    expect(labelAlpha(1.5, 1.5, false)).toBeLessThan(1)
    expect(labelAlpha(3, 1.5, false)).toBe(1)
    expect(labelAlpha(0.5, 1.5, true)).toBe(1) // hover/seleção sempre mostra
  })
})
