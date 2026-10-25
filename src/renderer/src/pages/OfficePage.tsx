import { useCallback } from 'react'
import { OfficeCanvas } from '../office/OfficeCanvas'
import { api } from '../api'

interface Props {
  onOpenChat: (agentId: number) => void
}

export function OfficePage({ onOpenChat }: Props) {
  const handleStop = useCallback(async (_botId: number) => {
    // shortcut: no stop IPC yet; extend when chat.stop channel is added
    try { await (api as any).chat?.stop?.(_botId) } catch {} // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [])

  return (
    <div className="page" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
      <OfficeCanvas onOpenChat={onOpenChat} onStop={handleStop} />
    </div>
  )
}
