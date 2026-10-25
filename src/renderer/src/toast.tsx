import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { errorMessage } from './api'

type Kind = 'info' | 'error'
interface Toast {
  id: number
  kind: Kind
  text: string
}

interface ToastApi {
  info(text: string): void
  error(err: unknown): void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3000)
  }, [])

  const api: ToastApi = {
    info: useCallback((text: string) => push('info', text), [push]),
    error: useCallback((err: unknown) => push('error', errorMessage(err)), [push])
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast fora do ToastProvider')
  return ctx
}
