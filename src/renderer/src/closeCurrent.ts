import type { UnsavedChoice } from '@shared/types'

// 'nothing' = a tela não tinha item aberto; aí o app volta para a tela inicial.
export type CloseResult = 'closed' | 'nothing' | 'cancelled'
export type CloseHandler = () => CloseResult | Promise<CloseResult>

export function createCloser(deps: {
  getHandler: () => CloseHandler | null
  isHome: () => boolean
  goHome: () => void
  onError?: (err: unknown) => void
}) {
  let busy = false
  // Ctrl+B repetido enquanto a pergunta "Salvar antes de fechar?" está aberta é ignorado.
  return async function closeCurrent(): Promise<CloseResult | 'busy'> {
    if (busy) return 'busy'
    busy = true
    try {
      const handler = deps.getHandler()
      const result = handler ? await handler() : 'nothing'
      if (result !== 'nothing') return result
      if (deps.isHome()) return 'nothing'
      deps.goHome()
      return 'closed'
    } catch (err) {
      deps.onError?.(err)
      return 'cancelled'
    } finally {
      busy = false
    }
  }
}

// true = pode fechar. Sem `save`, a pergunta só oferece Descartar/Cancelar.
export async function confirmUnsaved(
  ask: (detail: string, canSave: boolean) => Promise<UnsavedChoice>,
  detail: string,
  save?: () => Promise<boolean>
): Promise<boolean> {
  const choice = await ask(detail, save !== undefined)
  if (choice === 'cancel') return false
  if (choice === 'save') return save ? await save() : false
  return true
}

// Compara só os campos do formulário (ignora id, datas etc.).
export function sameFields<T extends object>(a: T, b: T, keys: (keyof T)[]): boolean {
  return keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}
