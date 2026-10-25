import type { BotAnim } from './animator'

interface Props {
  bot: BotAnim
  onClose: () => void
  onStop: (botId: number) => void
  onOpenChat: (botId: number) => void
}

const stateLabel: Record<string, string> = {
  idle: 'Ocioso', thinking: 'Pensando', writing: 'Escrevendo',
  tool: 'Usando ferramenta', approval: 'Aguardando aprovação',
  error: 'Erro', done: 'Concluído',
}

export function SidePanel({ bot, onClose, onStop, onOpenChat }: Props) {
  const elapsed = bot.state !== 'idle' && bot.state !== 'done'
    ? Math.floor((Date.now() - ((bot as unknown as { startedAt?: number }).startedAt ?? Date.now())) / 1000)
    : 0

  return (
    <div className="office-panel">
      <div className="office-panel-head">
        <span className="dot" style={{ background: bot.color }} />
        <strong>{bot.name}</strong>
        <button className="mg-x" onClick={onClose}>×</button>
      </div>
      <div className="office-panel-body">
        <div className="office-panel-row">
          <span className="muted small">Estado</span>
          <span>{stateLabel[bot.state] ?? bot.state}</span>
        </div>
        {elapsed > 0 && (
          <div className="office-panel-row">
            <span className="muted small">Tempo</span>
            <span>{elapsed}s</span>
          </div>
        )}
        {bot.balloonText && bot.balloonText !== 'zZz' && (
          <div className="office-panel-row">
            <span className="muted small">Atividade</span>
            <span className="small">{bot.balloonText}</span>
          </div>
        )}
      </div>
      <div className="office-panel-actions">
        <button onClick={() => onStop(bot.botId)}>Parar</button>
        <button className="primary" onClick={() => onOpenChat(bot.botId)}>Abrir Chat</button>
      </div>
    </div>
  )
}
