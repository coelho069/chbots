import type { BotActivityState, OfficeEvent, BotDeskState } from '@shared/office'

export interface DeskLayout {
  botId: number
  deskX: number
  deskY: number
  deskW: number
  deskH: number
}

export interface BotAnim {
  botId: number
  name: string
  color: string
  state: BotActivityState
  px: number
  py: number
  tx: number
  ty: number
  homeX: number
  homeY: number
  frame: number
  delegateTo?: number
  paperProgress?: number
  doneAt?: number
  balloonText: string
  linkTo?: number
}

export class OfficeAnimator {
  bots = new Map<number, BotAnim>()
  desks = new Map<number, DeskLayout>()

  setDesks(layouts: DeskLayout[]) {
    for (const d of layouts) this.desks.set(d.botId, d)
  }

  registerBot(desk: BotDeskState, layout: DeskLayout) {
    this.desks.set(desk.botId, layout)
    if (!this.bots.has(desk.botId)) {
      const cx = layout.deskX + layout.deskW / 2
      const cy = layout.deskY + layout.deskH / 2
      this.bots.set(desk.botId, {
        botId: desk.botId, name: desk.name, color: desk.color,
        state: desk.state ?? 'idle',
        px: cx, py: cy, tx: cx, ty: cy, homeX: cx, homeY: cy,
        frame: 0, balloonText: 'zZz',
      })
    } else {
      const b = this.bots.get(desk.botId)!
      b.name = desk.name; b.color = desk.color
    }
  }

  applyEvent(ev: OfficeEvent) {
    const b = this.bots.get(ev.botId)
    if (!b) return
    b.state = ev.state
    switch (ev.state) {
      case 'idle':     b.balloonText = 'zZz'; b.tx = b.homeX; b.ty = b.homeY; b.linkTo = undefined; break
      case 'thinking': b.balloonText = '...'; b.linkTo = undefined; break
      case 'writing':  b.balloonText = ev.text ?? '...'; break
      case 'tool': {
        b.balloonText = ev.tool ?? 'ferramenta'
        const desk = this.desks.get(ev.botId)
        if (desk) { b.tx = desk.deskX + desk.deskW + 30; b.ty = desk.deskY }
        break
      }
      case 'approval': b.balloonText = ev.tool ?? 'aprovação?'; break
      case 'error':    b.balloonText = ev.error?.slice(0, 20) ?? 'erro'; break
      case 'done':     b.balloonText = '✓'; b.doneAt = Date.now(); b.tx = b.homeX; b.ty = b.homeY; break
    }
    if (ev.to !== undefined && ev.from === ev.botId) {
      const targetDesk = this.desks.get(ev.to)
      if (targetDesk) {
        b.tx = targetDesk.deskX + targetDesk.deskW / 2
        b.ty = targetDesk.deskY + targetDesk.deskH / 2
        b.delegateTo = ev.to
        b.paperProgress = 0
        b.linkTo = ev.to
      }
    }
  }

  tick(now: number) {
    for (const b of this.bots.values()) {
      b.frame++
      if (b.state === 'done' && b.doneAt && now - b.doneAt > 3000) {
        b.state = 'idle'; b.balloonText = 'zZz'; b.doneAt = undefined
      }
      b.px += (b.tx - b.px) * 0.08
      b.py += (b.ty - b.py) * 0.08
      if (b.delegateTo !== undefined && b.paperProgress !== undefined) {
        b.paperProgress = Math.min(1, b.paperProgress + 0.015)
        if (b.paperProgress >= 1) {
          b.delegateTo = undefined; b.paperProgress = undefined
          b.tx = b.homeX; b.ty = b.homeY
        }
      }
    }
  }

  autoLayout(canvasW: number, canvasH: number) {
    const ids = Array.from(this.bots.keys())
    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)))
    const cellW = Math.floor((canvasW - 40) / cols)
    const cellH = 120
    ids.forEach((id, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const layout: DeskLayout = {
        botId: id,
        deskX: 20 + col * cellW + 10,
        deskY: 40 + row * cellH + 10,
        deskW: cellW - 30,
        deskH: 60,
      }
      this.desks.set(id, layout)
      const b = this.bots.get(id)
      if (!b) return
      const cx = layout.deskX + layout.deskW / 2
      const cy = layout.deskY + layout.deskH / 2
      b.homeX = cx; b.homeY = cy; b.tx = cx; b.ty = cy; b.px = cx; b.py = cy
    })
  }
}
