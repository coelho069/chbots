import type { OfficeEvent, BotActivityState } from '@shared/office'

interface SimBot { id: number; name: string; color: string }

const SIM_BOTS: SimBot[] = [
  { id: -1, name: 'Alfa', color: '#4f7cff' },
  { id: -2, name: 'Beta', color: '#16a37f' },
  { id: -3, name: 'Gama', color: '#e0703a' },
]

export function getSimBots() { return SIM_BOTS }

export function startSimulation(emit: (evs: OfficeEvent[]) => void): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []

  function e(botId: number, state: BotActivityState, extra: Partial<OfficeEvent> = {}): OfficeEvent {
    return { botId, state, ts: Date.now(), ...extra }
  }

  const seq: [number, () => void][] = [
    [0,    () => emit([e(-1, 'thinking', { task: 'Analisar relatório' })])],
    [800,  () => emit([e(-1, 'writing',  { text: 'Com base nos dados...' })])],
    [1600, () => emit([e(-2, 'thinking', { task: 'Buscar dados externos' })])],
    [2200, () => emit([e(-2, 'tool',     { tool: 'web-search' })])],
    [3000, () => emit([e(-1, 'writing',  { text: 'A análise indica...' }), e(-2, 'done')])],
    [3800, () => emit([e(-1, 'thinking', { from: -1, to: -3, task: 'Revisar conclusões' })])],
    [4400, () => emit([e(-3, 'thinking', { task: 'Revisando...' }), e(-1, 'idle')])],
    [5200, () => emit([e(-3, 'approval', { tool: 'file-write' })])],
    [6500, () => emit([e(-3, 'error',    { error: 'Permissão negada' })])],
    [7500, () => emit([e(-3, 'idle'), e(-1, 'done')])],
    [8500, () => emit([e(-1, 'idle'), e(-2, 'idle')])],
  ]

  for (const [delay, fn] of seq) {
    timers.push(setTimeout(fn, delay))
  }

  return () => timers.forEach(clearTimeout)
}
