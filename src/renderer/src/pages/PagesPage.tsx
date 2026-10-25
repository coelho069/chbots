import { useEffect, useState } from 'react'
import type { PageRecord } from '@shared/types'
import { api, formatDateTime } from '../api'

export function PagesPage({ onOpen }: { onOpen: (page: PageRecord) => void }) {
  const [pages, setPages] = useState<PageRecord[]>([])
  const reload = () => api.pages.list().then(setPages)
  useEffect(() => { void reload() }, [])
  return (
    <div className="page scroll">
      <h2>Pages</h2>
      {pages.length === 0 && <p className="muted">Nenhuma page criada ainda. Peca ao agente para criar um painel com render_page.</p>}
      <ul>
        {pages.map((p) => (
          <li key={p.id} style={{ marginBottom: 8 }}>
            <strong>{p.title}</strong>
            <span className="muted small"> · {formatDateTime(p.updatedAt)}</span>
            <button style={{ marginLeft: 8 }} onClick={() => onOpen(p)}>Abrir</button>
            <button className="danger" style={{ marginLeft: 4 }} onClick={() => api.pages.delete(p.id).then(reload)}>Excluir</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
