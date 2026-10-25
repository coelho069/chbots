export type BotActivityState = 'idle' | 'thinking' | 'writing' | 'tool' | 'approval' | 'error' | 'done'

export interface OfficeEvent {
  botId: number
  state: BotActivityState
  task?: string    // max 80 chars, NUNCA chaves/tokens
  from?: number
  to?: number
  tool?: string
  text?: string    // max 60 chars, últimas palavras ao escrever
  error?: string
  ts: number
}

export interface BotDeskState {
  botId: number
  name: string
  color: string
  state: BotActivityState
  task?: string
  tool?: string
  error?: string
  startedAt?: number
}
