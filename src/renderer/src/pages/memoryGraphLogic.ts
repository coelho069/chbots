import type { GraphGroup, MemoryFato, MemoryLigacao } from '@shared/types'

// Lógica pura do Grafo de Memória (sem DOM/React): testável em Node.

export function degreeMap(ligacoes: MemoryLigacao[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const l of ligacoes) {
    m.set(l.origemId, (m.get(l.origemId) ?? 0) + 1)
    m.set(l.destinoId, (m.get(l.destinoId) ?? 0) + 1)
  }
  return m
}

export function nodeRadius(degree: number, scale = 1): number {
  return (2.6 + Math.sqrt(Math.max(0, degree)) * 1.9) * scale
}

/** Nó + vizinhos diretos (o conjunto "aceso" no hover). */
export function neighborsOf(id: number, ligacoes: MemoryLigacao[]): Set<number> {
  const ids = new Set<number>([id])
  for (const l of ligacoes) {
    if (l.origemId === id) ids.add(l.destinoId)
    if (l.destinoId === id) ids.add(l.origemId)
  }
  return ids
}

export function isOrphan(id: number, ligacoes: MemoryLigacao[]): boolean {
  return !ligacoes.some((l) => l.origemId === id || l.destinoId === id)
}

export function hasEntityLink(id: number, ligacoes: MemoryLigacao[]): boolean {
  return ligacoes.some((l) => l.tipo === 'mesma_entidade' && (l.origemId === id || l.destinoId === id))
}

export function hasConflictLink(id: number, ligacoes: MemoryLigacao[]): boolean {
  return ligacoes.some((l) => l.tipo === 'conflito' && (l.origemId === id || l.destinoId === id))
}

/**
 * Consulta de grupo: `categoria:X`, `status:conflito`, `tipo:manual`
 * ou texto livre (trecho do fato, sem diferenciar maiúsculas).
 */
export function matchGroupQuery(
  fato: Pick<MemoryFato, 'id' | 'fato' | 'categoria' | 'status'>,
  consulta: string,
  ligacoes: MemoryLigacao[] = []
): boolean {
  const q = consulta.trim()
  if (!q) return false
  const lower = q.toLowerCase()
  if (lower.startsWith('categoria:')) {
    return fato.categoria.toLowerCase() === q.slice('categoria:'.length).trim().toLowerCase()
  }
  if (lower.startsWith('status:')) {
    return fato.status.toLowerCase() === q.slice('status:'.length).trim().toLowerCase()
  }
  if (lower.startsWith('tipo:')) {
    const tipo = q.slice('tipo:'.length).trim().toLowerCase()
    return ligacoes.some(
      (l) => l.tipo.toLowerCase() === tipo && (l.origemId === fato.id || l.destinoId === fato.id)
    )
  }
  return fato.fato.toLowerCase().includes(lower)
}

/** Cor do nó: primeiro grupo que casar vence; senão a cor da categoria. */
export function resolveNodeColor(
  fato: MemoryFato,
  groups: GraphGroup[],
  catColors: Record<string, string>,
  ligacoes: MemoryLigacao[] = []
): string {
  for (const g of groups) {
    if (matchGroupQuery(fato, g.consulta, ligacoes)) return g.cor
  }
  return catColors[fato.categoria] ?? '#888888'
}

export function groupColorMap(
  fatos: MemoryFato[],
  groups: GraphGroup[],
  catColors: Record<string, string>,
  ligacoes: MemoryLigacao[] = []
): Map<number, string> {
  const m = new Map<number, string>()
  for (const f of fatos) m.set(f.id, resolveNodeColor(f, groups, catColors, ligacoes))
  return m
}

/** Subgrafo local por BFS a partir do centro, profundidade 1–3. */
export function localGraph(
  centerId: number,
  fatos: MemoryFato[],
  ligacoes: MemoryLigacao[],
  depth: number
): { nodes: MemoryFato[]; links: MemoryLigacao[] } {
  const d = Math.min(3, Math.max(1, Math.floor(depth) || 1))
  const included = new Set<number>([centerId])
  let frontier = new Set<number>([centerId])
  for (let level = 0; level < d; level++) {
    const next = new Set<number>()
    for (const l of ligacoes) {
      if (frontier.has(l.origemId) && !included.has(l.destinoId)) next.add(l.destinoId)
      if (frontier.has(l.destinoId) && !included.has(l.origemId)) next.add(l.origemId)
    }
    for (const id of next) included.add(id)
    frontier = next
    if (frontier.size === 0) break
  }
  return {
    nodes: fatos.filter((f) => included.has(f.id)),
    links: ligacoes.filter((l) => included.has(l.origemId) && included.has(l.destinoId))
  }
}

export function chronologicalOrder(fatos: MemoryFato[]): MemoryFato[] {
  return [...fatos].sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime())
}

/** Alpha do rótulo: 0 abaixo do threshold, fade suave acima; destaque força 1. */
export function labelAlpha(globalScale: number, textFade: number, highlighted: boolean): number {
  if (highlighted) return 1
  if (globalScale < textFade) return 0
  return Math.min(1, (globalScale - textFade) / 0.6 + 0.15)
}
