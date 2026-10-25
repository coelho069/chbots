import type { BotActivityState } from '@shared/office'

export function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, name: string) {
  ctx.save()
  ctx.fillStyle = '#2a2a3a'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  roundRect(ctx, x, y, w, h, 8)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ccc'
  ctx.font = '11px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(name.slice(0, 12), x + w / 2, y - 6)
  ctx.restore()
}

export function drawBot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, state: BotActivityState, frame: number, small = false) {
  const s = small ? 0.6 : 1
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.fillStyle = color
  ctx.fillRect(-6, -4, 12, 14)
  ctx.fillStyle = lighten(color, 0.2)
  ctx.fillRect(-5, -14, 10, 10)
  ctx.fillStyle = '#fff'
  ctx.fillRect(-3, -12, 2, 2)
  ctx.fillRect(1, -12, 2, 2)
  if (state === 'writing' && frame % 2 === 0) {
    ctx.fillStyle = lighten(color, 0.1)
    ctx.fillRect(-8, 4, 4, 3)
    ctx.fillRect(4, 4, 4, 3)
  }
  if (state === 'idle') {
    const bob = Math.sin(frame / 30) * 1
    ctx.fillStyle = lighten(color, 0.2)
    ctx.fillRect(-5, -14 + bob, 10, 10)
  }
  ctx.restore()
}

export function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, state: BotActivityState, frame: number) {
  ctx.save()
  const padding = 6
  ctx.font = '10px monospace'
  const tw = ctx.measureText(text).width
  const bw = Math.min(tw + padding * 2, 120)
  const bh = 20
  const bx = x - bw / 2
  const by = y - 50
  ctx.fillStyle = state === 'error' ? '#5a1a1a' : state === 'approval' ? '#4a3a00' : '#1e2030'
  ctx.strokeStyle = state === 'error' ? '#e05050' : state === 'approval' ? '#f0c040' : '#555'
  ctx.lineWidth = 1
  roundRect(ctx, bx, by, bw, bh, 4)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x - 4, by + bh)
  ctx.lineTo(x, by + bh + 6)
  ctx.lineTo(x + 4, by + bh)
  ctx.fillStyle = state === 'error' ? '#5a1a1a' : '#1e2030'
  ctx.fill()
  ctx.fillStyle = state === 'error' ? '#e05050' : state === 'approval' ? '#f0c040' : '#ccc'
  ctx.textAlign = 'center'
  if (state === 'thinking') {
    const dots = '.'.repeat((Math.floor(frame / 15) % 3) + 1)
    ctx.fillText(dots, x, by + 13)
  } else {
    ctx.fillText(text.slice(0, 16), x, by + 13)
  }
  ctx.restore()
}

export function drawApprovalBadge(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  if (Math.floor(frame / 20) % 2 === 0) {
    ctx.save()
    ctx.fillStyle = '#f0c040'
    ctx.font = 'bold 16px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('!', x, y)
    ctx.restore()
  }
}

export function drawPaper(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.fillStyle = '#fffde7'
  ctx.strokeStyle = '#aaa'
  ctx.lineWidth = 1
  ctx.fillRect(x - 5, y - 7, 10, 14)
  ctx.strokeRect(x - 5, y - 7, 10, 14)
  ctx.fillStyle = '#999'
  ctx.fillRect(x - 3, y - 4, 6, 1)
  ctx.fillRect(x - 3, y - 1, 6, 1)
  ctx.fillRect(x - 3, y + 2, 4, 1)
  ctx.restore()
}

export function drawDottedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, frame: number) {
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.lineDashOffset = -(frame % 8)
  ctx.strokeStyle = 'rgba(100,150,255,0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.restore()
}

export function drawError(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = '#e05050'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6)
  ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6)
  ctx.stroke()
  ctx.restore()
}

export function drawDone(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = '#50e090'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x - 6, y); ctx.lineTo(x - 1, y + 5); ctx.lineTo(x + 7, y - 5)
  ctx.stroke()
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(amount * 255))
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(amount * 255))
  const b = Math.min(255, (n & 0xff) + Math.round(amount * 255))
  return `rgb(${r},${g},${b})`
}
