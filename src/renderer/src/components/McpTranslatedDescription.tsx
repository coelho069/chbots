import { useEffect, useState } from 'react'
import { api } from '../api'

interface Props {
  serverName: string
  itemName: string
  original: string
  knownTranslation?: string
  translated?: string
  translationStatus?: 'translating' | 'translated' | 'original'
  refreshToken?: number
  className?: string
}

export function McpTranslatedDescription({ serverName, itemName, original, knownTranslation, translated: translatedFromServer, translationStatus, refreshToken = 0, className }: Props) {
  const [translated, setTranslated] = useState<string | null>(translatedFromServer ?? (knownTranslation && knownTranslation !== original ? knownTranslation : null))
  const [translating, setTranslating] = useState(translationStatus === 'translating')
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => {
    setShowOriginal(false)
    if (translatedFromServer && translatedFromServer !== original) {
      setTranslated(translatedFromServer)
      setTranslating(false)
      return
    }
    if (translationStatus === 'translating') {
      setTranslated(null)
      setTranslating(true)
      return
    }
    if (translationStatus === 'original') {
      setTranslated(original)
      setTranslating(false)
      return
    }
    if (knownTranslation && knownTranslation !== original) {
      setTranslated(knownTranslation)
      setTranslating(false)
      return
    }
    if (!original.trim()) return
    let active = true
    setTranslated(null)
    setTranslating(true)
    void api.mcp.translateTool(`${serverName}.${itemName}`, original)
      .then((value) => { if (active) setTranslated(value || original) })
      .catch(() => { if (active) setTranslated(original) })
      .finally(() => { if (active) setTranslating(false) })
    return () => { active = false }
  }, [serverName, itemName, original, knownTranslation, translatedFromServer, translationStatus, refreshToken])

  const value = showOriginal ? original : (translated ?? original)
  return (
    <span className={className}>
      {value}
      {translating && <span className="muted"> (traduzindo…)</span>}
      <button
        type="button"
        className="small"
        title={showOriginal ? 'Mostrar tradução pt-BR' : 'Ver texto original'}
        aria-label={showOriginal ? 'Mostrar tradução pt-BR' : 'Ver texto original'}
        onClick={() => setShowOriginal((current) => !current)}
      >
        {showOriginal ? '↩' : 'ⓘ'}
      </button>
    </span>
  )
}
