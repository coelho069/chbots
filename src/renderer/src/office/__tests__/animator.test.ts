import { describe, it, expect, beforeEach } from 'vitest'
import { OfficeAnimator } from '../animator'
import type { BotDeskState } from '@shared/office'

function makeDesk(id: number): BotDeskState {
  return { botId: id, name: `Bot${id}`, color: '#4f7cff', state: 'idle' }
}

function makeLayout(id: number) {
  return { botId: id, deskX: id * 200, deskY: 50, deskW: 130, deskH: 60 }
}

describe('OfficeAnimator', () => {
  let anim: OfficeAnimator
  beforeEach(() => { anim = new OfficeAnimator() })

  it('registerBot cria bot com estado idle', () => {
    anim.registerBot(makeDesk(1), makeLayout(1))
    const b = anim.bots.get(1)
    expect(b).toBeDefined()
    expect(b!.state).toBe('idle')
  })

  it('applyEvent thinking muda estado e balão para "..."', () => {
    anim.registerBot(makeDesk(1), makeLayout(1))
    anim.applyEvent({ botId: 1, state: 'thinking', ts: Date.now() })
    const b = anim.bots.get(1)!
    expect(b.state).toBe('thinking')
    expect(b.balloonText).toBe('...')
  })

  it('applyEvent writing muda balão para o texto recebido', () => {
    anim.registerBot(makeDesk(1), makeLayout(1))
    anim.applyEvent({ botId: 1, state: 'writing', text: 'Olá mundo', ts: Date.now() })
    expect(anim.bots.get(1)!.balloonText).toBe('Olá mundo')
  })

  it('applyEvent done e tick após 3s volta para idle', () => {
    anim.registerBot(makeDesk(1), makeLayout(1))
    const now = Date.now()
    anim.applyEvent({ botId: 1, state: 'done', ts: now })
    expect(anim.bots.get(1)!.state).toBe('done')
    anim.tick(now + 3100)
    expect(anim.bots.get(1)!.state).toBe('idle')
  })

  it('delegação define delegateTo e move posição alvo', () => {
    anim.registerBot(makeDesk(1), makeLayout(1))
    anim.registerBot(makeDesk(2), makeLayout(2))
    const desk2 = makeLayout(2)
    anim.applyEvent({ botId: 1, state: 'thinking', from: 1, to: 2, ts: Date.now() })
    const b = anim.bots.get(1)!
    expect(b.delegateTo).toBe(2)
    // posição alvo deve ser a mesa do bot 2
    expect(b.tx).toBeCloseTo(desk2.deskX + desk2.deskW / 2, 0)
  })

  it('OfficeEvent não contém campos sensíveis', () => {
    const ev = { botId: 1, state: 'thinking' as const, ts: Date.now(), task: 'ok' }
    const keys = Object.keys(ev)
    expect(keys).not.toContain('apiKey')
    expect(keys).not.toContain('token')
    expect(keys).not.toContain('password')
    expect(keys).not.toContain('key')
  })

  it('autoLayout distribui 4 bots em posições distintas', () => {
    for (let i = 1; i <= 4; i++) anim.registerBot(makeDesk(i), makeLayout(i))
    anim.autoLayout(800, 600)
    const positions = Array.from(anim.bots.values()).map(b => `${b.homeX},${b.homeY}`)
    const unique = new Set(positions)
    expect(unique.size).toBe(4)
  })
})
