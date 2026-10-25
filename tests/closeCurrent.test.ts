import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CLOSE_CURRENT_ACCELERATOR, CLOSE_CURRENT_HINT } from '../src/shared/ipc'
import type { UnsavedChoice } from '../src/shared/types'
import { unsavedChoice, unsavedDialog } from '../src/main/closeDialog'
import { confirmUnsaved, createCloser, sameFields, type CloseHandler } from '../src/renderer/src/closeCurrent'

function closer(handler: CloseHandler | null, home = false) {
  const goHome = vi.fn()
  const onError = vi.fn()
  const close = createCloser({ getHandler: () => handler, isHome: () => home, goHome, onError })
  return { close, goHome, onError }
}

describe('Ctrl+B: fechar item atual', () => {
  it('fecha o item aberto e fica na tela', async () => {
    const { close, goHome } = closer(() => 'closed')
    expect(await close()).toBe('closed')
    expect(goHome).not.toHaveBeenCalled()
  })

  it('sem item aberto, volta para a tela inicial', async () => {
    const { close, goHome } = closer(() => 'nothing')
    expect(await close()).toBe('closed')
    expect(goHome).toHaveBeenCalledOnce()
  })

  it('sem item aberto e já na tela inicial: não faz nada (nunca fecha o app)', async () => {
    const { close, goHome } = closer(() => 'nothing', true)
    expect(await close()).toBe('nothing')
    expect(goHome).not.toHaveBeenCalled()
  })

  it('tela sem handler também volta ao início', async () => {
    const { close, goHome } = closer(null)
    expect(await close()).toBe('closed')
    expect(goHome).toHaveBeenCalledOnce()
  })

  it('Cancelar na pergunta mantém tudo como está', async () => {
    const { close, goHome } = closer(() => 'cancelled')
    expect(await close()).toBe('cancelled')
    expect(goHome).not.toHaveBeenCalled()
  })

  it('Ctrl+B repetido com a pergunta aberta é ignorado', async () => {
    let answer!: (r: 'closed') => void
    const handler = vi.fn(() => new Promise<'closed'>((r) => (answer = r)))
    const { close } = closer(handler)
    const first = close()
    expect(await close()).toBe('busy')
    answer('closed')
    expect(await first).toBe('closed')
    expect(handler).toHaveBeenCalledOnce()
    // depois de responder, volta a funcionar
    void close()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('erro no handler vira aviso e não fecha nada', async () => {
    const { close, goHome, onError } = closer(() => {
      throw new Error('falhou')
    })
    expect(await close()).toBe('cancelled')
    expect(onError).toHaveBeenCalledOnce()
    expect(goHome).not.toHaveBeenCalled()
  })
})

describe('Salvar antes de fechar?', () => {
  const asking = (choice: UnsavedChoice) => vi.fn(async (_detail: string, _canSave: boolean) => choice)

  it('Salvar: salva e fecha; se o salvamento falhar, não fecha', async () => {
    const ask = asking('save')
    expect(await confirmUnsaved(ask, 'fluxo editado', async () => true)).toBe(true)
    expect(ask).toHaveBeenCalledWith('fluxo editado', true)
    expect(await confirmUnsaved(ask, 'x', async () => false)).toBe(false)
  })

  it('Descartar fecha sem salvar', async () => {
    const save = vi.fn(async () => true)
    expect(await confirmUnsaved(asking('discard'), 'x', save)).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('Cancelar não fecha', async () => {
    expect(await confirmUnsaved(asking('cancel'), 'x', async () => true)).toBe(false)
  })

  it('sem como salvar, só oferece Descartar/Cancelar', async () => {
    const ask = asking('discard')
    expect(await confirmUnsaved(ask, 'x')).toBe(true)
    expect(ask).toHaveBeenCalledWith('x', false)
  })

  it('caixa nativa: botões, Esc = Cancelar e tradução da resposta', () => {
    const three = unsavedDialog('O fluxo "F" tem alterações não salvas.', true)
    expect(three).toMatchObject({ message: 'Salvar antes de fechar?', buttons: ['Salvar', 'Descartar', 'Cancelar'], cancelId: 2 })
    expect([0, 1, 2, 99].map((i) => unsavedChoice(i, true))).toEqual(['save', 'discard', 'cancel', 'cancel'])

    const two = unsavedDialog('x', false)
    expect(two).toMatchObject({ buttons: ['Descartar', 'Cancelar'], cancelId: 1 })
    expect([0, 1].map((i) => unsavedChoice(i, false))).toEqual(['discard', 'cancel'])
  })

  it('compara só os campos do formulário', () => {
    const a = { name: 'A', schedule: { h: 8 }, id: 1 }
    expect(sameFields(a, { name: 'A', schedule: { h: 8 }, id: 2 }, ['name', 'schedule'])).toBe(true)
    expect(sameFields(a, { name: 'A', schedule: { h: 9 }, id: 1 }, ['name', 'schedule'])).toBe(false)
  })
})

describe('Ctrl+B não conflita com outros atalhos', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : []
    })
  }

  it('é o único uso de Ctrl+B no app', () => {
    expect(CLOSE_CURRENT_ACCELERATOR).toBe('CmdOrCtrl+B')
    expect(CLOSE_CURRENT_HINT).toBe('Ctrl+B')
    const src = join(import.meta.dirname, '..', 'src')
    const offenders = files(src).filter((f) => {
      const code = readFileSync(f, 'utf8')
      // tecla "b" tratada à mão, outro accelerator com B, ou edição rica (onde Ctrl+B seria negrito)
      return /key\s*===?\s*['"][bB]['"]|['"](?:CmdOrCtrl|Ctrl|CommandOrControl)\+B['"]|contentEditable|execCommand\(['"]bold/.test(code) &&
        !f.endsWith(join('shared', 'ipc.ts'))
    })
    expect(offenders).toEqual([])
  })
})
