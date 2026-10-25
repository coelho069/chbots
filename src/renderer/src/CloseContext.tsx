import { createContext, useContext, useEffect, useRef } from 'react'
import { CLOSE_CURRENT_HINT } from '@shared/ipc'
import type { CloseHandler } from './closeCurrent'

export interface CloseApi {
  setHandler(handler: CloseHandler | null, owner: object): void
  requestClose(): void
}

export const CloseContext = createContext<CloseApi>({ setHandler: () => undefined, requestClose: () => undefined })

// A tela ativa diz o que "fechar" significa para ela (Ctrl+B e o botão ×).
export function useCloseHandler(handler: CloseHandler): void {
  const { setHandler } = useContext(CloseContext)
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const owner = {}
    setHandler(() => ref.current(), owner)
    return () => setHandler(null, owner)
  }, [setHandler])
}

export function CloseButton({ label }: { label: string }) {
  const { requestClose } = useContext(CloseContext)
  const title = `${label} (${CLOSE_CURRENT_HINT})`
  return (
    <button type="button" className="icon close-x" title={title} aria-label={title} onClick={requestClose}>
      ×
    </button>
  )
}
