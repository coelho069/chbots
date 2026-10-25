export const api = window.pilotos

// O Electron embrulha erros do main em "Error invoking remote method 'x': Error: ...".
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const msg = raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
  if (msg.startsWith('[') && msg.includes('"message"')) {
    try {
      const issues = JSON.parse(msg) as { path?: unknown[]; message: string }[]
      return issues.map((i) => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
    } catch {
      // não era a lista de erros do zod
    }
  }
  return msg
}

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
