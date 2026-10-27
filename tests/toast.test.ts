import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

describe('avisos (toast)', () => {
  it('não exibe mais o aviso de atualização do loadHistory() na inicialização', () => {
    const offenders = files(join('src', 'renderer')).filter((f) =>
      /loadHistory\(\) adicionado|UpdateNotification/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders).toEqual([])
  })

  it('ToastProvider memoriza o valor do contexto', () => {
    const code = readFileSync(join('src', 'renderer', 'src', 'toast.tsx'), 'utf8')
    expect(code).toMatch(/const api = useMemo<ToastApi>\(/)
    expect(code).toMatch(/<ToastContext\.Provider value=\{api\}>/)
  })
})
