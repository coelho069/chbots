import { useCallback, useEffect, useRef, useState } from 'react'
import type { BotDeskState, OfficeEvent } from '@shared/office'
import { OfficeAnimator } from './animator'
import type { BotAnim } from './animator'
import { drawDesk, drawBot, drawBalloon, drawApprovalBadge, drawError, drawDone, drawPaper, drawDottedLine } from './sprites'
import { SidePanel } from './SidePanel'
import { getSimBots, startSimulation } from './simulation'
import { api } from '../api'

interface Props {
  onOpenChat: (botId: number) => void
  onStop: (botId: number) => void
}

const CANVAS_W = 900
const CANVAS_H = 600

export function OfficeCanvas({ onOpenChat, onStop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef(new OfficeAnimator())
  const rafRef    = useRef<number>(0)
  const simStop   = useRef<(() => void) | null>(null)
  const [selected, setSelected] = useState<BotAnim | null>(null)
  const [simRunning, setSimRunning] = useState(false)
  const [speedMult, setSpeedMult] = useState(1)
  const [onlyActive, setOnlyActive] = useState(false)
  const [compact, setCompact] = useState(false)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0, dragging: false, lastX: 0, lastY: 0 })

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(api as any).office?.getEstado?.().then((desks: BotDeskState[]) => {
      const anim = animRef.current
      desks.forEach((d: BotDeskState, i: number) => {
        const cols = 4; const cellW = 160
        anim.registerBot(d, {
          botId: d.botId,
          deskX: 20 + (i % cols) * cellW,
          deskY: 40 + Math.floor(i / cols) * 120,
          deskW: 130, deskH: 60,
        })
      })
    }).catch(() => undefined)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (api as any).office?.onEvent?.((evs: OfficeEvent[]) => {
      for (const ev of evs) animRef.current.applyEvent(ev)
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let hidden = false
    const onVis = () => { hidden = document.hidden }
    document.addEventListener('visibilitychange', onVis)

    let lastTs = 0
    function loop(ts: number) {
      rafRef.current = requestAnimationFrame(loop)
      if (hidden) return
      if (ts - lastTs < 1000 / (60 * speedMult) - 2) return
      lastTs = ts

      animRef.current.tick(Date.now())

      const v = viewRef.current
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.translate(v.tx, v.ty)
      ctx.scale(v.scale, v.scale)

      ctx.fillStyle = '#12131a'
      ctx.fillRect(-500, -500, CANVAS_W + 1000, CANVAS_H + 1000)

      const bots = Array.from(animRef.current.bots.values())
        .filter(b => !onlyActive || b.state !== 'idle')

      for (const b of bots) {
        if (b.linkTo !== undefined) {
          const target = animRef.current.bots.get(b.linkTo)
          if (target) drawDottedLine(ctx, b.px, b.py, target.px, target.py, b.frame)
        }
      }

      for (const b of bots) {
        if (b.delegateTo !== undefined && b.paperProgress !== undefined) {
          const target = animRef.current.bots.get(b.delegateTo)
          if (target) {
            drawPaper(ctx,
              b.homeX + (target.px - b.homeX) * b.paperProgress,
              b.homeY + (target.py - b.homeY) * b.paperProgress,
            )
          }
        }
      }

      for (const b of bots) {
        const desk = animRef.current.desks.get(b.botId)
        if (desk) {
          const sc = compact ? 0.7 : 1
          drawDesk(ctx, desk.deskX, desk.deskY, desk.deskW * sc, desk.deskH * sc, b.color, b.name)
        }
        drawBot(ctx, b.px, b.py, b.color, b.state, b.frame, compact)
        const text = b.state === 'thinking' ? '...' : b.balloonText
        drawBalloon(ctx, b.px, b.py, text, b.state, b.frame)
        if (b.state === 'approval') drawApprovalBadge(ctx, b.px + 12, b.py - 30, b.frame)
        if (b.state === 'error')    drawError(ctx, b.px + 10, b.py - 20)
        if (b.state === 'done')     drawDone(ctx, b.px + 10, b.py - 20)
      }

      ctx.restore()
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [speedMult, onlyActive, compact])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const v = viewRef.current
    const mx = (e.clientX - rect.left - v.tx) / v.scale
    const my = (e.clientY - rect.top  - v.ty) / v.scale
    for (const b of animRef.current.bots.values()) {
      if (Math.abs(mx - b.px) < 14 && Math.abs(my - b.py) < 18) { setSelected(b); return }
    }
    setSelected(null)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const v = viewRef.current
    v.scale = Math.max(0.3, Math.min(3, v.scale * (e.deltaY > 0 ? 0.9 : 1.1)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    viewRef.current.dragging = true; viewRef.current.lastX = e.clientX; viewRef.current.lastY = e.clientY
  }, [])
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const v = viewRef.current; if (!v.dragging) return
    v.tx += e.clientX - v.lastX; v.ty += e.clientY - v.lastY
    v.lastX = e.clientX; v.lastY = e.clientY
  }, [])
  const handleMouseUp = useCallback(() => { viewRef.current.dragging = false }, [])

  function toggleSim() {
    if (simRunning) {
      simStop.current?.(); simStop.current = null; setSimRunning(false)
      for (const id of [-1, -2, -3]) animRef.current.bots.delete(id)
      return
    }
    const anim = animRef.current
    getSimBots().forEach((sb, i) => {
      anim.registerBot(
        { botId: sb.id, name: sb.name, color: sb.color, state: 'idle' },
        { botId: sb.id, deskX: 20 + i * 200, deskY: 400, deskW: 160, deskH: 60 },
      )
    })
    simStop.current = startSimulation((evs) => { for (const ev of evs) anim.applyEvent(ev) })
    setSimRunning(true)
  }

  function autoLayout() {
    animRef.current.autoLayout(canvasRef.current?.width ?? CANVAS_W, canvasRef.current?.height ?? CANVAS_H)
  }

  return (
    <div className="office-wrap">
      <div className="office-toolbar">
        <button onClick={autoLayout}>Organizar mesas</button>
        <label className="check">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Só ativos
        </label>
        <label className="check">
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
          Compacto
        </label>
        <label className="small">
          Velocidade: {speedMult.toFixed(1)}×
          <input type="range" min={0.2} max={3} step={0.1} value={speedMult}
            onChange={(e) => setSpeedMult(Number(e.target.value))} style={{ width: 80 }} />
        </label>
        <button onClick={toggleSim} style={{ marginLeft: 'auto' }}>
          {simRunning ? 'Parar simulação' : 'Simular'}
        </button>
      </div>
      <div className="office-scene" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="office-canvas"
          onClick={handleClick}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
        />
        {selected && (
          <SidePanel
            bot={selected}
            onClose={() => setSelected(null)}
            onStop={(id) => { onStop(id); setSelected(null) }}
            onOpenChat={(id) => { onOpenChat(id); setSelected(null) }}
          />
        )}
      </div>
    </div>
  )
}
