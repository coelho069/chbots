import { useEffect, useState } from 'react'
import type { LastUpdate } from '@shared/types'
import { api } from './api'

// Aviso depois que o app reabre por causa de "Atualizar agora" (o main só devolve se for de menos de 10 min).
export function UpdateNotice() {
  const [last, setLast] = useState<LastUpdate | null>(null)
  useEffect(() => { void api.update.last().then(setLast) }, [])
  if (!last) return null
  const close = (): void => { setLast(null); void api.update.ack() }
  return (
    <div role="alertdialog" className="card" style={{ position: 'fixed', right: 16, bottom: 16, maxWidth: 380, zIndex: 1000, boxShadow: '0 4px 20px #0005' }}>
      <h3 style={{ marginTop: 0 }}>Atualizado com sucesso</h3>
      <p className="small">Versão {last.versao} (commit {last.commitAntigo} → {last.commitNovo})</p>
      <div className="small mono">{last.commits.map((c) => <div key={c}>{c}</div>)}</div>
      <div className="actions"><button onClick={close}>OK</button></div>
    </div>
  )
}
