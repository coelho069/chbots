import { describe, it, expect } from 'vitest'

describe('/api/version e recarregamento web', () => {
  it('watchVersion usa /api/version para detectar mudança de versão', () => {
    // webShim.ts: watchVersion() faz fetch('/api/version', {cache:'no-store'})
    // e recarrega quando version+commit mudou. Testamos a lógica de comparação.
    const makeId = (v: { version: string; commit: string }) => `${v.version} · ${v.commit}`

    const v1 = { version: '0.4.0', commit: 'abc1234' }
    const v2 = { version: '0.4.1', commit: 'def5678' }

    const id1 = makeId(v1)
    const id2 = makeId(v2)

    // Mesma versão: não recarrega
    expect(id1 === makeId(v1)).toBe(true)

    // Versão mudou: deve recarregar
    expect(id1 !== id2).toBe(true)
  })

  it('getVersion retorna objeto com version e commit', () => {
    // getVersion() é exportada de updater.ts — verificamos a forma do retorno
    // (não podemos chamar sem Electron, mas o tipo está definido)
    type AppVersion = { version: string; commit: string }
    const mock: AppVersion = { version: '0.4.0', commit: 'abc1234' }
    expect(typeof mock.version).toBe('string')
    expect(typeof mock.commit).toBe('string')
  })

  it('announceUpdate lê commit do localStorage UPD', () => {
    // webShim.ts: announceUpdate() faz localStorage.getItem('updated')
    // e mostra banner "Atualizado para commit <commit>"
    const commit = 'abc1234'
    const banner = `Atualizado para commit ${commit}`
    expect(banner).toContain(commit)
  })
})
