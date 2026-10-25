import { ipcMain, type BrowserWindow } from 'electron'
import type { BotDeskState, OfficeEvent } from '@shared/office'

export class OfficeIpc {
  private readonly desks = new Map<number, BotDeskState>()
  private buffer: OfficeEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private win: BrowserWindow | null = null

  setWindow(w: BrowserWindow): void { this.win = w }

  emit(ev: OfficeEvent): void {
    const safe: OfficeEvent = {
      botId: ev.botId,
      state: ev.state,
      ts: ev.ts,
      ...(ev.task  ? { task:  ev.task.slice(0, 80) }   : {}),
      ...(ev.from !== undefined ? { from: ev.from }     : {}),
      ...(ev.to   !== undefined ? { to:   ev.to   }     : {}),
      ...(ev.tool  ? { tool:  ev.tool }                 : {}),
      ...(ev.text  ? { text:  ev.text.slice(0, 60) }   : {}),
      ...(ev.error ? { error: ev.error.slice(0, 120) }  : {}),
    }
    this.buffer.push(safe)
    const prev = this.desks.get(ev.botId)
    this.desks.set(ev.botId, {
      botId: ev.botId,
      name:  prev?.name  ?? '',
      color: prev?.color ?? '#4f7cff',
      state: ev.state,
      task:  ev.task?.slice(0, 80),
      tool:  ev.tool,
      error: ev.error?.slice(0, 120),
      startedAt: ev.state === 'thinking' ? ev.ts : prev?.startedAt,
    })
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 100)
    }
  }

  private flush(): void {
    this.timer = null
    if (!this.win || this.buffer.length === 0) { this.buffer = []; return }
    this.win.webContents.send('escritorio:evento', this.buffer)
    this.buffer = []
  }

  registerDesk(botId: number, name: string, color: string): void {
    const prev = this.desks.get(botId)
    this.desks.set(botId, { botId, name, color, state: prev?.state ?? 'idle', startedAt: prev?.startedAt })
  }

  registerHandlers(): void {
    ipcMain.handle('escritorio:getEstado', () => Array.from(this.desks.values()))
  }
}
