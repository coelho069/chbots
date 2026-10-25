import type { UnsavedChoice } from '@shared/types'

// Sem Electron aqui: só monta a pergunta e traduz o botão clicado (testável).
export function unsavedDialog(detail: string, canSave: boolean) {
  const buttons = canSave ? ['Salvar', 'Descartar', 'Cancelar'] : ['Descartar', 'Cancelar']
  return {
    type: 'question' as const,
    title: 'CH BOTS',
    message: canSave ? 'Salvar antes de fechar?' : 'Descartar as alterações e fechar?',
    detail,
    buttons,
    defaultId: 0,
    // Esc e o "x" da caixa contam como Cancelar
    cancelId: buttons.length - 1,
    noLink: true
  }
}

export function unsavedChoice(response: number, canSave: boolean): UnsavedChoice {
  const choices: UnsavedChoice[] = canSave ? ['save', 'discard', 'cancel'] : ['discard', 'cancel']
  return choices[response] ?? 'cancel'
}
